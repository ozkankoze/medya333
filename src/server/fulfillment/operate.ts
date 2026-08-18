import 'server-only'

import type { FulfillmentEventType, FulfillmentStatus, UserRole } from '@/lib/enums'
import { ROLE_LEVEL } from '@/lib/enums'
import {
  assertFulfillmentTransition,
  assertManualActor,
  AutomationNotAllowedError,
  computeFulfillmentProgress,
  deliveredFromMetricDelta,
  InvalidFulfillmentTransitionError,
} from '@/lib/fulfillment/status'
import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'
import { transitionOrder } from '@/server/orders/transition'
import { FulfillmentError, guaranteeEndFor } from './create'

/**
 * MANUEL OPERASYON SERVİSLERİ
 *
 * ⚠️ Buradaki HER fonksiyon bir insan aktör (`actor.userId`) ister.
 * Sistem aktörüyle çağrılamazlar — `assertManualActor` bunu zorlar.
 * Webhook, cron veya başka bir otomasyon fulfillment'ı başlatamaz,
 * ilerletemez veya tamamlayamaz.
 *
 * YETKİ MODELİ
 *   SUPPORT   → yalnızca okuma + kontrollü müşteri notu
 *   OPERATOR  → KENDİNE ATANMIŞ işleri yönetir
 *   ADMIN+    → tüm işleri yönetir, atama değiştirir
 *
 * YARIŞ KORUMASI
 * Durum ve ilerleme değişiklikleri `SELECT … FOR UPDATE` ile kilitlenir;
 * eşzamanlı iki progress isteği sıraya girer ve ikincisi güncel
 * `deliveredQuantity` üzerinden hesaplanır.
 */

export interface Actor {
  userId: string
  role: UserRole
  ipHash?: string | null
}

export class FulfillmentAccessError extends FulfillmentError {
  constructor(message = 'Bu fulfillment üzerinde işlem yetkiniz yok.') {
    super('FULFILLMENT_FORBIDDEN', message, 403)
  }
}

function isAdmin(role: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL.ADMIN
}

function isOperator(role: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL.OPERATOR
}

/**
 * ⚠️ ATAMA KONTROLÜ.
 * OPERATOR yalnızca KENDİNE atanmış işi değiştirebilir. Atanmamış bir işi
 * üstlenmek için önce kendine ataması gerekir (assignFulfillment).
 */
function assertCanOperate(
  actor: Actor,
  fulfillment: { assignedToUserId: string | null },
): void {
  if (isAdmin(actor.role)) return
  if (!isOperator(actor.role)) throw new FulfillmentAccessError()
  if (fulfillment.assignedToUserId !== actor.userId) {
    throw new FulfillmentAccessError(
      'Bu iş size atanmamış. Yalnızca size atanmış işleri yönetebilirsiniz.',
    )
  }
}

interface LoadedFulfillment {
  id: string
  orderId: string
  status: FulfillmentStatus
  requestedQuantity: number
  deliveredQuantity: number
  initialMetric: number | null
  currentMetric: number | null
  assignedToUserId: string | null
  guaranteeDays: number | null
  measurementMode: string
}

async function loadFulfillment(id: string): Promise<LoadedFulfillment> {
  const f = await db.fulfillment.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      status: true,
      requestedQuantity: true,
      deliveredQuantity: true,
      initialMetric: true,
      currentMetric: true,
      assignedToUserId: true,
      guaranteeDays: true,
      targetSnapshot: true,
    },
  })
  if (!f) throw new FulfillmentError('FULFILLMENT_NOT_FOUND', 'Fulfillment bulunamadı.', 404)
  const snap = f.targetSnapshot as { measurementMode?: string } | null
  return {
    id: f.id,
    orderId: f.orderId,
    status: f.status as FulfillmentStatus,
    requestedQuantity: f.requestedQuantity,
    deliveredQuantity: f.deliveredQuantity,
    initialMetric: f.initialMetric,
    currentMetric: f.currentMetric,
    assignedToUserId: f.assignedToUserId,
    guaranteeDays: f.guaranteeDays,
    measurementMode: snap?.measurementMode ?? 'METRIC',
  }
}

