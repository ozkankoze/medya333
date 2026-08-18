import 'server-only'

import type { FulfillmentStatus } from '@/lib/enums'
import { AUTO_CREATABLE_STATUSES, computeGuaranteeEnd } from '@/lib/fulfillment/status'
import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'

/**
 * FULFILLMENT OLUŞTURMA — otomatik yarı
 *
 * Doğrulanmış ödeme (Payment CAPTURED → Order PAID) geldiğinde:
 *   1. Sipariş OTOMATİK onaylanır      → OrderEvent ORDER_CONFIRMED
 *   2. Fulfillment kaydı açılır        → status READY
 *   3. Operasyon kuyruğuna düşer
 *
 * ⚠️ BURADA DURULUR. Sistem işe BAŞLAMAZ.
 * `READY → PROCESSING → STARTED → COMPLETED` zincirinin tamamı manuel
 * operatör aksiyonudur (bkz. server/fulfillment/operate.ts).
 *
 * ⚠️ IDEMPOTENT: `Fulfillment.orderId` UNIQUE. Aynı webhook tekrar gelse de
 * ikinci fulfillment açılmaz; mevcut kayıt döndürülür ve durumu DEĞİŞTİRİLMEZ
 * (yeniden başlatma olmaz).
 */

export class FulfillmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'FulfillmentError'
  }
}

export interface EnsureFulfillmentResult {
  fulfillmentId: string
  status: FulfillmentStatus
  /** Bu çağrıda mı oluşturuldu? Tekrar çağrılarda false. */
  created: boolean
}

/** Fulfillment'ın hedef anlık görüntüsü — katalog sonradan değişse bile sabit. */
export interface TargetSnapshot {
  orderNo: string
  platformName: string
  platformSlug: string
  serviceName: string
  serviceSlug: string
  variantLabel: string
  unitLabel: string
  measurementMode: string
  targetHandle: string | null
  targetNormalized: string
  targetCanonicalUrl: string | null
  targetType: string
  quantity: number
}

/**
 * Ödenmiş sipariş için fulfillment kaydını garantiler.
 *
 * Sipariş PAID değilse HİÇBİR ŞEY YAPMAZ — ödenmemiş sipariş operasyon
 * kuyruğuna giremez (Faz 4 kuralı 30).
 */
export async function ensureFulfillmentForPaidOrder(
  orderId: string,
): Promise<EnsureFulfillmentResult | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      quantity: true,
      paidAt: true,
      platform: { select: { name: true, slug: true } },
      service: { select: { name: true, slug: true, unitLabel: true, measurementMode: true } },
      serviceVariant: { select: { customerLabel: true, refillDays: true } },
      target: {
        select: { handle: true, normalized: true, canonicalUrl: true, targetType: true },
      },
      fulfillment: { select: { id: true, status: true } },
    },
  })
  if (!order) return null

  // ⚠️ ÖDENMEMİŞ SİPARİŞ FULFILLMENT AÇAMAZ.
  // PAID ve sonrası (PROCESSING/STARTED/…) kabul edilir; DRAFT,
  // PENDING_PAYMENT, CANCELLED, FAILED kabul EDİLMEZ.
  const payableStatuses = new Set([
    'PAID',
    'PROCESSING',
    'STARTED',
    'IN_PROGRESS',
    'PARTIAL',
    'COMPLETED',
  ])
  if (!payableStatuses.has(order.status)) return null

  // ⚠️ Zaten varsa DOKUNULMAZ. Tekrar gelen webhook işi yeniden başlatamaz.
  if (order.fulfillment) {
    return {
      fulfillmentId: order.fulfillment.id,
      status: order.fulfillment.status as FulfillmentStatus,
      created: false,
    }
  }

  const snapshot: TargetSnapshot = {
    orderNo: order.orderNo,
    platformName: order.platform.name,
    platformSlug: order.platform.slug,
    serviceName: order.service.name,
    serviceSlug: order.service.slug,
    variantLabel: order.serviceVariant.customerLabel,
    unitLabel: order.service.unitLabel,
    measurementMode: order.service.measurementMode,
    targetHandle: order.target.handle,
    targetNormalized: order.target.normalized,
    targetCanonicalUrl: order.target.canonicalUrl,
    targetType: order.target.targetType,
    quantity: order.quantity,
  }

  const guaranteeDays = order.serviceVariant.refillDays ?? null
  // Garanti, işin tamamlandığı andan itibaren işler. Burada yalnızca gün
  // sayısı snapshot'lanır; `guaranteeEndsAt` COMPLETED anında hesaplanır.

  const startStatus: FulfillmentStatus = 'READY'
  // Kod düzeyinde bir güvence: sistem yalnızca READY üretebilir.
  if (!AUTO_CREATABLE_STATUSES.has(startStatus)) {
    throw new FulfillmentError(
      'AUTOMATION_NOT_ALLOWED',
      'Sistem yalnızca READY durumunda fulfillment oluşturabilir.',
      500,
    )
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const fulfillment = await tx.fulfillment.create({
        data: {
          orderId: order.id,
          status: startStatus,
          targetSnapshot: snapshot as never,
          requestedQuantity: order.quantity,
          deliveredQuantity: 0,
          guaranteeDays,
        },
        select: { id: true, status: true },
      })

      await tx.fulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          type: 'CREATED',
          // actorUserId null: bu adım SİSTEM tarafından yapılır ve
          // yalnızca READY üretebilir.
          toStatus: startStatus,
          note: 'Ödeme doğrulandı, sipariş onaylandı ve işlem sırasına alındı.',
          isCustomerVisible: true,
        },
      })

      // Sipariş OTOMATİK onaylandı — durum değişmez, olay düşer.
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'ORDER_CONFIRMED',
          message: 'Siparişiniz onaylandı ve işlem sırasına alındı.',
          actorType: 'SYSTEM',
          isCustomerVisible: true,
        },
      })

      return fulfillment
    })

    await writeAudit({
      actorId: null,
      action: 'fulfillment.create',
      entityType: 'Fulfillment',
      entityId: result.id,
      after: {
        orderNo: order.orderNo,
        status: result.status,
        requestedQuantity: order.quantity,
        guaranteeDays,
      },
    })

    return {
      fulfillmentId: result.id,
      status: result.status as FulfillmentStatus,
      created: true,
    }
  } catch (err) {
    // P2002 = orderId unique ihlali → eşzamanlı ikinci webhook araya girdi.
    // Bu bir hata değil; idempotency tam olarak böyle çalışmalı.
    if ((err as { code?: string }).code === 'P2002') {
      const existing = await db.fulfillment.findUnique({
        where: { orderId: order.id },
        select: { id: true, status: true },
      })
      if (existing) {
        return {
          fulfillmentId: existing.id,
          status: existing.status as FulfillmentStatus,
          created: false,
        }
      }
    }
    throw err
  }
}

/** COMPLETED anında garanti bitişini hesaplar. */
export function guaranteeEndFor(
  completedAt: Date,
  guaranteeDays: number | null,
): Date | null {
  return computeGuaranteeEnd(completedAt, guaranteeDays)
}
