import 'server-only'

import type { ReplacementStatus, UserRole } from '@/lib/enums'
import { ROLE_LEVEL } from '@/lib/enums'
import { isWithinGuarantee } from '@/lib/fulfillment/status'
import { writeAudit } from '@/server/audit'
import { notifyOrderEvent } from '@/server/notifications'
import { db } from '@/server/db'
import { FulfillmentError } from './create'
import { FulfillmentAccessError, type Actor } from './operate'

/**
 * GARANTİ / TELAFİ (ReplacementCase)
 *
 * ⚠️ TAMAMEN MANUEL. Sistem düşüş tespit edip kendiliğinden telafi BAŞLATMAZ.
 * Operatör düşüşü görür, vaka açar; yönetici onaylar; operasyon manuel yürür.
 *
 * Akış:
 *   DROP_DETECTED → REVIEW_REQUIRED → APPROVED → REPLACEMENT_PROCESSING → COMPLETED
 *   (herhangi bir noktada REJECTED)
 *
 * Garanti süresi `ServiceVariant.refillDays` snapshot'ından gelir ve
 * fulfillment TAMAMLANDIĞI anda başlar. Süre dolduktan sonra vaka açılamaz.
 */

export const REPLACEMENT_TRANSITIONS: Record<ReplacementStatus, readonly ReplacementStatus[]> = {
  DROP_DETECTED: ['REVIEW_REQUIRED', 'REJECTED'],
  REVIEW_REQUIRED: ['APPROVED', 'REJECTED'],
  APPROVED: ['REPLACEMENT_PROCESSING', 'REJECTED'],
  REPLACEMENT_PROCESSING: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
} as const

export function canTransitionReplacement(
  from: ReplacementStatus,
  to: ReplacementStatus,
): boolean {
  return REPLACEMENT_TRANSITIONS[from].includes(to)
}

export interface CreateReplacementInput {
  fulfillmentId: string
  reason: string
  /** Telafi edilecek adet. Teslim edilenden fazla olamaz. */
  replacementQuantity: number
  /** Düşüşün gözlendiği güncel ölçüm */
  currentMetric?: number | null
}

export interface ReplacementResult {
  id: string
  status: ReplacementStatus
  replacementQuantity: number
  droppedQuantity: number | null
}

export async function createReplacementCase(
  input: CreateReplacementInput,
  actor: Actor,
): Promise<ReplacementResult> {
  if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.OPERATOR) throw new FulfillmentAccessError()

  const f = await db.fulfillment.findUnique({
    where: { id: input.fulfillmentId },
    select: {
      id: true,
      status: true,
      deliveredQuantity: true,
      initialMetric: true,
      currentMetric: true,
      guaranteeEndsAt: true,
      assignedToUserId: true,
    },
  })
  if (!f) throw new FulfillmentError('FULFILLMENT_NOT_FOUND', 'Fulfillment bulunamadı.', 404)

  if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.ADMIN && f.assignedToUserId !== actor.userId) {
    throw new FulfillmentAccessError('Bu iş size atanmamış.')
  }

  // Telafi yalnızca tamamlanmış işlerde konuşulur.
  if (f.status !== 'COMPLETED' && f.status !== 'REVIEW_REQUIRED') {
    throw new FulfillmentError(
      'REPLACEMENT_NOT_APPLICABLE',
      'Telafi yalnızca tamamlanmış bir iş için açılabilir.',
      409,
    )
  }

  // ⚠️ GARANTİ SÜRESİ. Bittiyse vaka açılamaz — otomatik uzatma yok.
  if (!isWithinGuarantee(f.guaranteeEndsAt, new Date())) {
    throw new FulfillmentError(
      'GUARANTEE_EXPIRED',
      f.guaranteeEndsAt
        ? 'Bu siparişin garanti süresi dolmuş.'
        : 'Bu hizmet için garanti tanımlı değil.',
      409,
    )
  }

  const qty = Math.trunc(input.replacementQuantity)
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new FulfillmentError('INVALID_QUANTITY', 'Telafi adedi sıfırdan büyük olmalıdır.', 400)
  }
  // ⚠️ Telafi, teslim edilenden fazla olamaz.
  if (qty > f.deliveredQuantity) {
    throw new FulfillmentError(
      'REPLACEMENT_EXCEEDS_DELIVERED',
      `Telafi adedi teslim edilen miktarı (${f.deliveredQuantity}) aşamaz.`,
      400,
    )
  }

  const current = input.currentMetric ?? f.currentMetric
  const dropped =
    current !== null && f.currentMetric !== null ? Math.max(0, f.currentMetric - current) : null

  const created = await db.$transaction(async (tx) => {
    const rc = await tx.replacementCase.create({
      data: {
        fulfillmentId: input.fulfillmentId,
        reason: input.reason.slice(0, 500),
        initialDelivered: f.deliveredQuantity,
        currentMetric: current,
        droppedQuantity: dropped,
        replacementQuantity: qty,
        status: 'DROP_DETECTED',
        createdById: actor.userId,
      },
      select: { id: true, status: true },
    })

    await tx.fulfillmentEvent.create({
      data: {
        fulfillmentId: input.fulfillmentId,
        type: 'REPLACEMENT_CREATED',
        actorUserId: actor.userId,
        quantity: qty,
        currentMetric: current,
        note: input.reason.slice(0, 300),
        isCustomerVisible: false,
      },
    })

    return rc
  })

  await writeAudit({
    actorId: actor.userId,
    actorIpHash: actor.ipHash ?? null,
    action: 'fulfillment.replacement_create',
    entityType: 'ReplacementCase',
    entityId: created.id,
    after: { fulfillmentId: input.fulfillmentId, replacementQuantity: qty, droppedQuantity: dropped },
  })

  return {
    id: created.id,
    status: created.status as ReplacementStatus,
    replacementQuantity: qty,
    droppedQuantity: dropped,
  }
}

