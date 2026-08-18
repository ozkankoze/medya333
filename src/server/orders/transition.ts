import 'server-only'

import type { OrderEventType, OrderStatus } from '@/lib/enums'
import { assertTransition, FULFILLMENT_ALLOWED_FROM, InvalidTransitionError } from '@/lib/orders/transitions'
import { ORDER_STATUS_META } from '@/lib/orders/status'
import { db } from '@/server/db'

/**
 * DURUM GEÇİŞİ — TEK YAZMA NOKTASI
 *
 * `order.status = x` ataması başka HİÇBİR YERDE yapılmaz. Bu fonksiyon:
 *   • Satırı `FOR UPDATE` ile kilitler (callback + webhook yarışı)
 *   • Aynı duruma geçişi idempotent no-op yapar
 *   • İzinli geçiş tablosunu uygular (lib/orders/transitions.ts)
 *   • FULFILLMENT KAPISINI uygular: ödeme alınmadan işleme alınamaz
 *   • Durum değişimi + OrderEvent'i AYNI transaction'da yazar
 */

export class FulfillmentBeforePaymentError extends Error {
  readonly code = 'FULFILLMENT_BEFORE_PAYMENT'
  constructor(from: OrderStatus, to: OrderStatus) {
    super(
      `Ödeme alınmadan fulfillment başlatılamaz (${from} → ${to}). ` +
        'Siparişin önce PAID durumuna geçmesi gerekir.',
    )
    this.name = 'FulfillmentBeforePaymentError'
  }
}

export class OrderNotFoundError extends Error {
  readonly code = 'ORDER_NOT_FOUND'
  constructor() {
    super('Sipariş bulunamadı.')
  }
}

export type ActorType = 'SYSTEM' | 'CUSTOMER' | 'ADMIN' | 'WEBHOOK'

export interface TransitionInput {
  orderId: string
  to: OrderStatus
  actorType: ActorType
  actorId?: string | null
  reason?: string | null
  /** Ek olay tipi — durum değişimine eşlik eden anlamlı olay */
  eventType?: OrderEventType
}

/** Fulfillment sayılan durumlar — ödeme öncesi bunlara geçilemez. */
const FULFILLMENT_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PROCESSING',
  'STARTED',
  'IN_PROGRESS',
  'PARTIAL',
  'COMPLETED',
])

function sideEffectsFor(to: OrderStatus): Record<string, Date> {
  const now = new Date()
  switch (to) {
    case 'PAID':
      return { paidAt: now }
    case 'PROCESSING':
      return { processingAt: now }
    case 'STARTED':
      return { startedAt: now }
    case 'COMPLETED':
      return { completedAt: now }
    case 'CANCELLED':
      return { cancelledAt: now }
    case 'REFUNDED':
      return { refundedAt: now }
    default:
      return {}
  }
}

export async function transitionOrder(input: TransitionInput) {
  return db.$transaction(async (tx) => {
    // 1) Satırı kilitle — eşzamanlı callback/webhook çift işlemesin
    const rows = await tx.$queryRaw<Array<{ id: string; status: OrderStatus }>>`
      SELECT id, status FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`
    const current = rows[0]
    if (!current) throw new OrderNotFoundError()

    // 2) Aynı duruma geçiş = idempotent no-op
    if (current.status === input.to) {
      return tx.order.findUniqueOrThrow({ where: { id: input.orderId } })
    }

    // 3) FULFILLMENT KAPISI — ödeme alınmadan işleme alma engellenir.
    //    Geçiş tablosu zaten PENDING_PAYMENT → PROCESSING'i yasaklıyor;
    //    bu ikinci kapı, tabloya yeni bir yol eklenirse bile korur.
    if (FULFILLMENT_STATUSES.has(input.to) && !FULFILLMENT_ALLOWED_FROM.has(current.status)) {
      throw new FulfillmentBeforePaymentError(current.status, input.to)
    }

    // 4) İzinli geçiş kontrolü
    assertTransition(current.status, input.to)

    // 5) Güncelle + olay yaz (aynı transaction)
    const updated = await tx.order.update({
      where: { id: input.orderId },
      data: { status: input.to, ...sideEffectsFor(input.to) },
    })

    await tx.orderItem.updateMany({
      where: { orderId: input.orderId },
      data: { status: input.to },
    })

    await tx.orderEvent.create({
      data: {
        orderId: input.orderId,
        type: input.eventType ?? 'STATUS_CHANGED',
        fromStatus: current.status,
        toStatus: input.to,
        message: input.reason ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        isCustomerVisible: ORDER_STATUS_META[input.to].customerVisible,
      },
    })

    return updated
  })
}

export { InvalidTransitionError }
