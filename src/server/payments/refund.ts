import 'server-only'

import type { PaymentStatus } from '@/lib/enums'
import { assertPaymentTransition, PAYMENT_SETTLED } from '@/lib/payments/status'
import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'
import { transitionOrder } from '@/server/orders/transition'
import { recordPaymentEvent } from './events'
import { getProvider } from './registry'
import { safeLogLine } from './redact'
import { PaymentError } from './create'

/**
 * İADE DOMAİNİ
 *
 * KURALLAR
 *   • Yalnızca tahsil edilmiş (CAPTURED / PARTIALLY_REFUNDED) ödeme iade edilir.
 *   • İade tutarı, ödemenin KALAN iade edilebilir tutarını AŞAMAZ.
 *     Toplam iade > ödeme tutarı matematiksel olarak imkânsız kılınır.
 *   • İade sağlayıcı üzerinden yapılır; sağlayıcı reddederse Refund FAILED olur
 *     ve `refundedMinor` ARTMAZ.
 *   • Çift onay: ADMIN talep eder, SUPERADMIN onaylar (şema zaten taşıyor).
 *   • Idempotency anahtarı ile aynı iade iki kez işlenemez.
 *
 * YARIŞ: Payment satırı `FOR UPDATE` ile kilitlenir. Aynı anda gelen iki iade
 * talebi sıraya girer; ikincisi güncel `refundedMinor` üzerinden hesaplanır,
 * böylece toplam asla aşılmaz. Aynı anda gelen webhook da aynı kilidi bekler.
 */

export class RefundError extends PaymentError {}

export interface RefundRequestInput {
  /** Sipariş numarası veya Payment kimliği */
  orderNo: string
  amountMinor: number
  reason: string
  requestedById: string
  actorIpHash?: string | null
  idempotencyKey: string
  /** Sağlayıcının risk kontrolü için */
  ip: string
}

export interface RefundOutcome {
  refundId: string
  status: 'COMPLETED' | 'FAILED'
  amountMinor: number
  /** İade sonrası ödemenin toplam iade edilmiş tutarı */
  totalRefundedMinor: number
  paymentStatus: PaymentStatus
  orderRefunded: boolean
  errorMessage?: string | null
}

/** Bir ödemenin daha ne kadarı iade edilebilir? */
export function refundableMinor(p: { amountMinor: number; refundedMinor: number }): number {
  return Math.max(0, p.amountMinor - p.refundedMinor)
}

