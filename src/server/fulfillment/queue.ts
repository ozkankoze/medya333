import 'server-only'

import type { FulfillmentStatus, OrderStatus, UserRole } from '@/lib/enums'
import { ROLE_LEVEL } from '@/lib/enums'
import {
  computeFulfillmentProgress,
  QUEUE_BUCKETS,
  QUEUE_PRIORITY,
  type QueueBucket,
} from '@/lib/fulfillment/status'
import { db } from '@/server/db'
import type { TargetSnapshot } from './create'
import { FulfillmentError } from './create'

/**
 * OPERASYON KUYRUĞU — okuma tarafı
 *
 * ⚠️ ÖDENMEMİŞ SİPARİŞ BURADA GÖRÜNMEZ.
 * Fulfillment yalnızca ödeme doğrulandıktan sonra açıldığı için kuyruk
 * doğası gereği ödenmiş siparişlerden oluşur. Yine de sorguya açık bir
 * `order.status` filtresi konur: yanlışlıkla açılmış bir kayıt bile
 * operatörün ekranına düşemez.
 */

const PAID_ORDER_STATUSES: OrderStatus[] = [
  'PAID',
  'PROCESSING',
  'STARTED',
  'IN_PROGRESS',
  'PARTIAL',
  'COMPLETED',
]

export interface QueueParams {
  bucket?: QueueBucket | 'all'
  status?: FulfillmentStatus
  platformSlug?: string
  serviceSlug?: string
  assignedToUserId?: string
  /** Yalnızca bana atanmış işler */
  mineOnly?: boolean
  search?: string
  page?: number
  pageSize?: number
}

export interface QueueRow {
  id: string
  orderNo: string
  status: FulfillmentStatus
  platformName: string
  serviceName: string
  variantLabel: string
  unitLabel: string
  targetHandle: string | null
  requestedQuantity: number
  deliveredQuantity: number
  remaining: number
  percent: number
  assignedToUserId: string | null
  assignedToName: string | null
  createdAt: string
  startedAt: string | null
  priority: number
}

export async function listFulfillmentQueue(params: QueueParams, viewer: { userId: string; role: UserRole }) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25))

  const where: Record<string, unknown> = {
    // ⚠️ İkinci kapı: yalnızca ödenmiş siparişlerin işleri.
    order: { status: { in: PAID_ORDER_STATUSES } },
  }

  if (params.status) {
    where.status = params.status
  } else if (params.bucket && params.bucket !== 'all') {
    where.status = { in: [...QUEUE_BUCKETS[params.bucket]] }
  }

  if (params.mineOnly) {
    where.assignedToUserId = viewer.userId
  } else if (params.assignedToUserId) {
    where.assignedToUserId = params.assignedToUserId
  }

  if (params.platformSlug || params.serviceSlug || params.search) {
    const orderWhere = where.order as Record<string, unknown>
    if (params.platformSlug) orderWhere.platform = { slug: params.platformSlug }
    if (params.serviceSlug) orderWhere.service = { slug: params.serviceSlug }
    if (params.search) {
      orderWhere.orderNo = { equals: params.search.trim().toUpperCase() }
    }
  }

  const [total, rows, grouped] = await Promise.all([
    db.fulfillment.count({ where }),
    db.fulfillment.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        requestedQuantity: true,
        deliveredQuantity: true,
        assignedToUserId: true,
        createdAt: true,
        startedAt: true,
        targetSnapshot: true,
        assignedTo: { select: { name: true, email: true } },
        order: { select: { orderNo: true } },
      },
    }),
    db.fulfillment.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { order: { status: { in: PAID_ORDER_STATUSES } } },
    }),
  ])

  const byStatus = Object.fromEntries(
    grouped.map((g) => [g.status, (g._count as { _all: number })._all]),
  )
  const bucketCount = (b: QueueBucket) =>
    QUEUE_BUCKETS[b].reduce((n, s) => n + (byStatus[s] ?? 0), 0)

  const items: QueueRow[] = rows.map((f) => {
    const snap = f.targetSnapshot as unknown as TargetSnapshot
    const p = computeFulfillmentProgress({
      requestedQuantity: f.requestedQuantity,
      deliveredQuantity: f.deliveredQuantity,
    })
    return {
      id: f.id,
      orderNo: f.order.orderNo,
      status: f.status as FulfillmentStatus,
      platformName: snap?.platformName ?? '—',
      serviceName: snap?.serviceName ?? '—',
      variantLabel: snap?.variantLabel ?? '—',
      unitLabel: snap?.unitLabel ?? 'adet',
      targetHandle: snap?.targetHandle ?? snap?.targetNormalized ?? null,
      requestedQuantity: p.requested,
      deliveredQuantity: p.delivered,
      remaining: p.remaining,
      percent: p.percent,
      assignedToUserId: f.assignedToUserId,
      // Operatör adı yalnızca İÇ ekranda; müşteri görünümüne asla gitmez.
      assignedToName: f.assignedTo?.name ?? f.assignedTo?.email ?? null,
      createdAt: f.createdAt.toISOString(),
      startedAt: f.startedAt?.toISOString() ?? null,
      priority: QUEUE_PRIORITY[f.status as FulfillmentStatus],
    }
  })

  // Kuyruk sırası: önce durum önceliği, sonra eskiden yeniye.
  items.sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    bucket: params.bucket ?? 'all',
    /** ⚠️ Gerçek DB verisi — sahte istatistik yok. */
    counts: {
      new: bucketCount('new'),
      active: bucketCount('active'),
      partial: bucketCount('partial'),
      review: bucketCount('review'),
      completed: bucketCount('completed'),
      mine: await db.fulfillment.count({
        where: {
          assignedToUserId: viewer.userId,
          status: { in: ['PROCESSING', 'STARTED', 'PARTIAL'] },
        },
      }),
    },
    items,
  }
}

