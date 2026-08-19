import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/server/auth'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { lookupOrderByToken, OrderAccessDeniedError } from '@/server/orders/lookup'
import { isValidOrderNo, normalizeOrderNo } from '@/server/orders/order-no'
import { createPaymentForOrder, PaymentError } from '@/server/payments/create'
import { readPaymentReturnToken, setPaymentReturnCookie } from '@/server/payments/return-cookie'
import { ProviderNotConfiguredError, ProviderCommunicationError } from '@/server/payments/types'
import { isProviderKey } from '@/server/payments/registry'
import { db } from '@/server/db'
import { clientIpFrom, hashIp, rateLimit, rateLimitHeaders } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/payments/create — ödeme başlatma
 *
 * ⚠️ GÖVDE TUTAR KABUL ETMEZ. Şemada `amount` alanı YOKTUR; olsa bile
 * `createPaymentForOrder` tutar parametresi almaz. Tutar yalnızca
 * `Order.totalMinor`'dan gelir.
 *
 * Sahiplik: oturum sahibi VEYA misafir takip token'ı. Sipariş numarası
 * tek başına ödeme başlatmaya yetmez.
 */
const schema = z.object({
  orderNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^M333-[0-9A-HJKMNP-TV-Z]{8}$/, 'Sipariş numarası geçersiz.'),
  /** Misafir siparişinde sahiplik kanıtı */
  trackingToken: z.string().trim().min(20).max(200).optional(),
  provider: z.string().trim().max(20).optional(),
})

export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const ip = clientIpFrom(req.headers)
  const ipHash = hashIp(ip)

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    return apiError('IDEMPOTENCY_KEY_REQUIRED', 'Geçerli bir Idempotency-Key başlığı gerekir.', 400)
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = schema.safeParse(body.data)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: parsed.error.flatten().fieldErrors,
    })
  }

  const orderNo = normalizeOrderNo(parsed.data.orderNo)
  if (!isValidOrderNo(orderNo)) return apiError('ORDER_NOT_FOUND', 'Sipariş bulunamadı.', 404)

  let limit
  try {
    limit = await rateLimit('payments.create.ip', ipHash)
  } catch (err) {
    return handleUnexpected('payments.create', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla ödeme denemesi. Lütfen biraz bekleyin.', 429, {
      headers: rateLimitHeaders(limit),
    })
  }

  /**
   * ⚠️ İKİNCİ EKSEN: SİPARİŞ BAZLI.
   * Yalnızca IP'ye bakan bir limit, dağıtık IP'lerden aynı siparişte tekrar
   * tekrar ödeme oturumu açılmasını engellemez — her deneme sağlayıcıya giden
   * gerçek bir istektir. Sahiplik kontrolünden ÖNCE uygulanır ki sahibi
   * olmayan biri de sayacı tüketebilsin diye değil, sağlayıcıya hiç
   * gidilmesin diye.
   */
  let orderLimit
  try {
    orderLimit = await rateLimit('payments.init.order', orderNo)
  } catch (err) {
    return handleUnexpected('payments.create', err)
  }
  if (!orderLimit.ok) {
    return apiError('RATE_LIMITED', 'Bu sipariş için çok fazla ödeme denemesi yapıldı.', 429, {
      headers: rateLimitHeaders(orderLimit),
    })
  }

  // --- SAHİPLİK ------------------------------------------------------------
  let ownerUserId: string | null = null

  const session = await getSessionUser()
  if (session) {
    const owned = await db.order.findFirst({
      where: { orderNo, userId: session.id },
      select: { userId: true },
    })
    if (owned) ownerUserId = owned.userId
  }

  // Takip token'ı: gövdeden ya da ödeme dönüş çerezinden.
  // Çerez sayesinde "Tekrar Öde" akışı token URL'e girmeden çalışır.
  const proofToken = parsed.data.trackingToken ?? (await readPaymentReturnToken(orderNo))

  if (!ownerUserId && proofToken) {
    try {
      // Token doğruysa siparişin sahibi (gölge kullanıcı dahil) belirlenir.
      await lookupOrderByToken(orderNo, proofToken)
      const order = await db.order.findUnique({ where: { orderNo }, select: { userId: true } })
      ownerUserId = order?.userId ?? null
    } catch (err) {
      if (!(err instanceof OrderAccessDeniedError)) return handleUnexpected('payments.create', err)
    }
  }

  if (!ownerUserId) {
    // Var/yok ayrımı yapılmaz — sipariş numarası sızdırılmaz.
    return apiError('ORDER_NOT_FOUND', 'Sipariş bulunamadı.', 404)
  }

  const preferred = parsed.data.provider
  if (preferred && !isProviderKey(preferred)) {
    return apiError('UNKNOWN_PAYMENT_PROVIDER', 'Bilinmeyen ödeme sağlayıcısı.', 400)
  }

  try {
    const session_ = await createPaymentForOrder(orderNo, {
      userId: ownerUserId,
      ip,
      ipHash,
      idempotencyKey,
      ...(preferred ? { preferredProvider: preferred } : {}),
    })

    // Misafir dönüşü için sahiplik kanıtı — token URL'e KOYULMAZ, çereze yazılır.
    if (proofToken) {
      await setPaymentReturnCookie(orderNo, proofToken)
    }

    return NextResponse.json(session_, {
      status: session_.reused ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return apiError(
        err.code,
        'Ödeme altyapısı şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.',
        503,
      )
    }
    if (err instanceof ProviderCommunicationError) {
      return apiError(err.code, 'Ödeme sağlayıcısına ulaşılamadı. Lütfen tekrar deneyin.', 502)
    }
    if (err instanceof PaymentError) {
      return apiError(err.code, err.message, err.status)
    }
    // ⚠️ Korelasyon: sipariş numarası TANIMLAYICIDIR, PII değildir —
    // tek başına siparişe erişim vermez (e-posta veya imzalı token şart).
    return handleUnexpected('payments.create', err, { orderNo })
  }
}