// ---------------------------------------------------------------------------
// ATAMA
// ---------------------------------------------------------------------------

export interface AssignResult {
  fulfillmentId: string
  assignedToUserId: string
  reassigned: boolean
}

/**
 * Operatör ataması. ADMIN+ herkesi atayabilir; OPERATOR yalnızca
 * ATANMAMIŞ bir işi KENDİNE alabilir (iş çalma engellenir).
 */
export async function assignFulfillment(
  fulfillmentId: string,
  targetUserId: string,
  actor: Actor,
): Promise<AssignResult> {
  const f = await loadFulfillment(fulfillmentId)

  if (!isAdmin(actor.role)) {
    if (!isOperator(actor.role)) throw new FulfillmentAccessError()
    if (targetUserId !== actor.userId) {
      throw new FulfillmentAccessError('Yalnızca yöneticiler başka operatöre atama yapabilir.')
    }
    if (f.assignedToUserId && f.assignedToUserId !== actor.userId) {
      throw new FulfillmentAccessError('Bu iş başka bir operatöre atanmış.')
    }
  }

  const assignee = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, isBlocked: true },
  })
  if (!assignee || assignee.isBlocked) {
    throw new FulfillmentError('ASSIGNEE_NOT_FOUND', 'Atanacak kullanıcı bulunamadı.', 404)
  }
  if (!isOperator(assignee.role as UserRole)) {
    throw new FulfillmentError(
      'ASSIGNEE_NOT_OPERATOR',
      'Yalnızca OPERATOR ve üzeri rollere iş atanabilir.',
      400,
    )
  }

  const reassigned = Boolean(f.assignedToUserId && f.assignedToUserId !== targetUserId)

  await db.$transaction(async (tx) => {
    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        assignedToUserId: targetUserId,
        assignedById: actor.userId,
        assignedAt: new Date(),
      },
    })
    await tx.fulfillmentEvent.create({
      data: {
        fulfillmentId,
        type: reassigned ? 'REASSIGNED' : 'ASSIGNED',
        actorUserId: actor.userId,
        // ⚠️ PII yok: kullanıcı adı/e-postası yazılmaz, yalnızca kimlik.
        note: reassigned ? 'İş başka bir operatöre aktarıldı.' : 'İş operatöre atandı.',
        isCustomerVisible: false,
      },
    })
  })

  await writeAudit({
    actorId: actor.userId,
    actorIpHash: actor.ipHash ?? null,
    action: reassigned ? 'fulfillment.reassign' : 'fulfillment.assign',
    entityType: 'Fulfillment',
    entityId: fulfillmentId,
    before: { assignedToUserId: f.assignedToUserId },
    after: { assignedToUserId: targetUserId },
  })

  return { fulfillmentId, assignedToUserId: targetUserId, reassigned }
}

// ---------------------------------------------------------------------------
// DURUM GEÇİŞİ — tek yazma noktası
// ---------------------------------------------------------------------------

interface TransitionOptions {
  eventType: FulfillmentEventType
  note?: string | null
  isCustomerVisible?: boolean
  /** Geçişe eşlik eden ek alan güncellemeleri */
  data?: Record<string, unknown>
  /** Siparişte karşılık gelen durum (varsa) */
  orderStatus?: 'PROCESSING' | 'STARTED' | 'PARTIAL' | 'COMPLETED' | null
}

/**
 * ⚠️ `fulfillment.status = x` ataması BAŞKA HİÇBİR YERDE yapılmaz.
 * Bu fonksiyon kilitler, geçişi doğrular, manuel aktör şartını uygular,
 * olayı ve audit'i tek transaction'da yazar.
 */
