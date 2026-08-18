import { NextResponse, type NextRequest } from 'next/server'
import { loginSchema } from '@/lib/validation'
import { writeAudit } from '@/server/audit'
import { fakeVerifyDelay, verifyPassword } from '@/server/auth/password'
import { createDbSession } from '@/server/auth/session'
import { db } from '@/server/db'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { clientIpFrom, hashIp, rateLimit, rateLimitHeaders } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/auth/login — e-posta/şifre girişi
 *
 * Auth.js Credentials sağlayıcısı veritabanı oturumuyla çalışmadığı için
 * (bkz. `src/server/auth/session.ts`) oturum satırını kendimiz yazıyoruz.
 * Google girişi Auth.js akışında kalır; ikisi AYNI `Session` tablosunu kullanır.
 *
 * Güvenlik:
 *   • Kullanıcı numaralandırma engeli: e-posta yoksa da argon2 doğrulaması
 *     kadar beklenir ve AYNI mesaj döner.
 *   • Misafir gölge kayıtla giriş yapılamaz (şifresi yoktur).
 *   • Bloklu kullanıcı giriş yapamaz.
 *   • Rate limit: IP başına 5/dk.
 *   • CSRF: Origin doğrulaması + SameSite=Lax çerez.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const ipHash = hashIp(clientIpFrom(req.headers))

  let limit
  try {
    limit = await rateLimit('auth.login.ip', ipHash)
  } catch (err) {
    return handleUnexpected('auth.login', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla giriş denemesi. Lütfen biraz bekleyin.', 429, {
      headers: rateLimitHeaders(limit),
    })
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = loginSchema.safeParse(body.data)
  if (!parsed.success) {
    await fakeVerifyDelay()
    return apiError('INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.', 401)
  }

  // Hem "kullanıcı yok" hem "şifre yanlış" için AYNI cevap.
  const invalid = () => apiError('INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.', 401)

  try {
    const email = parsed.data.email.trim().toLowerCase()
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, isGuest: true, isBlocked: true },
    })

    // Misafir gölge kaydın şifresi yoktur → giriş yapılamaz.
    if (!user?.passwordHash || user.isGuest || user.isBlocked) {
      await fakeVerifyDelay()
      return invalid()
    }

    const ok = await verifyPassword(user.passwordHash, parsed.data.password)
    if (!ok) return invalid()

    await createDbSession(user.id)
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    await writeAudit({
      actorId: user.id,
      actorIpHash: ipHash,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
    })

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleUnexpected('auth.login', err)
  }
}
