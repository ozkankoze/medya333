import 'server-only'

import { db } from '@/server/db'
import { redactProviderPayload } from './redact'

/**
 * ÖDEME OLAYLARI
 *
 * Her anlamlı ödeme hareketi PaymentEvent'e düşer. Bu tablo hem denetim
 * kaydı hem de TEKRAR KORUMASIDIR: `@@unique([provider, providerEventId])`
 * sayesinde aynı bildirim ikinci kez yazılamaz.
 *
 * ⚠️ Payload her zaman `redactProviderPayload`'dan geçer. Kart numarası,
 * CVV, merchant secret veya imza girdisi buraya YAZILAMAZ.
 */

export const PAYMENT_EVENT_TYPES = [
  'PAYMENT_CREATED',
  'CHECKOUT_STARTED',
  'REDIRECTED',
  'WEBHOOK_RECEIVED',
  'WEBHOOK_VERIFIED',
  'WEBHOOK_REJECTED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'PAYMENT_CANCELLED',
  'REFUND_CREATED',
  'REFUND_SUCCESS',
  'REFUND_FAILED',
] as const

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number]

export interface RecordPaymentEventInput {
  paymentId: string | null
  provider: string
  providerEventId: string
  eventType: PaymentEventType
  signatureValid: boolean
  payload: unknown
  processingError?: string | null
  /** Transaction içinde çağrılırsa tx client'ı geçilir */
  tx?: {
    paymentEvent: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>
    }
  }
}

/**
 * Olay yazar. Aynı `(provider, providerEventId)` ikinci kez gelirse
 * `false` döner — çağıran bunu "zaten işlenmiş" olarak yorumlar.
 *
 * Olay yazımı ASLA ana işlemi düşürmez (transaction dışında çağrıldığında).
 */
export async function recordPaymentEvent(input: RecordPaymentEventInput): Promise<boolean> {
  const data = {
    paymentId: input.paymentId,
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    signatureValid: input.signatureValid,
    payload: redactProviderPayload(input.payload) as never,
    processedAt: new Date(),
    processingError: input.processingError ?? null,
  }

  try {
    if (input.tx) {
      await input.tx.paymentEvent.create({ data })
    } else {
      await db.paymentEvent.create({ data })
    }
    return true
  } catch (err) {
    // P2002 = unique ihlali → aynı olay daha önce kaydedilmiş
    if ((err as { code?: string }).code === 'P2002') return false
    if (input.tx) throw err // transaction içinde yutulmaz
    console.error('[payment.event] yazılamadı:', (err as Error).message)
    return false
  }
}

/** Aynı sağlayıcı olayı daha önce işlendi mi? */
export async function hasProcessedEvent(
  provider: string,
  providerEventId: string,
): Promise<boolean> {
  const found = await db.paymentEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId } },
    select: { id: true },
  })
  return Boolean(found)
}