async function transitionFulfillment(
  fulfillmentId: string,
  to: FulfillmentStatus,
  actor: Actor,
  opts: TransitionOptions,
): Promise<FulfillmentStatus> {
  // ⚠️ Manuel-zorunlu geçişte insan aktör şart.
  assertManualActor(to, actor.userId)

  const changed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: FulfillmentStatus }>>`
      SELECT id, status FROM "Fulfillment" WHERE id = ${fulfillmentId} FOR UPDATE`
    const locked = rows[0]
    if (!locked) throw new FulfillmentError('FULFILLMENT_NOT_FOUND', 'Fulfillment bulunamadı.', 404)

    // Aynı duruma geçiş idempotent no-op — çift tıklama hata üretmez.
    if (locked.status === to) return { from: locked.status, noop: true as const }

    assertFulfillmentTransition(locked.status, to)

    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: { status: to, ...(opts.data ?? {}) },
    })

    await tx.fulfillmentEvent.create({
      data: {
        fulfillmentId,
        type: opts.eventType,
        actorUserId: actor.userId,
        fromStatus: locked.status,
        toStatus: to,
        note: opts.note ?? null,
        isCustomerVisible: opts.isCustomerVisible ?? false,
      },
    })

    return { from: locked.status, noop: false as const }
  })

  if (changed.noop) return to

  await writeAudit({
    actorId: actor.userId,
    actorIpHash: actor.ipHash ?? null,
    action: 'fulfillment.status_change',
    entityType: 'Fulfillment',
    entityId: fulfillmentId,
    before: { status: changed.from },
    after: { status: to },
  })

  return to
}

// ---------------------------------------------------------------------------
// MANUEL "İŞLEME BAŞLAT"
// ---------------------------------------------------------------------------

export interface StartInput {
  fulfillmentId: string
  /** METRIC modunda hedefin işe başlarken ölçülen değeri */
  initialMetric?: number | null
  note?: string | null
}

export interface StartResult {
  fulfillmentId: string
  status: FulfillmentStatus
  initialMetric: number | null
  goalMetric: number | null
}

/**
 * READY → PROCESSING → STARTED
 *
 * İki geçiş tek aksiyonda yapılır ("İşleme Başlat" tek butondur) ama ikisi de
 * state machine'den geçer ve ikisi için de olay yazılır.
 *
 * ⚠️ `initialMetric` BURADA dondurulur, sipariş anında değil: sipariş ile
 * başlangıç arasındaki organik değişim bize yazılmamalı.
 */
export async function startFulfillment(input: StartInput, actor: Actor): Promise<StartResult> {
  const f = await loadFulfillment(input.fulfillmentId)
  assertCanOperate(actor, f)

  if (f.status !== 'READY' && f.status !== 'PROCESSING' && f.status !== 'REVIEW_REQUIRED') {
    throw new FulfillmentError(
      'INVALID_START_STATE',
      `Bu iş "${f.status}" durumunda; yalnızca sıradaki işler başlatılabilir.`,
      409,
    )
  }

  const metric =
    input.initialMetric === undefined || input.initialMetric === null
      ? null
      : Math.max(0, Math.trunc(input.initialMetric))

  if (f.measurementMode === 'METRIC' && metric === null && f.initialMetric === null) {
    throw new FulfillmentError(
      'INITIAL_METRIC_REQUIRED',
      'Bu hizmet ölçüme dayalı; işe başlarken hedefin mevcut değerini girin.',
      400,
    )
  }

  // 1) → PROCESSING
  if (f.status === 'READY' || f.status === 'REVIEW_REQUIRED') {
    await transitionFulfillment(input.fulfillmentId, 'PROCESSING', actor, {
      eventType: 'STARTED',
      note: 'İşleme alındı.',
      isCustomerVisible: true,
      data: { ...(metric !== null ? { initialMetric: metric, currentMetric: metric } : {}) },
    })
  }

  // 2) → STARTED
  await transitionFulfillment(input.fulfillmentId, 'STARTED', actor, {
    eventType: 'STARTED',
    note: input.note ?? 'İşlem başlatıldı.',
    isCustomerVisible: true,
    data: {
      startedAt: new Date(),
      ...(metric !== null && f.initialMetric === null
        ? { initialMetric: metric, currentMetric: metric }
        : {}),
    },
  })

  // Sipariş de ilerletilir (fulfillment ile ZORLA eşitlenmez, karşılığı yazılır)
  await syncOrderStatus(f.orderId, 'STARTED', actor)

  const after = await loadFulfillment(input.fulfillmentId)
  return {
    fulfillmentId: after.id,
    status: after.status,
    initialMetric: after.initialMetric,
    goalMetric:
      after.initialMetric === null ? null : after.initialMetric + after.requestedQuantity,
  }
}

