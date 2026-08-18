import 'server-only'

import { randomBytes } from 'node:crypto'
import { env } from '@/env'
import type { PaymentStatus } from '@/lib/enums'
import { PAYMENT_IN_FLIGHT, PAYMENT_SETTLED } from '@/lib/payments/status'
import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'
import { appBaseUrl } from '@/server/base-url'
import { normalizeOrderNo } from '@/server/orders/order-no'
import { assertPaymentConfig, getActiveProvider, getProvider } from './registry'
import { recordPaymentEvent } from './events'
import { safeLogLine } from './redact'
import { ProviderNotConfiguredError, type CreatePaymentInput } from './types'

/**
 * ÖDEME BAŞLATMA
 *
 * ⚠️ TUTARIN TEK KAYNAĞI `Order.totalMinor`.
 * Bu fonksiyon tutar parametresi ALMAZ. İstemci gövdesinde `amount` olsa bile
 * hiçbir yolu yoktur — imza buna izin vermez. Sağlayıcıya gönderilen tutar
 * doğrudan veritabanındaki sipariş toplamıdır.
 *
 * Sıra:
 *   1. Sipariş sahipliği (oturum ya da misafir token/e-posta) DIŞARIDA doğrulanır
 *   2. Sipariş DB'den okunur
 *   3. status === PENDING_PAYMENT mi?
 *   4. Zaten başarılı ödeme var mı? → varsa yeni ödeme AÇILMAZ
 *   5. Order.totalMinor okunur (tek kaynak)
 *   6. Devam eden ödeme varsa aynı checkout döndürülür (çift tıklama)
 *   7. Payment kaydı + attempt numarası
 *   8. Sağlayıcıdan checkout bilgisi alınır
 */

export class PaymentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

/** Aynı siparişe ikinci bir BAŞARILI ödeme alınmışsa mutabakat gerekir. */
export class DuplicateSettledPaymentError extends PaymentError {
  constructor() {
    super(
      'ALREADY_PAID',
      'Bu siparişin ödemesi zaten alınmış. Yeni ödeme başlatılamaz.',
      409,
    )
  }
}

export interface CreatePaymentContext {
  /** Sipariş sahibi doğrulanmış kullanıcı kimliği */
  userId: string
  /** Sağlayıcının risk analizi için ham IP (DB'ye YAZILMAZ) */
  ip: string
  ipHash: string
  /** Çift tıklama koruması */
  idempotencyKey: string
  /** İstemci sağlayıcı önerebilir; yapılandırılmamışsa aktif olan kullanılır */
  preferredProvider?: string | null
}

export interface CheckoutSession {
  paymentId: string
  orderNo: string
  provider: string
  status: PaymentStatus
  amountMinor: number
  currency: string
  attemptNumber: number
  checkoutUrl: string | null
  checkoutToken: string | null
  presentation: 'redirect' | 'iframe'
  expiresAt: string | null
  /** Mevcut bir oturum yeniden kullanıldıysa true */
  reused: boolean
}

const CHECKOUT_TTL_MS = 30 * 60 * 1000

/** Sağlayıcıya gidecek benzersiz referans. Alfanumerik: PayTR merchant_oid kısıtı. */
function newProviderRef(orderNo: string, attempt: number): string {
  const compact = orderNo.replace(/[^a-zA-Z0-9]/g, '')
  return `${compact}A${attempt}R${randomBytes(6).toString('hex')}`
}

