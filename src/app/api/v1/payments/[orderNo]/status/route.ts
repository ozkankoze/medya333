import { NextResponse, type NextRequest } from 'next/server'
import { PAYMENT_STATUS_META } from '@/lib/payments/status'
import type { OrderStatus, PaymentStatus } from '@/lib/enums'
import { ORDER_STATUS_META } from '@/lib/orders/status'
import { getSessionUser } from '@/server/auth'
import { db } from '@/server/db'
import { apiError, handleUnexpected } from '@/server/http'
import { lookupOrderByToken, OrderAccessDeniedError } from '@/server/orders/lookup'
import { isValidOrderNo, normalizeOrderNo } from '@/server/orders/order-no'
import { readPaymentReturnToken } from '@/server/payments/return-cookie'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/payments/[orderNo]/status
 *
 * "Ödemeniz doğrulanıyor" ekranının yokladığı uç.
 *
 * ⚠️ Bu uç ödeme SONUCUNU BELİRLEMEZ, yalnızca okur. Tarayıcı kaç kez
 * sorarsa sorsun hiçbir şey yazılmaz — tek yazar doğrulanmış webhook'tur.
 *
 * Erişim: oturum sahibi ya da takip token'ı. Sipariş numarası tek başına yetmez.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderNo: string }> }) {
  const { orderNo: raw } = await ctx.params
  const orderNo = normalizeOrderNo(raw)
  if (!isValidOrderNo(orderNo)) return apiError('ORDER_NOT_FOUND', 'Sipariş bulunamadı.', 404)

  let limit
  try {
    limit = await rateLimit('payments.status.ip', rateLimitIdentifier(req.headers))
  } catch (err) {
    return handleUnexpected('payments.status', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla istek.', 429, { headers: rateLimitHeaders(limit) })
  }

  // Üç sahiplik yolu: açık token · oturum · ödeme dönüş çerezi.
  // Çerez, sağlayıcıdan dönen misafir kullanıcı içindir (bkz. return-cookie.ts).
  const token = req.nextUrl.searchParams.get('t') ?? (await readPaymentReturnToken(orderNo))

  try {
    let authorized = false
    if (token) {
      await lookupOrderByToken(orderNo, token)
      authorized = true
    } else {
      const user = await getSessionUser()
      if (user) {
        const owned = await db.order.findFirst({
          where: { orderNo, userId: user.id },
          select: { id: true },
        })
        authorized = Boolean(owned)
      }
    }
    if (!authorized) throw new OrderAccessDeniedError()

    const order = await db.order.findUniqueOrThrow({
      where: { orderNo },
      select: {
        status: true,
        totalMinor: true,
        currency: true,
        payments: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
          select: {
            status: true,
            provider: true,
            attemptNumber: true,
            amountMinor: true,
            failureMessage: true,
            capturedAt: true,
          },
        },
      },
    })

    const latest = order.payments[0] ?? null
    const paymentStatus = (latest?.status ?? null) as PaymentStatus | null
    const meta = paymentStatus ? PAYMENT_STATUS_META[paymentStatus] : null
    const orderStatus = order.status as OrderStatus

    return NextResponse.json(
      {
        orderNo,
        orderStatus,
        orderStatusLabel: ORDER_STATUS_META[orderStatus].label,
        /** ⚠️ Sipariş yalnızca doğrulanmış ödemeyle PAID olur. */
        paid: orderStatus !== 'PENDING_PAYMENT' && orderStatus !== 'DRAFT',
        totalMinor: order.totalMinor,
        currency: order.currency,
        payment: latest
          ? {
              status: paymentStatus,
              label: meta?.label ?? null,
              description: meta?.description ?? null,
              tone: meta?.tone ?? null,
              retryable: meta?.retryable ?? false,
              provider: latest.provider,
              attemptNumber: latest.attemptNumber,
              // Hata mesajı sağlayıcıdan gelir; PII taşımaz
              failureMessage: latest.failureMessage,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof OrderAccessDeniedError) {
      return apiError('ORDER_NOT_FOUND', err.message, 404)
    }
    return handleUnexpected('payments.status', err)
  }
}