// ---------------------------------------------------------------------------
// MANUEL İLERLEME
// ---------------------------------------------------------------------------

export interface ProgressInput {
  fulfillmentId: string
  /** METRIC modunda hedefin şu anki ölçülen değeri */
  currentMetric?: number | null
  /** MANUAL_COUNT modunda doğrudan teslim adedi (kümülatif) */
  deliveredQuantity?: number | null
  note?: string | null
}

export interface ProgressOutcome {
  fulfillmentId: string
  status: FulfillmentStatus
  requested: number
  delivered: number
  remaining: number
  percent: number
  initialMetric: number | null
  currentMetric: number | null
  /** Ölçüm geriye düştü mü? Hata değil — inceleme uyarısı. */
  metricDecreased: boolean
  dropAmount: number
}

/**
 * ⚠️ İSTEMCİDEN GELEN `remaining` VEYA `percent` KULLANILMAZ.
 * Şema bu alanları kabul etmez; ilerleme burada hesaplanır.
 *
 * ⚠️ `deliveredQuantity` istenen miktarı AŞAMAZ — kırpılır ve olay yazılır.
 *
 * ⚠️ Teslim sayısı dolsa bile durum otomatik COMPLETED OLMAZ.
 * Tamamlama ayrı ve manuel bir aksiyondur (completeFulfillment).
 */
