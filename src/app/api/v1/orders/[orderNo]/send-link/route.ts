import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { emailSchema } from '@/lib/validation'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { isValidOrderNo, normalizeOrderNo } from '@/server/orders/order-no'
import { resendTrackingLink } from '@/server/orders/tracking'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

const schema = z.object({ email: emailSchema })

/**
 * POST /api/v1/orders/[orderNo]/send-link
 *
 * Takip bağlantısını siparişte KAYITLI e-postaya yeniden gönderir.
 *
 * ⚠️ CEVAP HER ZAMAN `{ sent: true }`. Sipariş yoksa veya e-posta
 * eşleşmiyorsa da aynı cevap döner — aksi halde sipariş/e-posta eşleşmesini
 * doğrulayan bir oracle olurdu.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const { orderNo } = await params

  let ipLimit
  try {
    ipLimit = await rateLimit('orders.sendlink.ip', rateLimitIdentifier(req.headers))
  } catch (err) {
    return handleUnexpected('orders.sendlink', err)
  }
  if (!ipLimit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla istek. Lütfen daha sonra deneyin.', 429, {
      headers: rateLimitHeaders(ipLimit),
    })
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = schema.safeParse(body.data)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'E-posta adresi geçersiz.', 400)
  }

  const normalized = normalizeOrderNo(orderNo)
  if (!isValidOrderNo(normalized)) {
    // Biçim hatalı olsa bile aynı cevap — bilgi sızmasın.
    return NextResponse.json({ sent: true }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const orderKey = createHash('sha256').update(normalized).digest('hex').slice(0, 32)
  const orderLimit = await rateLimit('orders.sendlink.orderNo', orderKey)
  if (!orderLimit.ok) {
    return apiError('RATE_LIMITED', 'Bu sipariş için çok fazla istek gönderildi.', 429, {
      headers: rateLimitHeaders(orderLimit),
    })
  }

  try {
    await resendTrackingLink(normalized, parsed.data.email)
  } catch (err) {
    // Hata da sızdırılmaz; loglanır.
    console.error('[orders.sendlink]', err)
  }

  return NextResponse.json(
    {
      sent: true,
      message: 'Sipariş kayıtlarımızda bulunursa takip bağlantısı e-posta adresine gönderilir.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
