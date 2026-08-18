import 'server-only'

import type { OrderStatus, PaymentStatus } from '@/lib/enums'
import {
  assertPaymentTransition,
  InvalidPaymentTransitionError,
  isNoOpTransition,
  PAYMENT_SETTLED,
  unlocksOrder,
} from '@/lib/payments/status'
import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'
import { orderStatusChangedEmail, sendMail } from '@/server/mail'
import { ensureFulfillmentForPaidOrder } from '@/server/fulfillment/create'
import { transitionOrder } from '@/server/orders/transition'
import { recordPaymentEvent } from './events'
import { getProvider } from './registry'
import { safeLogLine } from './redact'
import type { NormalizedWebhook, RawWebhookRequest } from './types'

/**
 * WEBHOOK İŞLEME — ödemenin TEK OTORİTESİ
 *
 * Tarayıcının success URL'ine dönmesi ödeme kanıtı DEĞİLDİR. Sipariş yalnızca
 * burada, doğrulanmış sunucudan-sunucuya bildirimle PAID olur.
 *
 * ON ADIMLI DOĞRULAMA (Faz 3 kuralı 6):
 *   1. İmza/hash doğrula            → geçersizse ödeme BAŞARILI SAYILMAZ
 *   2. Sağlayıcı işlem kimliği      → olay kimliği ile tekrar kontrolü
 *   3. Merchant/order referansı     → providerRef ile Payment bulunur
 *   4. Tutar doğrula                → Payment.amountMinor (Order.totalMinor snapshot'ı)
 *   5. Para birimi doğrula          → TRY
 *   6. Payment doğru sağlayıcıya mı ait
 *   7. Durum geçişi geçerli mi
 *   8. Tek transaction + satır kilidi
 *   9. PaymentEvent
 *  10. OrderEvent + Order durumu
 *
 * YARIŞ DURUMLARI:
 *   • Aynı bildirim iki kez / iki sunucu örneği → `SELECT … FOR UPDATE` +
 *     PaymentEvent üzerindeki unique kısıt. İkinci işleyici no-op görür.
 *   • Success redirect + webhook aynı anda → redirect hiçbir şey yazmaz,
 *     yalnızca okur. Tek yazar burasıdır.
 *   • Webhook + refund aynı anda → ikisi de aynı Payment satırını kilitler,
 *     sıraya girerler; geçiş tablosu tutarsız sonucu reddeder.
 */

export type WebhookOutcome =
  | 'PROCESSED'
  | 'DUPLICATE'
  | 'INVALID_SIGNATURE'
  | 'PAYMENT_NOT_FOUND'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'PROVIDER_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'IGNORED'

export interface WebhookResult {
  outcome: WebhookOutcome
  /** Sağlayıcıya döndürülecek HTTP cevabı — biçimi sağlayıcı belirler */
  ack: NormalizedWebhook['ack']
  paymentId?: string | null
  orderNo?: string | null
}