export async function updateProgress(
  input: ProgressInput,
  actor: Actor,
): Promise<ProgressOutcome> {
  const pre = await loadFulfillment(input.fulfillmentId)
  assertCanOperate(actor, pre)

  if (pre.status !== 'STARTED' && pre.status !== 'PARTIAL') {
    throw new FulfillmentError(
      'INVALID_PROGRESS_STATE',
      'İlerleme yalnızca başlatılmış bir işte kaydedilebilir.',
      409,
    )
  }

  const result = await db.$transaction(async (tx) => {
    // ⚠️ Kilit: eşzamanlı iki progress isteği sıraya girer.
    const rows = await tx.$queryRaw<
      Array<{
        id: string
        status: FulfillmentStatus
        deliveredQuantity: number
        requestedQuantity: number
        initialMetric: number | null
        currentMetric: number | null
      }>
    >`SELECT id, status, "deliveredQuantity", "requestedQuantity", "initialMetric", "currentMetric"
      FROM "Fulfillment" WHERE id = ${input.fulfillmentId} FOR UPDATE`
    const locked = rows[0]
    if (!locked) throw new FulfillmentError('FULFILLMENT_NOT_FOUND', 'Fulfillment bulunamadı.', 404)

    const previousMetric = locked.currentMetric
    let nextDelivered = locked.deliveredQuantity
    let nextMetric = locked.currentMetric
    let metricDecreased = false
    let dropAmount = 0

    if (input.currentMetric !== undefined && input.currentMetric !== null) {
      nextMetric = Math.max(0, Math.trunc(input.currentMetric))
      const delta = deliveredFromMetricDelta(locked.initialMetric, nextMetric, previousMetric)
      metricDecreased = delta.decreased
      dropAmount = delta.dropAmount
      // Ölçümden türeyen teslim adedi. Düşüş olsa bile teslim GERİ ALINMAZ:
      // organik kayıp telafi (ReplacementCase) konusudur.
      nextDelivered = Math.max(locked.deliveredQuantity, delta.deliveredFromMetric)
    }

    if (input.deliveredQuantity !== undefined && input.deliveredQuantity !== null) {
      nextDelivered = Math.max(0, Math.trunc(input.deliveredQuantity))
    }

    // ⚠️ ÜST SINIR: teslim, istenen miktarı aşamaz.
    const progress = computeFulfillmentProgress({
      requestedQuantity: locked.requestedQuantity,
      deliveredQuantity: nextDelivered,
    })

    await tx.fulfillment.update({
      where: { id: input.fulfillmentId },
      data: {
        deliveredQuantity: progress.delivered,
        ...(nextMetric !== null ? { currentMetric: nextMetric } : {}),
      },
    })

    await tx.fulfillmentEvent.create({
      data: {
        fulfillmentId: input.fulfillmentId,
        type: 'PROGRESS_UPDATED',
        actorUserId: actor.userId,
        quantity: progress.delivered,
        previousMetric,
        currentMetric: nextMetric,
        note: input.note ?? null,
        isCustomerVisible: true,
      },
    })

    // Ölçüm geriye düştüyse AYRI bir olay — hata değil, inceleme sinyali.
    if (metricDecreased) {
      await tx.fulfillmentEvent.create({
        data: {
          fulfillmentId: input.fulfillmentId,
          type: 'METRIC_DECREASED',
          actorUserId: actor.userId,
          previousMetric,
          currentMetric: nextMetric,
          quantity: dropAmount,
          note: `Ölçüm ${dropAmount} birim geriye düştü. İnceleme gerekebilir.`,
          isCustomerVisible: false,
        },
      })
    }

    // Kısmi teslim işareti — yine de OTOMATİK TAMAMLAMA YOK.
    if (!progress.isFullyDelivered && progress.delivered > 0 && locked.status === 'STARTED') {
      await tx.fulfillment.update({
        where: { id: input.fulfillmentId },
        data: { status: 'PARTIAL' },
      })
      await tx.fulfillmentEvent.create({
        data: {
          fulfillmentId: input.fulfillmentId,
          type: 'PARTIAL_DELIVERY',
          actorUserId: actor.userId,
          quantity: progress.delivered,
          fromStatus: 'STARTED',
          toStatus: 'PARTIAL',
          isCustomerVisible: true,
        },
      })
    }

    return { progress, nextMetric, metricDecreased, dropAmount, previousMetric }
  })

  // OrderItem ilerlemesi de güncellenir (müşteri görünümü buradan besleniyor)
  await db.orderItem.updateMany({
    where: { orderId: pre.orderId },
    data: {
      deliveredQuantity: result.progress.delivered,
      ...(result.nextMetric !== null ? { currentCount: result.nextMetric } : {}),
      lastProgressAt: new Date(),
    },
  })

  await writeAudit({
    actorId: actor.userId,
    actorIpHash: actor.ipHash ?? null,
    action: 'fulfillment.progress',
    entityType: 'Fulfillment',
    entityId: input.fulfillmentId,
    after: {
      delivered: result.progress.delivered,
      remaining: result.progress.remaining,
      percent: result.progress.percent,
      metricDecreased: result.metricDecreased,
    },
  })

  const after = await loadFulfillment(input.fulfillmentId)
  return {
    fulfillmentId: after.id,
    status: after.status,
    requested: result.progress.requested,
    delivered: result.progress.delivered,
    remaining: result.progress.remaining,
    percent: result.progress.percent,
    initialMetric: after.initialMetric,
    currentMetric: after.currentMetric,
    metricDecreased: result.metricDecreased,
    dropAmount: result.dropAmount,
  }
}

// ---------------------------------------------------------------------------
// MANUEL TAMAMLAMA
// ---------------------------------------------------------------------------

export interface CompleteResult {
  fulfillmentId: string
  status: FulfillmentStatus
  delivered: number
  requested: number
  guaranteeEndsAt: string | null
  orderCompleted: boolean
}