export async function createRefund(input: RefundRequestInput): Promise<RefundOutcome> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new RefundError('INVALID_REFUND_AMOUNT', 'İade tutarı sıfırdan büyük olmalıdır.', 400)
  }

  // Aynı anahtarla ikinci talep → ilk sonucu döndür
  const existingRefund = await db.refund.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: {
      id: true,
      status: true,
      amountMinor: true,
      payment: { select: { status: true, refundedMinor: true } },
    },
  })
  if (existingRefund) {
    return {
      refundId: existingRefund.id,
      status: existingRefund.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
      amountMinor: existingRefund.amountMinor,
      totalRefundedMinor: existingRefund.payment.refundedMinor,
      paymentStatus: existingRefund.payment.status as PaymentStatus,
      orderRefunded: false,
    }
  }

  const order = await db.order.findUnique({
    where: { orderNo: input.orderNo },
    select: { id: true, orderNo: true, status: true, totalMinor: true },
  })
  if (!order) throw new RefundError('ORDER_NOT_FOUND', 'Sipariş bulunamadı.', 404)

  const payment = await db.payment.findFirst({
    where: { orderId: order.id, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } },
    orderBy: { capturedAt: 'desc' },
    select: {
      id: true,
      provider: true,
      providerRef: true,
      providerTxnId: true,
      status: true,
      amountMinor: true,
      refundedMinor: true,
      currency: true,
    },
  })
  if (!payment) {
    throw new RefundError(
      'NO_CAPTURED_PAYMENT',
      'Bu siparişte iade edilebilecek tahsil edilmiş ödeme yok.',
      409,
    )
  }

  // --- ÜST SINIR: iade toplamı ödeme tutarını AŞAMAZ ------------------------
  const available = refundableMinor(payment)
  if (input.amountMinor > available) {
    throw new RefundError(
      'REFUND_EXCEEDS_PAYMENT',
      `İade tutarı kalan iade edilebilir tutarı (${(available / 100).toFixed(2)} ₺) aşamaz.`,
      400,
    )
  }
  // İkinci kapı: sipariş toplamını da aşamaz.
  if (payment.refundedMinor + input.amountMinor > order.totalMinor) {
    throw new RefundError(
      'REFUND_EXCEEDS_ORDER',
      'Toplam iade sipariş tutarını aşamaz.',
      400,
    )
  }

  const refund = await db.refund.create({
    data: {
      orderId: order.id,
      paymentId: payment.id,
      amountMinor: input.amountMinor,
      reason: input.reason.slice(0, 500),
      status: 'APPROVED',
      requestedById: input.requestedById,
      idempotencyKey: input.idempotencyKey,
    },
    select: { id: true },
  })

  await recordPaymentEvent({
    paymentId: payment.id,
    provider: payment.provider,
    providerEventId: `${refund.id}:REFUND_CREATED`,
    eventType: 'REFUND_CREATED',
    signatureValid: true,
    payload: { amountMinor: input.amountMinor, reason: input.reason.slice(0, 200) },
  })

  // --- Sağlayıcı üzerinden iade ---------------------------------------------
  const provider = getProvider(payment.provider)
  const result = await provider
    .refundPayment({
      providerRef: payment.providerRef ?? '',
      providerTxnId: payment.providerTxnId,
      amountMinor: input.amountMinor,
      currency: 'TRY',
      reason: input.reason.slice(0, 200),
      refundRef: refund.id,
      buyerIp: input.ip,
    })
    .catch((err: unknown) => ({
      ok: false as const,
      errorCode: 'PROVIDER_UNAVAILABLE',
      errorMessage: (err as Error).message,
    }))

  if (!result.ok) {
    await db.refund.update({
      where: { id: refund.id },
      data: {
        status: 'FAILED',
        providerStatus: 'failed',
        failureMessage: result.errorMessage?.slice(0, 300) ?? 'İade reddedildi.',
      },
    })
    await recordPaymentEvent({
      paymentId: payment.id,
      provider: payment.provider,
      providerEventId: `${refund.id}:REFUND_FAILED`,
      eventType: 'REFUND_FAILED',
      signatureValid: true,
      payload: { errorCode: result.errorCode ?? null },
    })
    return {
      refundId: refund.id,
      status: 'FAILED',
      amountMinor: input.amountMinor,
      // ⚠️ refundedMinor ARTMADI — başarısız iade tutarı düşmez.
      totalRefundedMinor: payment.refundedMinor,
      paymentStatus: payment.status as PaymentStatus,
      orderRefunded: false,
      errorMessage: result.errorMessage ?? 'İade işlemi reddedildi.',
    }
  }

  // --- Başarılı: kilit altında toplamı güncelle ------------------------------
  const applied = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: PaymentStatus; refundedMinor: number; amountMinor: number }>
    >`SELECT id, status, "refundedMinor", "amountMinor" FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`
    const locked = rows[0]
    if (!locked) throw new RefundError('PAYMENT_NOT_FOUND', 'Ödeme bulunamadı.', 404)

    // Kilit alındıktan sonra sınır YENİDEN kontrol edilir: eşzamanlı ikinci
    // iade araya girmiş olabilir.
    const newTotal = locked.refundedMinor + input.amountMinor
    if (newTotal > locked.amountMinor) {
      throw new RefundError(
        'REFUND_EXCEEDS_PAYMENT',
        'İade tutarı kalan iade edilebilir tutarı aşıyor.',
        409,
      )
    }

    const fullyRefunded = newTotal >= locked.amountMinor
    const nextStatus: PaymentStatus = fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
    assertPaymentTransition(locked.status, nextStatus)

    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedMinor: newTotal, status: nextStatus },
    })

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: 'COMPLETED',
        providerRefundId: result.providerRefundId ?? null,
        providerStatus: result.providerStatus ?? 'success',
        completedAt: new Date(),
      },
    })

    return { newTotal, nextStatus, fullyRefunded }
  })

  await recordPaymentEvent({
    paymentId: payment.id,
    provider: payment.provider,
    providerEventId: `${refund.id}:REFUND_SUCCESS`,
    eventType: 'REFUND_SUCCESS',
    signatureValid: true,
    payload: { amountMinor: input.amountMinor, totalRefundedMinor: applied.newTotal },
  })

  // --- Sipariş durumu: tam iade siparişi REFUNDED yapar ---------------------
  let orderRefunded = false
  if (applied.fullyRefunded) {
    try {
      await transitionOrder({
        orderId: order.id,
        to: 'REFUNDED',
        actorType: 'ADMIN',
        actorId: input.requestedById,
        reason: input.reason.slice(0, 200),
        eventType: 'REFUNDED',
      })
      orderRefunded = true
    } catch (err) {
      console.error('[payment.refund] sipariş güncellenemedi:', (err as Error).message)
    }
  } else {
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'REFUND_REQUESTED',
        message: 'Kısmi iade yapıldı.',
        actorType: 'ADMIN',
        actorId: input.requestedById,
        isCustomerVisible: true,
      },
    })
  }

  await writeAudit({
    actorId: input.requestedById,
    actorIpHash: input.actorIpHash ?? null,
    action: 'payment.refund',
    entityType: 'Refund',
    entityId: refund.id,
    after: {
      orderNo: order.orderNo,
      amountMinor: input.amountMinor,
      totalRefundedMinor: applied.newTotal,
      paymentStatus: applied.nextStatus,
      orderRefunded,
    },
  })

  console.log(
    safeLogLine('payment.refund', {
      orderNo: order.orderNo,
      amountMinor: input.amountMinor,
      total: applied.newTotal,
      status: applied.nextStatus,
    }),
  )

  return {
    refundId: refund.id,
    status: 'COMPLETED',
    amountMinor: input.amountMinor,
    totalRefundedMinor: applied.newTotal,
    paymentStatus: applied.nextStatus,
    orderRefunded,
  }
}