/** Sağlayıcı bildirimini uçtan uca işler. ASLA throw etmez. */
export async function processWebhook(
  providerKey: string,
  req: RawWebhookRequest,
): Promise<WebhookResult> {
  let provider
  try {
    provider = getProvider(providerKey)
  } catch {
    return {
      outcome: 'IGNORED',
      ack: { status: 404, body: 'unknown provider', contentType: 'text/plain' },
    }
  }

  let hook: NormalizedWebhook
  try {
    hook = await provider.handleWebhook(req)
  } catch (err) {
    console.error(`[payment.webhook.${providerKey}] ayrıştırılamadı:`, (err as Error).message)
    return {
      outcome: 'IGNORED',
      ack: { status: 400, body: 'bad request', contentType: 'text/plain' },
    }
  }

  // --- Her bildirim, işlenmese bile kaydedilir (denetim izi) ----------------
  const firstWrite = await recordPaymentEvent({
    paymentId: null,
    provider: providerKey,
    providerEventId: hook.providerEventId,
    eventType: hook.signatureValid ? 'WEBHOOK_VERIFIED' : 'WEBHOOK_REJECTED',
    signatureValid: hook.signatureValid,
    payload: hook.safePayload,
  })

  // --- 2) TEKRAR / REPLAY: aynı olay kimliği daha önce yazıldıysa ------------
  if (!firstWrite) {
    console.log(
      safeLogLine('payment.webhook', {
        provider: providerKey,
        event: hook.providerEventId,
        outcome: 'duplicate',
      }),
    )
    return { outcome: 'DUPLICATE', ack: hook.ack }
  }

  // --- 1) İMZA -------------------------------------------------------------
  if (!hook.signatureValid) {
    console.error(
      safeLogLine('payment.webhook', {
        provider: providerKey,
        event: hook.providerEventId,
        outcome: 'invalid_signature',
      }),
    )
    // ⚠️ Sağlayıcıya yine de ack döneriz (PayTR "OK" almazsa saatlerce
    // tekrar gönderir). Ödeme İŞLENMEZ; olay reddedilmiş olarak kayıtlıdır.
    return { outcome: 'INVALID_SIGNATURE', ack: hook.ack }
  }

  // --- 3) Payment'ı bul ------------------------------------------------------
  if (!hook.providerRef) {
    return { outcome: 'PAYMENT_NOT_FOUND', ack: hook.ack }
  }

  const payment = await db.payment.findUnique({
    where: { providerRef: hook.providerRef },
    select: {
      id: true,
      orderId: true,
      provider: true,
      status: true,
      amountMinor: true,
      currency: true,
      orderNoSnapshot: true,
      checkoutToken: true,
      providerTxnId: true,
    },
  })

  if (!payment) {
    console.error(
      safeLogLine('payment.webhook', {
        provider: providerKey,
        ref: hook.providerRef,
        outcome: 'payment_not_found',
      }),
    )
    return { outcome: 'PAYMENT_NOT_FOUND', ack: hook.ack }
  }

  // --- 6) Payment doğru sağlayıcıya mı ait? ---------------------------------
  if (payment.provider !== providerKey) {
    console.error(
      safeLogLine('payment.webhook', {
        provider: providerKey,
        expected: payment.provider,
        ref: hook.providerRef,
        outcome: 'provider_mismatch',
      }),
    )
    await markProcessingError(providerKey, hook.providerEventId, payment.id, 'provider_mismatch')
    return { outcome: 'PROVIDER_MISMATCH', ack: hook.ack, paymentId: payment.id }
  }

  /**
   * --- 4-5) TUTAR ve PARA BİRİMİ ------------------------------------------
   *
   * Bildirim tutar taşıyorsa (PayTR) doğrudan karşılaştırılır.
   * Taşımıyorsa (iyzico) sağlayıcıya SORULUR — "bildirim geldi" tek başına
   * paranın alındığı anlamına gelmez.
   */
  let effectiveStatus: PaymentStatus = hook.status
  let amountMinor = hook.amountMinor
  let currency = hook.currency
  let providerTxnId = hook.providerTxnId ?? payment.providerTxnId

  if (amountMinor == null && hook.status === 'CAPTURED') {
    const verified = await provider
      .getPaymentStatus({
        providerRef: hook.providerRef,
        providerTxnId: hook.providerTxnId ?? payment.providerTxnId,
        checkoutToken: payment.checkoutToken,
      })
      .catch((err: unknown) => {
        console.error('[payment.webhook] durum sorgulanamadı:', (err as Error).message)
        return null
      })

    if (!verified?.ok) {
      // Doğrulanamadıysa BAŞARILI SAYILMAZ. Sağlayıcı tekrar gönderecek.
      await markProcessingError(
        providerKey,
        hook.providerEventId,
        payment.id,
        'verification_failed',
      )
      return { outcome: 'IGNORED', ack: hook.ack, paymentId: payment.id }
    }
    effectiveStatus = verified.status
    amountMinor = verified.amountMinor ?? null
    currency = verified.currency ?? null
    providerTxnId = verified.providerTxnId ?? providerTxnId
  }

  // Başarı iddiası varsa tutar ve para birimi ZORUNLU olarak eşleşmeli.
  if (effectiveStatus === 'CAPTURED') {
    if (amountMinor == null || amountMinor !== payment.amountMinor) {
      console.error(
        safeLogLine('payment.webhook', {
          provider: providerKey,
          ref: hook.providerRef,
          expected: payment.amountMinor,
          received: amountMinor,
          outcome: 'amount_mismatch',
        }),
      )
      await markProcessingError(providerKey, hook.providerEventId, payment.id, 'amount_mismatch')
      await writeAudit({
        actorId: null,
        action: 'payment.amount_mismatch',
        entityType: 'Payment',
        entityId: payment.id,
        after: { expected: payment.amountMinor, received: amountMinor, provider: providerKey },
      })
      return { outcome: 'AMOUNT_MISMATCH', ack: hook.ack, paymentId: payment.id }
    }

    const normalizedCurrency = currency === 'TL' ? 'TRY' : currency
    if (normalizedCurrency && normalizedCurrency !== payment.currency) {
      await markProcessingError(providerKey, hook.providerEventId, payment.id, 'currency_mismatch')
      return { outcome: 'CURRENCY_MISMATCH', ack: hook.ack, paymentId: payment.id }
    }
  }

  // --- 7-10) Tek transaction, satır kilidiyle -------------------------------
  const current = payment.status as PaymentStatus

  // Idempotent no-op: aynı duruma tekrar geçiş hata değildir.
  if (isNoOpTransition(current, effectiveStatus)) {
    await attachEvent(providerKey, hook.providerEventId, payment.id)
    return {
      outcome: 'DUPLICATE',
      ack: hook.ack,
      paymentId: payment.id,
      orderNo: payment.orderNoSnapshot,
    }
  }

  // Tahsil edilmiş bir ödemeyi geç gelen bildirim geri alamaz.
  if (PAYMENT_SETTLED.has(current) && effectiveStatus === 'FAILED') {
    await markProcessingError(providerKey, hook.providerEventId, payment.id, 'late_failure_ignored')
    return { outcome: 'IGNORED', ack: hook.ack, paymentId: payment.id }
  }

  try {
    assertPaymentTransition(current, effectiveStatus)
  } catch (err) {
    if (err instanceof InvalidPaymentTransitionError) {
      await markProcessingError(
        providerKey,
        hook.providerEventId,
        payment.id,
        `invalid_transition:${current}->${effectiveStatus}`,
      )
      return { outcome: 'INVALID_TRANSITION', ack: hook.ack, paymentId: payment.id }
    }
    throw err
  }

  const captured = effectiveStatus === 'CAPTURED'

  await db.$transaction(async (tx) => {
    // Satır kilidi: iki webhook aynı anda gelirse ikincisi burada bekler,
    // sonra güncel durumu görür ve no-op'a düşer.
    const rows = await tx.$queryRaw<Array<{ id: string; status: PaymentStatus }>>`
      SELECT id, status FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`
    const locked = rows[0]
    if (!locked) return
    if (locked.status !== current) return // başka bir işleyici öne geçti

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: effectiveStatus,
        providerTxnId,
        ...(captured ? { capturedAt: new Date() } : {}),
        ...(hook.card
          ? {
              cardBrand: hook.card.brand ?? null,
              cardLast4: hook.card.last4 ?? null,
              cardBankName: hook.card.bankName ?? null,
            }
          : {}),
        ...(hook.installment ? { installment: hook.installment } : {}),
        ...(effectiveStatus === 'FAILED'
          ? { failureCode: hook.errorCode ?? null, failureMessage: hook.errorMessage ?? null }
          : {}),
        rawResultPayload: hook.safePayload as never,
      },
    })

    await tx.paymentEvent.updateMany({
      where: { provider: providerKey, providerEventId: hook.providerEventId },
      data: {
        paymentId: payment.id,
        eventType: captured ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
        processedAt: new Date(),
      },
    })
  })

  // --- Sipariş durumu: YALNIZCA tahsil edilmiş ödeme PAID yapar -------------
  let orderPaid = false
  if (captured && unlocksOrder(effectiveStatus)) {
    try {
      await transitionOrder({
        orderId: payment.orderId,
        to: 'PAID',
        actorType: 'WEBHOOK',
        reason: `${providerKey} ödemesi doğrulandı.`,
        eventType: 'PAYMENT_RECEIVED',
      })
      orderPaid = true

      /**
       * ⚠️ OTOMATİK KISIM BURADA BİTER.
       * Sipariş onaylanır ve fulfillment READY olarak kuyruğa düşer.
       * Sistem işe BAŞLAMAZ: READY → PROCESSING → STARTED → COMPLETED
       * zincirinin tamamı manuel operatör aksiyonudur.
       *
       * Idempotent: `Fulfillment.orderId` UNIQUE olduğu için tekrar gelen
       * bildirim ikinci fulfillment açamaz ve mevcut işi YENİDEN BAŞLATMAZ.
       */
      await ensureFulfillmentForPaidOrder(payment.orderId).catch((e: unknown) => {
        // Fulfillment açılamazsa ödeme geçersiz olmaz; operasyon audit'ten görür.
        console.error('[payment.webhook] fulfillment açılamadı:', (e as Error).message)
        return null
      })
    } catch (err) {
      // Sipariş zaten PAID ise transitionOrder no-op'tur; başka bir hata
      // ödemeyi geçersiz kılmaz — operasyon audit'ten görür.
      console.error('[payment.webhook] sipariş güncellenemedi:', (err as Error).message)
    }
  } else if (effectiveStatus === 'FAILED') {
    // ⚠️ Sipariş PENDING_PAYMENT KALIR — kullanıcı tekrar deneyebilsin.
    await db.orderEvent.create({
      data: {
        orderId: payment.orderId,
        type: 'PAYMENT_FAILED',
        message: 'Ödeme tamamlanamadı. Tekrar deneyebilirsiniz.',
        actorType: 'SYSTEM',
        isCustomerVisible: true,
      },
    })
  }

  await writeAudit({
    actorId: null,
    action: captured ? 'payment.captured' : 'payment.failed',
    entityType: 'Payment',
    entityId: payment.id,
    before: { status: current },
    after: {
      status: effectiveStatus,
      provider: providerKey,
      amountMinor: payment.amountMinor,
      orderPaid,
    },
  })

  console.log(
    safeLogLine('payment.webhook', {
      provider: providerKey,
      ref: hook.providerRef,
      from: current,
      to: effectiveStatus,
      orderPaid,
    }),
  )

  if (captured) await notifyCustomer(payment.orderId)

  return {
    outcome: 'PROCESSED',
    ack: hook.ack,
    paymentId: payment.id,
    orderNo: payment.orderNoSnapshot,
  }
}