/**
 * ⚠️ TAMAMLAMA ASLA OTOMATİK DEĞİLDİR.
 * `delivered === requested` olsa bile durum kendiliğinden COMPLETED olmaz;
 * operatör "Tamamla" demek zorundadır. Bu fonksiyon o aksiyonun karşılığıdır.
 */
export async function completeFulfillment(
  fulfillmentId: string,
  actor: Actor,
  opts: { note?: string | null; allowPartial?: boolean } = {},
): Promise<CompleteResult> {
  const f = await loadFulfillment(fulfillmentId)
  assertCanOperate(actor, f)

  if (f.status !== 'STARTED' && f.status !== 'PARTIAL' && f.status !== 'REVIEW_REQUIRED') {
    throw new FulfillmentError(
      'INVALID_COMPLETE_STATE',
      'Yalnızca başlatılmış bir iş tamamlanabilir.',
      409,
    )
  }

  const progress = computeFulfillmentProgress({
    requestedQuantity: f.requestedQuantity,
    deliveredQuantity: f.deliveredQuantity,
  })

  if (progress.delivered <= 0) {
    throw new FulfillmentError(
      'NOTHING_DELIVERED',
      'Hiç teslim kaydedilmemiş bir iş tamamlanamaz.',
      409,
    )
  }
  // Eksik teslimle kapatmak KASITLI bir karardır; açık onay ister.
  if (!progress.isFullyDelivered && !opts.allowPartial) {
    throw new FulfillmentError(
      'INCOMPLETE_DELIVERY',
      `Teslim eksik (${progress.delivered}/${progress.requested}). ` +
        'Eksik teslimle kapatmak için kısmi tamamlama onayı gerekir.',
      409,
    )
  }

  const completedAt = new Date()
  const guaranteeEndsAt = guaranteeEndFor(completedAt, f.guaranteeDays)

  await transitionFulfillment(fulfillmentId, 'COMPLETED', actor, {
    eventType: 'COMPLETED',
    note: opts.note ?? 'İşlem tamamlandı.',
    isCustomerVisible: true,
    data: { completedAt, guaranteeEndsAt },
  })

  // Siparişe karşılık gelen durum
  const orderCompleted = await syncOrderStatus(
    f.orderId,
    progress.isFullyDelivered ? 'COMPLETED' : 'PARTIAL',
    actor,
  )

  await db.orderEvent.create({
    data: {
      orderId: f.orderId,
      type: 'FULFILLMENT_COMPLETED',
      message: 'İşleminiz tamamlandı.',
      actorType: 'ADMIN',
      actorId: actor.userId,
      isCustomerVisible: true,
    },
  })

  return {
    fulfillmentId,
    status: 'COMPLETED',
    delivered: progress.delivered,
    requested: progress.requested,
    guaranteeEndsAt: guaranteeEndsAt ? guaranteeEndsAt.toISOString() : null,
    orderCompleted,
  }
}

// ---------------------------------------------------------------------------
// BAŞARISIZ / İNCELEME
// ---------------------------------------------------------------------------

export async function failFulfillment(
  fulfillmentId: string,
  actor: Actor,
  reason: string,
): Promise<{ fulfillmentId: string; status: FulfillmentStatus }> {
  const f = await loadFulfillment(fulfillmentId)
  assertCanOperate(actor, f)

  await transitionFulfillment(fulfillmentId, 'FAILED', actor, {
    eventType: 'FAILED',
    // ⚠️ Teknik sebep İÇ kayıttır; müşteri görünümünde kullanılmaz.
    note: reason.slice(0, 500),
    isCustomerVisible: false,
    data: { failedAt: new Date(), failureReason: reason.slice(0, 500) },
  })

  // Başarısız iş otomatik olarak incelemeye alınır.
  await transitionFulfillment(fulfillmentId, 'REVIEW_REQUIRED', actor, {
    eventType: 'REVIEW_REQUIRED',
    note: 'İnceleme kuyruğuna alındı.',
    isCustomerVisible: true,
  })

  return { fulfillmentId, status: 'REVIEW_REQUIRED' }
}

