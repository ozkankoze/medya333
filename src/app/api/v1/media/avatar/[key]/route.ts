import { NextResponse, type NextRequest } from 'next/server'
import { AVATAR_TTL_SECONDS, readAvatar } from '@/server/media/avatar-store'
import { apiError, handleUnexpected } from '@/server/http'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/media/avatar/[key]
 *
 * ⭐ MEDIA-PROXY — profil fotoğrafını KENDİ adresimizden servis eder.
 *
 * Sebep `server/media/avatar-store.ts` başlığında yazılı: Meta'nın imzalı CDN
 * adresini istemciye vermek hem kırık görsele hem de müşteri IP'sinin Meta'ya
 * sızmasına yol açar.
 *
 * ⚠️ BU ROTA DIŞARIYA İSTEK ATMAZ. Yalnızca Redis'te ÖNCEDEN saklanmış baytları
 *    okur. Yani `key` parametresi bir adres değil, opak bir depo anahtarıdır —
 *    SSRF yüzeyi YOKTUR. İndirme kararı, adres doğrulamasıyla birlikte
 *    `storeAvatarFromCdn()` içinde, çözümleme anında verilir.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  try {
    // ⚠️ Rate limit BYPASS EDİLMEZ: bu uç kimlik doğrulaması istemez ve
    //    Redis'ten okur; sınırsız bırakmak ucuz bir kaynak tüketim yüzeyidir.
    const limit = await rateLimit('media.avatar.ip', rateLimitIdentifier(req.headers))
    if (!limit.ok) {
      return apiError('RATE_LIMITED', 'Çok fazla istek.', 429, { headers: rateLimitHeaders(limit) })
    }

    const { key } = await ctx.params
    const avatar = await readAvatar(key)

    // ⚠️ Bulunamayan anahtar için 404 — "süresi doldu" ile "hiç yoktu"
    //    ayrımı yapılmaz; anahtar uzayı hakkında bilgi sızdırmaz.
    if (!avatar) return apiError('NOT_FOUND', 'Görsel bulunamadı.', 404)

    return new NextResponse(new Uint8Array(avatar.bytes), {
      status: 200,
      headers: {
        'Content-Type': avatar.contentType,
        'Content-Length': String(avatar.bytes.byteLength),
        /**
         * ⚠️ `private` — paylaşımlı ara sunucular (CDN) bunu saklamasın.
         * Süre, deponun TTL'inden UZUN OLAMAZ: aksi halde tarayıcı, sunucuda
         * artık var olmayan bir görseli göstermeye devam eder.
         */
        'Cache-Control': `private, max-age=${AVATAR_TTL_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        ...rateLimitHeaders(limit),
      },
    })
  } catch (err) {
    return handleUnexpected('media.avatar', err)
  }
}
