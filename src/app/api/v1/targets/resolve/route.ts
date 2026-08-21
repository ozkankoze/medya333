import { NextResponse, type NextRequest } from 'next/server'
import type { TargetType } from '@/lib/enums'
import { targetResolveSchema } from '@/lib/validation'
import { getSessionUser } from '@/server/auth'
import { db } from '@/server/db'
import { getAdapter } from '@/server/platforms/registry'
import { apiError, handleUnexpected, readJsonBody } from '@/server/http'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * ⭐ MEDYA ADRESİ KAPISI — dış CDN adresinin istemciye sızmasını YAPISAL
 *    olarak imkânsız kılar. Hem avatar hem gönderi görseli buradan geçer.
 *
 * Adapter'ların `preview.avatarUrl` / `preview.thumbnailUrl` alanlarına kendi
 * media-proxy yolumuzu koyması
 * BEKLENİR. Ama "beklenir" bir güvenlik sınırı değildir: yarın bir adapter
 * (veya bir yanlış birleştirme) oraya Meta'nın imzalı CDN adresini koyarsa,
 * o adres hem HTML'e girer hem de müşterinin tarayıcısını doğrudan Meta'ya
 * istek atmaya zorlar — tam olarak media-proxy'nin engellemek için var olduğu
 * iki sonuç.
 *
 * Bu yüzden burada İZİN LİSTESİ uygulanır: yalnızca kendi proxy yolumuz geçer.
 * Başka her şey — mutlak adresler, protokol-göreli adresler, farklı yollar —
 * sessizce `null`'a düşer ve UI platform logosunu gösterir.
 */
function safeMediaPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  return /^\/api\/v1\/media\/avatar\/[a-f0-9]{32}$/.test(value) ? value : null
}



/**
 * POST /api/v1/targets/resolve
 *
 * KAPSAM: Yalnızca hedef doğrulama ve önizleme. Bu endpoint hiçbir sosyal medya
 * hesabına etkileşim göndermez. Scraping kullanılmaz.
 *
 * AKIŞ (Faz 0 kararı #2):
 *   parse (saf) → INVALID ise burada dur
 *   → adapter.resolve() → VERIFIED / UNVERIFIED / PRIVATE / NOT_FOUND
 *   → Target kaydı oluştur/güncelle → önizleme döndür
 *
 * UNVERIFIED, hata değildir. Kullanıcı kanonik hedefi görüp onaylar, akış devam eder.
 */
export async function POST(req: NextRequest) {
  const ipKey = rateLimitIdentifier(req.headers)
  let ipLimit
  try {
    ipLimit = await rateLimit('targets.resolve.ip', ipKey)
  } catch (err) {
    return handleUnexpected('targets.resolve', err)
  }
  if (!ipLimit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla deneme. Lütfen biraz bekleyin.', 429, {
      headers: rateLimitHeaders(ipLimit),
    })
  }

  const user = await getSessionUser()
  if (user) {
    const userLimit = await rateLimit('targets.resolve.user', user.id)
    if (!userLimit.ok) {
      return apiError('RATE_LIMITED', 'Çok fazla deneme.', 429, {
        headers: rateLimitHeaders(userLimit),
      })
    }
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = targetResolveSchema.safeParse(body.data)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: parsed.error.flatten().fieldErrors,
    })
  }

  const service = await db.service.findFirst({
    where: { id: parsed.data.serviceId, isActive: true },
    include: { platform: true },
  })

  if (!service || !service.platform.isActive) {
    return apiError('SERVICE_NOT_FOUND', 'Hizmet bulunamadı.', 404)
  }

  const adapter = getAdapter(service.platform.adapterKey)
  const targetType = service.targetType as TargetType

  // 1) SAF parse — ağ yok
  const parseResult = adapter.parse(parsed.data.input, targetType)
  if (!parseResult.ok) {
    return NextResponse.json({
      status: 'INVALID',
      message: parseResult.reason,
      example: parseResult.example || service.inputExample,
      capabilities: adapter.capabilities,
    })
  }

  // 2) Adapter çözümlemesi — ASLA throw etmez, en kötü ihtimalle UNVERIFIED
  const outcome = await adapter
    .resolve(parseResult.normalized, targetType, {
      canonicalUrl: parseResult.canonicalUrl,
      ...(parseResult.handle ? { handle: parseResult.handle } : {}),
    })
    .catch((err: unknown) => {
      console.error('[targets.resolve] adapter error', service.platform.adapterKey, err)
      return {
        status: 'UNVERIFIED' as const,
        normalized: parseResult.normalized,
        canonicalUrl: parseResult.canonicalUrl,
        reason: 'Doğrulama servisine şu anda ulaşılamıyor. Hedefi kontrol edip onaylayın.',
        method: 'format_only' as const,
        requiresConfirmation: true as const,
      }
    })

  if (outcome.status === 'INVALID') {
    return NextResponse.json({
      status: 'INVALID',
      message: outcome.reason,
      example: outcome.example || service.inputExample,
      capabilities: adapter.capabilities,
    })
  }

  // 3) Target kaydı — sipariş bu kayda bağlanır
  const isVerified = outcome.status === 'VERIFIED'
  const preview = isVerified ? outcome.preview : null
  const blocked = outcome.status === 'PRIVATE' || outcome.status === 'NOT_FOUND'


  const target = await db.target.create({
    data: {
      platformId: service.platformId,
      targetType,
      rawInput: parsed.data.input.slice(0, 512),
      normalized: outcome.normalized,
      canonicalUrl: outcome.canonicalUrl,
      status: outcome.status,
      verifyMethod: isVerified ? outcome.method : 'format_only',
      verifiedAt: isVerified ? new Date() : null,
      ...(isVerified && outcome.externalId ? { externalId: outcome.externalId } : {}),
      displayName: preview?.displayName ?? null,
      handle: preview?.handle ?? parseResult.handle ?? null,
      // ⭐ Media-proxy devreye girdi: burada saklanan artık dış CDN adresi
      // DEĞİL, kendi proxy yolumuzdur (`safeMediaPath` bunu zorunlu kılar).
      // Dış CDN URL'sini doğrudan saklamak hotlink kırılmasına ve kullanıcı
      // IP'sinin platforma sızmasına yol açardı.
      avatarUrl: safeMediaPath(preview?.avatarUrl),
      thumbnailUrl: safeMediaPath(preview?.thumbnailUrl),
      followerCount: preview?.followerCount ?? null,
      isPrivate: preview?.isPrivate ?? (outcome.status === 'PRIVATE' ? true : null),
      metaSnapshot: preview?.raw ? JSON.parse(JSON.stringify(preview.raw)) : undefined,
      snapshotAt: preview ? new Date() : null,
    },
    select: { id: true },
  })

  return NextResponse.json(
    {
      targetId: target.id,
      status: outcome.status,
      normalized: outcome.normalized,
      canonicalUrl: outcome.canonicalUrl,
      handle: preview?.handle ?? parseResult.handle ?? null,
      displayName: preview?.displayName ?? null,
      avatarUrl: safeMediaPath(preview?.avatarUrl),
      thumbnailUrl: safeMediaPath(preview?.thumbnailUrl),
      followerCount: preview?.followerCount ?? null,
      /** UNVERIFIED'da kullanıcıdan "Bu hedef doğru" onayı istenir */
      requiresConfirmation: outcome.status === 'UNVERIFIED',
      /** PRIVATE / NOT_FOUND akışı durdurur */
      canProceed: !blocked,
      message: outcome.status === 'UNVERIFIED' ? outcome.reason : null,
      capabilities: adapter.capabilities,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
