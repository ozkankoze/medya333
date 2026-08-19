import { NextResponse, type NextRequest } from 'next/server'
import { registerSchema } from '@/lib/validation'
import { writeAudit } from '@/server/audit'
import { checkPasswordStrength, hashPassword } from '@/server/auth'
import { db } from '@/server/db'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { sendEmail } from '@/server/mail'
import { appBaseUrl } from '@/server/base-url'
import { issueClaimToken } from '@/server/orders/claim'
import { clientIpFrom, hashIp, rateLimit, rateLimitHeaders } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/auth/register — hesap oluşturma
 *
 * GİRİŞ Auth.js Credentials sağlayıcısı üzerinden yapılır; bu uç yalnızca
 * KAYIT içindir (Auth.js kayıt akışı sunmaz).
 *
 * Güvenlik:
 *   • Kullanıcı numaralandırma engeli: e-posta zaten kayıtlıysa da
 *     "kayıt oluşturuldu" cevabı döner, açıklama e-posta ile gider.
 *   • Şifre argon2id ile hash'lenir; asla loglanmaz.
 *   • Misafir gölge kaydı varsa ŞİFRE ONA BAĞLANIR — ama siparişler
 *     OTOMATİK DEVRALINMAZ. Devralma için e-postaya claim bağlantısı
 *     gönderilir (bkz. /api/v1/me/claim-guest-orders).
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const ipHash = hashIp(clientIpFrom(req.headers))

  let limit
  try {
    limit = await rateLimit('auth.register.ip', ipHash)
  } catch (err) {
    return handleUnexpected('auth.register', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla kayıt denemesi. Lütfen daha sonra deneyin.', 429, {
      headers: rateLimitHeaders(limit),
    })
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = registerSchema.safeParse(body.data)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: parsed.error.flatten().fieldErrors,
    })
  }

  const strength = checkPasswordStrength(parsed.data.password)
  if (!strength.ok) {
    return apiError('WEAK_PASSWORD', strength.reason ?? 'Şifre yeterince güçlü değil.', 400)
  }

  const { email, password, name } = parsed.data
  const genericOk = NextResponse.json(
    {
      ok: true,
      message: 'Hesabınız oluşturuldu. Şimdi giriş yapabilirsiniz.',
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )

  try {
    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, isGuest: true, isBlocked: true },
    })

    // Zaten gerçek hesap varsa: numaralandırmayı engellemek için AYNI cevap.
    if (existing?.passwordHash) return genericOk
    if (existing?.isBlocked) return genericOk

    const passwordHash = await hashPassword(password)

    let userId: string
    let hadGuestOrders = false

    if (existing) {
      // Misafir gölge kaydı → şifre eklenir, ama isGuest DÜŞÜRÜLMEZ.
      // Siparişlerin devri ayrı ve doğrulanmış bir adımdır.
      const orders = await db.order.count({ where: { userId: existing.id } })
      hadGuestOrders = orders > 0
      await db.user.update({
        where: { id: existing.id },
        data: { passwordHash, name: name ?? undefined },
      })
      userId = existing.id
    } else {
      const created = await db.user.create({
        data: {
          email,
          passwordHash,
          name: name ?? null,
          isGuest: false,
        },
        select: { id: true },
      })
      userId = created.id
    }

    await writeAudit({
      actorId: userId,
      actorIpHash: ipHash,
      action: 'auth.register',
      entityType: 'User',
      entityId: userId,
      // PII yazılmaz
      after: { convertedFromGuest: !!existing, hadGuestOrders },
    })

    // Misafir siparişleri varsa: e-postaya doğrulanmış devralma bağlantısı.
    if (hadGuestOrders) {
      const token = await issueClaimToken(userId, email)
      /**
       * ⚠️ Bu bir SİPARİŞ bildirimi değildir (bir OrderEvent'e bağlı değil),
       * bu yüzden Notification kaydı açılmaz ve doğrudan `sendEmail`
       * kullanılır. Devralma token'ı yalnızca bağlantı içinde taşınır ve
       * hiçbir log satırına yazılmaz.
       */
      await sendEmail({
        to: email,
        template: 'GUEST_CLAIM',
        variables: {
          claimUrl: `${appBaseUrl()}/hesabim?claim=${encodeURIComponent(token)}`,
        },
      })
    }

    return genericOk
  } catch (err) {
    return handleUnexpected('auth.register', err)
  }
}