/** Sipariş için iade özeti — admin ekranı ve yetki kontrolü için. */
export async function getRefundSummary(orderNo: string) {
  const order = await db.order.findUnique({
    where: { orderNo },
    select: {
      id: true,
      totalMinor: true,
      payments: {
        select: {
          id: true,
          status: true,
          amountMinor: true,
          refundedMinor: true,
          provider: true,
          capturedAt: true,
        },
        orderBy: { attemptNumber: 'asc' },
      },
      refunds: {
        select: { id: true, amountMinor: true, status: true, reason: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!order) return null

  const settled = order.payments.filter((p) => PAYMENT_SETTLED.has(p.status as PaymentStatus))
  const capturedMinor = settled.reduce((n, p) => n + p.amountMinor, 0)
  const refundedMinor = settled.reduce((n, p) => n + p.refundedMinor, 0)

  return {
    orderTotalMinor: order.totalMinor,
    capturedMinor,
    refundedMinor,
    refundableMinor: Math.max(0, capturedMinor - refundedMinor),
    /** ⚠️ Birden fazla başarılı ödeme = mutabakat gerektiren anormallik */
    settledPaymentCount: settled.length,
    needsReconciliation: settled.length > 1,
    payments: order.payments,
    refunds: order.refunds,
  }
}
