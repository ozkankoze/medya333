import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { orderLookupSchema } from '@/lib/validation'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { lookupOrderByEmail, OrderAccessDeniedError } from '@/server/orders/lookup'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orders/lookup — MİSAFİR SİPARİŞ SORGUSU
 *
 * GÜVENLİK:
 *   • Sipariş numarası + e-posta İKİSİ BİRDEN doğru olmalı.
 *   • İki kademeli rate limit:
 *       – IP başına (5 / saat)
 *       – SİPARİŞ NUMARASI başına (5 / saat) → tek numaraya karşı e-posta
 *         tahmin saldırısı IP değiştirilse bile durur.
 *   • Bulunamadı ile eşleşmedi AYNI cevabı döner → sipariş var mı yok mu
 *     bilgisi sızmaz (enumeration engeli).
 *   • Sipariş numarası 8 karakter Crockford Base32 (~10^12 olasılık) →
 *     ardışık tahminle bulunamaz.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const ipKey = rateLimitIdentifier(req.headers)
  let ipLimit
  try {
    ipLimit = await rateLimit('orders.lookup.ip', ipKey)
  } catch (err) {
    return handleUnexpected('orders.lookup', err)
  }
  if (!ipLimit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla sorgulama. Lütfen bir süre sonra deneyin.', 429, {
      headers: rateLimitHeaders(ipLimit),
    })
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = orderLookupSchema.safeParse(body.data)
  if (!parsed.success) {
    // Biçim hatasında bile sipariş varlığı hakkında bilgi verilmez.
    return apiError('VALIDATION_ERROR', 'Sipariş numarası veya e-posta geçersiz.', 400, {
      details: parsed.error.flatten().fieldErrors,
    })
  }

  // Sipariş numarası başına brute-force koruması. Numara loglanmaz; hash'lenir.
  const orderKey = createHash('sha256').update(parsed.data.orderNo).digest('hex').slice(0, 32)
  const orderLimit = await rateLimit('orders.lookup.orderNo', orderKey)
  if (!orderLimit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla sorgulama. Lütfen bir süre sonra deneyin.', 429, {
      headers: rateLimitHeaders(orderLimit),
    })
  }

  try {
    const view = await lookupOrderByEmail(parsed.data.orderNo, parsed.data.email)
    return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof OrderAccessDeniedError) {
      return apiError('ORDER_NOT_FOUND', err.message, 404)
    }
    return handleUnexpected('orders.lookup', err)
  }
}