// ---------------------------------------------------------------------------

export interface FulfillmentDetail extends QueueRow {
  initialMetric: number | null
  currentMetric: number | null
  goalMetric: number | null
  guaranteeDays: number | null
  guaranteeEndsAt: string | null
  completedAt: string | null
  failedAt: string | null
  /** ⚠️ İÇ bilgi — müşteri API'sinden ASLA dönmez */
  internalNote: string | null
  customerNote: string | null
  failureReason: string | null
  measurementMode: string
  canOperate: boolean
  events: Array<{
    id: string
    type: string
    actorName: string | null
    quantity: number | null
    previousMetric: number | null
    currentMetric: number | null
    fromStatus: string | null
    toStatus: string | null
    note: string | null
    isCustomerVisible: boolean
    createdAt: string
  }>
  replacements: Array<{
    id: string
    status: string
    reason: string
    replacementQuantity: number
    createdAt: string
    completedAt: string | null
  }>
}

/** Operatör/admin detay görünümü. */
export async function getFulfillmentDetail(
  id: string,
  viewer: { userId: string; role: UserRole },
): Promise<FulfillmentDetail> {
  const f = await db.fulfillment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      requestedQuantity: true,
      deliveredQuantity: true,
      initialMetric: true,
      currentMetric: true,
      assignedToUserId: true,
      guaranteeDays: true,
      guaranteeEndsAt: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      internalNote: true,
      customerNote: true,
      failureReason: true,
      createdAt: true,
      targetSnapshot: true,
      assignedTo: { select: { name: true, email: true } },
      order: { select: { orderNo: true, status: true } },
      events: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          quantity: true,
          previousMetric: true,
          currentMetric: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          isCustomerVisible: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
        },
      },
      replacements: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          reason: true,
          replacementQuantity: true,
          createdAt: true,
          completedAt: true,
        },
      },
    },
  })
  if (!f) throw new FulfillmentError('FULFILLMENT_NOT_FOUND', 'Fulfillment bulunamadı.', 404)

  const snap = f.targetSnapshot as unknown as TargetSnapshot
  const p = computeFulfillmentProgress({
    requestedQuantity: f.requestedQuantity,
    deliveredQuantity: f.deliveredQuantity,
  })

  const isAdmin = ROLE_LEVEL[viewer.role] >= ROLE_LEVEL.ADMIN
  const isOperator = ROLE_LEVEL[viewer.role] >= ROLE_LEVEL.OPERATOR
  const canOperate = isAdmin || (isOperator && f.assignedToUserId === viewer.userId)

  return {
    id: f.id,
    orderNo: f.order.orderNo,
    status: f.status as FulfillmentStatus,
    platformName: snap?.platformName ?? '—',
    serviceName: snap?.serviceName ?? '—',
    variantLabel: snap?.variantLabel ?? '—',
    unitLabel: snap?.unitLabel ?? 'adet',
    targetHandle: snap?.targetHandle ?? snap?.targetNormalized ?? null,
    requestedQuantity: p.requested,
    deliveredQuantity: p.delivered,
    remaining: p.remaining,
    percent: p.percent,
    assignedToUserId: f.assignedToUserId,
    assignedToName: f.assignedTo?.name ?? f.assignedTo?.email ?? null,
    createdAt: f.createdAt.toISOString(),
    startedAt: f.startedAt?.toISOString() ?? null,
    priority: QUEUE_PRIORITY[f.status as FulfillmentStatus],
    initialMetric: f.initialMetric,
    currentMetric: f.currentMetric,
    goalMetric: f.initialMetric === null ? null : f.initialMetric + f.requestedQuantity,
    guaranteeDays: f.guaranteeDays,
    guaranteeEndsAt: f.guaranteeEndsAt?.toISOString() ?? null,
    completedAt: f.completedAt?.toISOString() ?? null,
    failedAt: f.failedAt?.toISOString() ?? null,
    internalNote: f.internalNote,
    customerNote: f.customerNote,
    failureReason: f.failureReason,
    measurementMode: snap?.measurementMode ?? 'METRIC',
    canOperate,
    events: f.events.map((e) => ({
      id: e.id,
      type: e.type,
      actorName: e.actor?.name ?? e.actor?.email ?? null,
      quantity: e.quantity,
      previousMetric: e.previousMetric,
      currentMetric: e.currentMetric,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      note: e.note,
      isCustomerVisible: e.isCustomerVisible,
      createdAt: e.createdAt.toISOString(),
    })),
    replacements: f.replacements.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      replacementQuantity: r.replacementQuantity,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
  }
}

/** Atama seçenekleri — OPERATOR ve üzeri kullanıcılar. */
export async function listAssignableOperators() {
  const users = await db.user.findMany({
    where: { role: { in: ['OPERATOR', 'ADMIN', 'SUPERADMIN'] }, isBlocked: false },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { email: 'asc' },
    take: 100,
  })
  return users.map((u) => ({
    id: u.id,
    label: u.name ?? u.email,
    role: u.role as UserRole,
  }))
}