// ---------------------------------------------------------------------------
// NOTLAR
// ---------------------------------------------------------------------------

/**
 * İç not (müşteriye görünmez) veya kontrollü müşteri notu.
 * SUPPORT yalnızca müşteri notu yazabilir — durum/ilerleme değiştiremez.
 */
export async function addNote(
  fulfillmentId: string,
  actor: Actor,
  input: { note: string; customerVisible: boolean },
): Promise<{ fulfillmentId: string }> {
  const f = await loadFulfillment(fulfillmentId)

  if (input.customerVisible) {
    // SUPPORT+ müşteri notu yazabilir
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.SUPPORT) throw new FulfillmentAccessError()
  } else {
    // İç not: operasyon ekibi
    if (!isOperator(actor.role)) throw new FulfillmentAccessError()
    if (!isAdmin(actor.role) && f.assignedToUserId !== actor.userId) {
      throw new FulfillmentAccessError('Bu iş size atanmamış.')
    }
  }

  const note = input.note.trim().slice(0, 1000)

  await db.$transaction(async (tx) => {
    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: input.customerVisible ? { customerNote: note } : { internalNote: note },
    })
    await tx.fulfillmentEvent.create({
      data: {
        fulfillmentId,
        type: 'NOTE_ADDED',
        actorUserId: actor.userId,
        note,
        isCustomerVisible: input.customerVisible,
      },
    })
  })

  await writeAudit({
    actorId: actor.userId,
    actorIpHash: actor.ipHash ?? null,
    action: 'fulfillment.note',
    entityType: 'Fulfillment',
    entityId: fulfillmentId,
    // Not içeriği audit'e yazılmaz (PII taşıyabilir); yalnızca türü.
    after: { customerVisible: input.customerVisible, length: note.length },
  })

  return { fulfillmentId }
}

// ---------------------------------------------------------------------------
// Sipariş durumu senkronu
// ---------------------------------------------------------------------------

/**
 * Fulfillment ilerlemesinin siparişteki karşılığı.
 *
 * ⚠️ İki state machine ZORLA EŞİTLENMEZ. Sipariş kendi geçiş tablosuna
 * uyar; fulfillment kendi doğrusunu korur. Geçiş yapılamazsa fulfillment
 * akışı DURMAZ.
 *
 * ⚠️ ARA DURUMLAR ATLANMAZ. Sipariş makinesi `PAID → STARTED` doğrudan
 * geçişine izin vermez (`PAID → PROCESSING → STARTED`). Hedefe giden
 * kanonik zincir sırayla yürünür; aksi halde sipariş PAID'de takılı kalır
 * ve müşteri "işleminiz başladı" bilgisini hiç görmez.
 */
const ORDER_CHAIN: readonly OrderSyncStatus[] = ['PROCESSING', 'STARTED', 'PARTIAL', 'COMPLETED']

type OrderSyncStatus = 'PROCESSING' | 'STARTED' | 'PARTIAL' | 'COMPLETED'

async function syncOrderStatus(
  orderId: string,
  to: OrderSyncStatus,
  actor: Actor,
): Promise<boolean> {
  const targetIndex = ORDER_CHAIN.indexOf(to)
  if (targetIndex < 0) return false

  let reached = false
  for (let i = 0; i <= targetIndex; i++) {
    const step = ORDER_CHAIN[i]!
    try {
      await transitionOrder({
        orderId,
        to: step,
        actorType: 'ADMIN',
        actorId: actor.userId,
        reason: 'Operasyon ilerlemesi',
      })
      reached = step === to
    } catch (err) {
      if (err instanceof InvalidFulfillmentTransitionError) continue
      // Sipariş zaten daha ileri bir durumda olabilir; bu bir hata değildir.
      // Zincirin kalanı denenmeye devam eder.
      if (step === to) {
        console.warn('[fulfillment] sipariş durumu senkronlanamadı:', (err as Error).message)
      }
    }
  }
  return reached
}

export { AutomationNotAllowedError, InvalidFulfillmentTransitionError }
