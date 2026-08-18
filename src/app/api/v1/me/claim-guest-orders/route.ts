import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/server/auth'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { ClaimError, claimGuestOrders } from '@/server/orders/claim'
import {
  clientIpFrom,
  hashIp,
  rateLimit,
  rateLimitHeaders,
} from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  token: z.string().trim().min(20).max(200).optional().nullable(),
})

/**
 * POST /api/v1/me/claim-guest-orders
 *
 * ⚠️ SADECE E-POSTA EŞLEŞMESİ YETMEZ.
 * Devralma için ikisinden biri gerekir:
 *   • Kullanıcının e-postası DOĞRULANMIŞ (emailVerified), veya
 *   • E-postaya gönderilen tek kullanımlık claim token'ı
 *
 * Aksi halde biri, başkasının e-postasıyla hesap açıp o kişinin
 * siparişlerini görebilirdi.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  try {
    const user = await requireUser()

    const limit = await rateLimit('orders.claim.user', user.id)
    if (!limit.ok) {
      return apiError('RATE_LIMITED', 'Çok fazla deneme.', 429, {
        headers: rateLimitHeaders(limit),
      })
    }

    const body = await readJsonBody(req)
    if (!body.ok) return body.response

    const parsed = schema.safeParse(body.data)
    if (!parsed.success) return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400)

    const result = await claimGuestOrders({
      userId: user.id,
      token: parsed.data.token ?? null,
      ipHash: hashIp(clientIpFrom(req.headers)),
    })

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof ClaimError) {
      return apiError(err.code, err.message, err.code === 'EMAIL_NOT_VERIFIED' ? 403 : 400)
    }
    return handleUnexpected('orders.claim', err)
  }
}