export async function createPaymentForOrder(
  orderNoRaw: string,
  ctx: CreatePaymentContext,
): Promise<CheckoutSession> {
  const orderNo = normalizeOrderNo(orderNoRaw)

  // --- 1-2) Sipariş: sorgu kullanıcıya KAPSAMLANIR (IDOR) --------------------
  const order = await db.order.findFirst({
    where: { orderNo, userId: ctx.userId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      totalMinor: true,
      currency: true,
      quantity: true,
      userId: true,
      customerFirstName: true,
      customerLastName: true,
      customerEmail: true,
      guestEmail: true,
      customerPhone: true,
      platform: { select: { name: true } },
      service: { select: { name: true } },
      serviceVariant: { select: { customerLabel: true } },
    },
  })
  if (!order) throw new PaymentError('ORDER_NOT_FOUND', 'Sipariş bulunamadı.', 404)

  // --- 3) Yalnızca ödeme bekleyen sipariş ödenebilir -------------------------
  if (order.status !== 'PENDING_PAYMENT') {
    if (order.status === 'CANCELLED') {
      throw new PaymentError('ORDER_CANCELLED', 'İptal edilmiş sipariş için ödeme alınamaz.', 409)
    }
    if (order.status === 'DRAFT') {
      throw new PaymentError('ORDER_NOT_READY', 'Sipariş henüz tamamlanmamış.', 409)
    }
    // PAID / PROCESSING / … → ödeme çoktan alınmış demektir.
    if (order.status === 'FAILED') {
      throw new PaymentError(
        'ORDER_NOT_PAYABLE',
        'Bu sipariş ödemeye uygun durumda değil.',
        409,
      )
    }
    throw new DuplicateSettledPaymentError()
  }

  // --- 4) Zaten tahsil edilmiş ödeme var mı? --------------------------------
  const existing = await db.payment.findMany({
    where: { orderId: order.id },
    orderBy: { attemptNumber: 'desc' },
    select: {
      id: true,
      status: true,
      attemptNumber: true,
      provider: true,
      amountMinor: true,
      currency: true,
      checkoutUrl: true,
      checkoutToken: true,
      checkoutExpiresAt: true,
      idempotencyKey: true,
    },
  })

  if (existing.some((p) => PAYMENT_SETTLED.has(p.status as PaymentStatus))) {
    throw new DuplicateSettledPaymentError()
  }

  // --- Idempotency: aynı anahtar daha önce kullanıldıysa aynı oturum --------
  const sameKey = existing.find((p) => p.idempotencyKey === ctx.idempotencyKey)
  if (sameKey) {
    return toSession(order.orderNo, sameKey, 'redirect', true)
  }

  // --- 5) TUTAR: tek kaynak -------------------------------------------------
  const amountMinor = order.totalMinor
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new PaymentError('INVALID_AMOUNT', 'Sipariş tutarı geçersiz.', 409)
  }
  if (order.currency !== 'TRY') {
    throw new PaymentError('UNSUPPORTED_CURRENCY', 'Yalnızca TRY ile ödeme alınır.', 409)
  }

  // --- 6) Devam eden ödeme varsa onu döndür (çift tıklama) ------------------
  const inFlight = existing.find(
    (p) =>
      PAYMENT_IN_FLIGHT.has(p.status as PaymentStatus) &&
      p.checkoutUrl &&
      (!p.checkoutExpiresAt || p.checkoutExpiresAt > new Date()),
  )
  if (inFlight) {
    // Tutar değişmişse eski oturum GEÇERSİZDİR — yeni deneme açılır.
    if (inFlight.amountMinor === amountMinor) {
      return toSession(order.orderNo, inFlight, 'redirect', true)
    }
    await db.payment.update({
      where: { id: inFlight.id },
      data: { status: 'CANCELLED', failureCode: 'AMOUNT_CHANGED' },
    })
  }

  // --- Sağlayıcı seçimi ------------------------------------------------------
  // Yanlış yapılandırma (canlı ortamda mock) burada patlar; sessizce
  // "başarılı ödeme" üretmesine imkân yok.
  assertPaymentConfig()

  const provider =
    ctx.preferredProvider && ctx.preferredProvider !== env.PAYMENT_PROVIDER
      ? getProvider(ctx.preferredProvider)
      : getActiveProvider()

  if (!provider.isConfigured) {
    throw new ProviderNotConfiguredError(provider.key)
  }

  // --- 7) Payment kaydı ------------------------------------------------------
  const attemptNumber = (existing[0]?.attemptNumber ?? 0) + 1
  const providerRef = newProviderRef(order.orderNo, attemptNumber)
  const email = (order.customerEmail ?? order.guestEmail ?? '').trim().toLowerCase()
  if (!email) throw new PaymentError('MISSING_EMAIL', 'Sipariş e-postası bulunamadı.', 409)

  const payment = await db.payment.create({
    data: {
      orderId: order.id,
      userId: order.userId,
      provider: provider.key,
      providerRef,
      attemptNumber,
      orderNoSnapshot: order.orderNo,
      environment: provider.environment,
      status: 'INITIATED',
      // ⚠️ SNAPSHOT: Order.totalMinor'dan kopyalanır, istemciden DEĞİL.
      amountMinor,
      currency: order.currency,
      idempotencyKey: ctx.idempotencyKey,
    },
    select: { id: true, attemptNumber: true },
  })

  await recordPaymentEvent({
    paymentId: payment.id,
    provider: provider.key,
    providerEventId: `${providerRef}:PAYMENT_CREATED`,
    eventType: 'PAYMENT_CREATED',
    signatureValid: true,
    payload: { attemptNumber, amountMinor, currency: order.currency },
  })

  // --- 8) Sağlayıcı checkout -------------------------------------------------
  const base = appBaseUrl()
  const input: CreatePaymentInput = {
    providerRef,
    orderNo: order.orderNo,
    amountMinor,
    currency: 'TRY',
    buyer: {
      id: order.userId,
      firstName: order.customerFirstName ?? 'Müşteri',
      lastName: order.customerLastName ?? '-',
      email,
      ip: ctx.ip,
      phone: order.customerPhone,
    },
    basket: [
      {
        id: order.id,
        name: `${order.platform.name} ${order.service.name} (${order.serviceVariant.customerLabel})`,
        amountMinor,
      },
    ],
    callbackUrl: `${base}/api/v1/payments/webhooks/${provider.key}`,
    successUrl: `${base}/odeme/sonuc/${order.orderNo}`,
    failureUrl: `${base}/odeme/sonuc/${order.orderNo}?durum=basarisiz`,
  }

  let result
  try {
    result = await provider.createPayment(input)
  } catch (err) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureCode: 'PROVIDER_UNAVAILABLE',
        failureMessage: 'Sağlayıcıya ulaşılamadı.',
      },
    })
    await recordPaymentEvent({
      paymentId: payment.id,
      provider: provider.key,
      providerEventId: `${providerRef}:PROVIDER_ERROR`,
      eventType: 'PAYMENT_FAILED',
      signatureValid: true,
      payload: { reason: 'provider_unavailable' },
    })
    throw err
  }

  if (!result.ok || !result.checkoutUrl) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureCode: result.errorCode ?? 'CHECKOUT_FAILED',
        failureMessage: result.errorMessage ?? 'Ödeme oturumu başlatılamadı.',
        rawInitPayload: (result.raw ?? null) as never,
      },
    })
    await recordPaymentEvent({
      paymentId: payment.id,
      provider: provider.key,
      providerEventId: `${providerRef}:CHECKOUT_FAILED`,
      eventType: 'PAYMENT_FAILED',
      signatureValid: true,
      payload: { errorCode: result.errorCode ?? null },
    })
    throw new PaymentError(
      result.errorCode ?? 'CHECKOUT_FAILED',
      result.errorMessage ?? 'Ödeme başlatılamadı. Lütfen tekrar deneyin.',
      502,
    )
  }

  const updated = await db.payment.update({
    where: { id: payment.id },
    data: {
      status: result.status,
      providerTxnId: result.providerTxnId ?? null,
      checkoutUrl: result.checkoutUrl,
      checkoutToken: result.checkoutToken ?? null,
      checkoutExpiresAt: result.expiresAt ?? new Date(Date.now() + CHECKOUT_TTL_MS),
      rawInitPayload: (result.raw ?? null) as never,
    },
    select: {
      id: true,
      status: true,
      provider: true,
      amountMinor: true,
      currency: true,
      attemptNumber: true,
      checkoutUrl: true,
      checkoutToken: true,
      checkoutExpiresAt: true,
    },
  })

  await recordPaymentEvent({
    paymentId: payment.id,
    provider: provider.key,
    providerEventId: `${providerRef}:CHECKOUT_STARTED`,
    eventType: 'CHECKOUT_STARTED',
    signatureValid: true,
    payload: { presentation: result.presentation, attemptNumber },
  })

  // Siparişe de iz düşürülür: ödeme başlatıldı (durum DEĞİŞMEZ).
  await db.orderEvent.create({
    data: {
      orderId: order.id,
      type: 'PAYMENT_INITIATED',
      message: 'Ödeme başlatıldı.',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      isCustomerVisible: true,
      payload: { provider: provider.key, attemptNumber } as never,
    },
  })

  await writeAudit({
    actorId: ctx.userId,
    actorIpHash: ctx.ipHash,
    action: 'payment.create',
    entityType: 'Payment',
    entityId: payment.id,
    after: {
      orderNo: order.orderNo,
      provider: provider.key,
      amountMinor,
      attemptNumber,
      environment: provider.environment,
    },
  })

  console.log(
    safeLogLine('payment.create', {
      orderNo: order.orderNo,
      provider: provider.key,
      attempt: attemptNumber,
      amountMinor,
      env: provider.environment,
    }),
  )

  return toSession(order.orderNo, updated, result.presentation, false)
}

function toSession(
  orderNo: string,
  p: {
    id: string
    status: string
    provider?: string
    amountMinor?: number
    currency?: string
    attemptNumber: number
    checkoutUrl: string | null
    checkoutToken: string | null
    checkoutExpiresAt?: Date | null
  },
  presentation: 'redirect' | 'iframe',
  reused: boolean,
): CheckoutSession {
  return {
    paymentId: p.id,
    orderNo,
    provider: p.provider ?? 'unknown',
    status: p.status as PaymentStatus,
    amountMinor: p.amountMinor ?? 0,
    currency: p.currency ?? 'TRY',
    attemptNumber: p.attemptNumber,
    checkoutUrl: p.checkoutUrl,
    checkoutToken: p.checkoutToken,
    presentation,
    expiresAt: p.checkoutExpiresAt ? p.checkoutExpiresAt.toISOString() : null,
    reused,
  }
}