const EVENT_FOR_STATUS: Partial<Record<ReplacementStatus, 'REPLACEMENT_APPROVED' | 'REPLACEMENT_STARTED' | 'REPLACEMENT_COMPLETED'>> = {
  APPROVED: 'REPLACEMENT_APPROVED',
  REPLACEMENT_PROCESSING: 'REPLACEMENT_STARTED',
  COMPLETED: 'REPLACEMENT_COMPLETED',
}

/**
 * Telafi vakasını ilerletir. ⚠️ Her adım manuel; otomatik ilerleme YOK.
 * `APPROVED` yalnızca ADMIN+ tarafından verilebilir.
 */
export async function advanceReplacement(
  replacementId: string,
  to: ReplacementStatus,
  actor: Actor,
  note?: string | null,
): Promise<{ id: string; status: ReplacementStatus }> {
  if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.OPERATOR) throw new FulfillmentAccessError()
  if (to === 'APPROVED' && ROLE_LEVEL[actor.role] < ROLE_LEVEL.ADMIN) {
    throw new FulfillmentAccessError('Telafi onayı yalnızca yöneticiler tarafından verilebilir.')
  }

  const updated = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: ReplacementStatus; fulfillmentId: string }>>`
      SELECT id, status, "fulfillmentId" FROM "ReplacementCase" WHERE id = ${replacementId} FOR UPDATE`
    const locked = rows[0]
    if (!locked) throw new FulfillmentError('REPLACEMENT_NOT_FOUND', 'Telafi kaydı bulunamadı.', 404)

    if (locked.status === to) return { ...locked, noop: true as const }

    if (!canTransitionReplacement(locked.status, to)) {
      throw new FulfillmentError(
        'INVALID_REPLACEMENT_TRANSITION',
        `Geçersiz telafi geçişi: ${locked.status} → ${to}`,
        409,
      )
    }

    await tx.replacementCase.update({
      where: { id: replacementId },
      data: {
        status: to,
        ...(to === 'APPROVED' ? { approvedById: actor.userId } : {}),
        ...(to === 'REPLACEMENT_PROCESSING' ? { assignedToUserId: actor.userId } : {}),
        ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
    })

    const eventType = EVENT_FOR_STATUS[to]
    if (eventType) {
      await tx.fulfillmentEvent.create({
        data: {
          fulfillmentId: locked.fulfillmentId,
          type: eventType,
          actorUserId: actor.userId,
          note: note?.slice(0, 300) ?? null,
          isCustomerVisible: to === 'COMPLETED',
        },
      })
    }

    return { ...locked, noop: false as const }
  })

  if (!updated.noop) {
    await writeAudit({
      actorId: actor.userId,
      actorIpHash: actor.ipHash ?? null,
      action: 'fulfillment.replacement_advance',
      entityType: 'ReplacementCase',
      entityId: replacementId,
      before: { status: updated.status },
      after: { status: to },
    })

    /**
     * ⭐ MÜŞTERİ BİLDİRİMİ — yalnızca iki kilometre taşı.
     *
     * Telafi akışının ayrıntısı (DROP_DETECTED, REVIEW_REQUIRED,
     * REPLACEMENT_PROCESSING) İÇ bilgidir ve müşteriye gösterilmez. Müşteriyi
     * ilgilendiren iki an vardır: talebi onaylandı ve telafi tamamlandı.
     *
     * ⚠️ Bunlar için OrderEvent yazılır çünkü bildirim katmanının tek kaynağı
     * OrderEvent'tir. Paralel bir bildirim event sistemi kurulmaz.
     */
    const customerMilestone =
      to === 'APPROVED' ? 'REPLACEMENT_APPROVED' : to === 'COMPLETED' ? 'REPLACEMENT_COMPLETED' : null

    if (customerMilestone) {
      const fulfillment = await db.fulfillment.findUnique({
        where: { id: updated.fulfillmentId },
        select: { orderId: true },
      })
      if (fulfillment) {
        const event = await db.orderEvent.create({
          data: {
            orderId: fulfillment.orderId,
            type: customerMilestone,
            message:
              customerMilestone === 'REPLACEMENT_APPROVED'
                ? 'Telafi talebiniz onaylandı.'
                : 'Telafi işlemi tamamlandı.',
            actorType: 'ADMIN',
            actorId: actor.userId,
            isCustomerVisible: true,
          },
          select: { id: true },
        })
        await notifyOrderEvent(event.id)
      }
    }
  }

  return { id: replacementId, status: to }
}

export function canViewReplacements(role: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL.SUPPORT
}
