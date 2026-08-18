import { NextResponse, type NextRequest } from 'next/server'
import { apiError, handleUnexpected } from '@/server/http'
import { getSessionUser } from '@/server/auth'
import {
  getOrderForUser,
  lookupOrderByToken,
  OrderAccessDeniedError,
} from '@/server/orders/lookup'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orders/[orderNo]
 *
 * ⚠️ SİPARİŞ NUMARASI TEK BAŞINA YETMEZ.
 * Erişim için ikisinden biri gerekir:
 *   • `?t=<takip token'ı>` — e-posta ile gönderilen imzalı bağlantı
 *   • Oturum — sorgu `userId` ile kapsamlanır (IDOR koruması)
 *
 * Aksi halde 404 döner (401 değil: siparişin varlığı bile sızdırılmaz).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const { orderNo } = await params

  let limit
  try {
    limit = await rateLimit('orders.detail.ip', rateLimitIdentifier(req.headers))
  } catch (err) {
    return handleUnexpected('orders.detail', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla istek.', 429, { headers: rateLimitHeaders(limit) })
  }

  const token = req.nextUrl.searchParams.get('t')

  try {
    if (token) {
      const view = await lookupOrderByToken(orderNo, token)
      return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
    }

    const user = await getSessionUser()
    if (!user) throw new OrderAccessDeniedError()

    const view = await getOrderForUser(orderNo, user.id)
    return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof OrderAccessDeniedError) {
      return apiError('ORDER_NOT_FOUND', err.message, 404)
    }
    return handleUnexpected('orders.detail', err)
  }
}