async function attachEvent(provider: string, providerEventId: string, paymentId: string) {
  await db.paymentEvent
    .updateMany({ where: { provider, providerEventId }, data: { paymentId } })
    .catch(() => undefined)
}

async function markProcessingError(
  provider: string,
  providerEventId: string,
  paymentId: string | null,
  reason: string,
) {
  await db.paymentEvent
    .updateMany({
      where: { provider, providerEventId },
      data: { paymentId, processingError: reason, processedAt: new Date() },
    })
    .catch(() => undefined)
}

/** Ödeme alındı e-postası — gönderim asla akışı düşürmez. */
async function notifyCustomer(orderId: string) {
  const order = await db.order
    .findUnique({
      where: { id: orderId },
      select: {
        orderNo: true,
        status: true,
        quantity: true,
        totalMinor: true,
        customerEmail: true,
        guestEmail: true,
        platform: { select: { name: true } },
        service: { select: { name: true, unitLabel: true } },
        serviceVariant: { select: { customerLabel: true } },
        target: { select: { handle: true, normalized: true } },
      },
    })
    .catch(() => null)

  const email = order?.customerEmail ?? order?.guestEmail
  if (!order || !email) return

  await sendMail(
    orderStatusChangedEmail({
      orderNo: order.orderNo,
      email,
      platformName: order.platform.name,
      serviceName: order.service.name,
      variantLabel: order.serviceVariant.customerLabel,
      quantity: order.quantity,
      unitLabel: order.service.unitLabel,
      totalMinor: order.totalMinor,
      targetHandle: order.target.handle ?? order.target.normalized,
      status: order.status as OrderStatus,
      trackingToken: null,
    }),
  )
}
