import 'server-only'

import type { OrderStatus } from '@/lib/enums'
import { ORDER_STATUS_META } from '@/lib/orders/status'
import { FULFILLMENT_ALLOWED_FROM, InvalidTransitionError } from '@/lib/orders/transitions'
import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'
import { normalizeOrderNo } from './order-no'
import { FulfillmentBeforePaymentError, transitionOrder, type ActorType } from './transition'

/**
 * ADMIN SİPARİŞ YÖNETİMİ
 *
 * ⚠️ ÖDEME ALINMADAN FULFILLMENT YOK.
 * `PENDING_PAYMENT` siparişler "aktif iş" DEĞİLDİR:
 *   • Varsayılan liste görünümü `queue=active` → yalnızca ödenmiş siparişler
 *   • Ödeme bekleyenler ayrı bir kovada ("Ödeme bekleniyor") gösterilir
 *   • `PENDING_PAYMENT → PROCESSING` denemesi transition katmanında reddedilir
 *   • `PENDING_PAYMENT → CANCELLED` SERBESTTİR (admin iptal edebilir)
 */

export class AdminOrderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'AdminOrderError'
  }
}

export type OrderQueue = 'active' | 'awaiting_payment' | 'completed' | 'problem' | 'all'

const QUEUE_STATUSES: Record<Exclude<OrderQueue, 'all'>, OrderStatus[]> = {
  // Yalnızca ÖDENMİŞ siparişler — çalışılacak gerçek iş kuyruğu
  active: ['PAID', 'PROCESSING', 'STARTED', 'IN_PROGRESS', 'PARTIAL'],
  awaiting_payment: ['PENDING_PAYMENT', 'DRAFT'],
  completed: ['COMPLETED'],
  problem: ['FAILED', 'CANCELLED', 'REFUNDED'],
}

export interface AdminOrderListParams {
  queue?: OrderQueue
  status?: OrderStatus
  search?: string
  platformSlug?: string
  page?: number
  pageSize?: number
}

export async function listOrdersForAdmin(params: AdminOrderListParams) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25))
  const queue = params.queue ?? 'active'

  const where: Record<string, unknown> = {}

  if (params.status) {
    where.status = params.status
  } else if (queue !== 'all') {
    where.status = { in: QUEUE_STATUSES[queue] }
  }

  if (params.platformSlug) where.platform = { slug: params.platformSlug }

  if (params.search) {
    const term = params.search.trim()
    // Sipariş numarası ya da e-posta ile arama. Ham LIKE değil, Prisma
    // parametreli sorgu kullanır → SQL injection mümkün değil.
    where.OR = [
      { orderNo: { equals: normalizeOrderNo(term) } },
      { customerEmail: { equals: term.toLowerCase() } },
    ]
  }

  const [total, rows, counts] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdAt: true,
        paidAt: true,
        quantity: true,
        totalMinor: true,
        currency: true,
        isGuestOrder: true,
        customerFirstName: true,
        customerLastName: true,
        platform: { select: { name: true, slug: true } },
        service: { select: { name: true, unitLabel: true } },
        serviceVariant: { select: { customerLabel: true } },
        target: { select: { handle: true, normalized: true } },
        items: { select: { deliveredQuantity: true } },
      },
    }),
    db.order.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]))
  const sum = (list: OrderStatus[]) => list.reduce((n, s) => n + (byStatus[s] ?? 0), 0)

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    queue,
    /** Kuyruk rozetleri — "aktif iş" ödeme bekleyenleri İÇERMEZ */
    queueCounts: {
      active: sum(QUEUE_STATUSES.active),
      awaiting_payment: sum(QUEUE_STATUSES.awaiting_payment),
      completed: sum(QUEUE_STATUSES.completed),
      problem: sum(QUEUE_STATUSES.problem),
    },
    orders: rows.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      status: o.status as OrderStatus,
      statusLabel: ORDER_STATUS_META[o.status as OrderStatus].label,
      /** Ödeme alınmadıysa bu sipariş işleme ALINMAZ — UI bunu açıkça gösterir */
      isPayable: !FULFILLMENT_ALLOWED_FROM.has(o.status as OrderStatus),
      isFulfillable: FULFILLMENT_ALLOWED_FROM.has(o.status as OrderStatus),
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      customerName: [o.customerFirstName, o.customerLastName].filter(Boolean).join(' ') || null,
      isGuestOrder: o.isGuestOrder,
      platformName: o.platform.name,
      platformSlug: o.platform.slug,
      serviceName: o.service.name,
      variantLabel: o.serviceVariant.customerLabel,
      unitLabel: o.service.unitLabel,
      targetHandle: o.target.handle ?? o.target.normalized,
      quantity: o.quantity,
      deliveredQuantity: o.items.reduce((n, i) => n + i.deliveredQuantity, 0),
      totalMinor: o.totalMinor,
      currency: o.currency,
    })),
  }
}

export async function getOrderForAdmin(orderNoOrId: string) {
  const orderNo = normalizeOrderNo(orderNoOrId)
  const order = await db.order.findFirst({
    where: { OR: [{ orderNo }, { id: orderNoOrId }] },
    include: {
      platform: { select: { name: true, slug: true } },
      service: { select: { name: true, unitLabel: true, measurementMode: true } },
      serviceVariant: { select: { customerLabel: true, internalName: true } },
      target: true,
      items: true,
      user: { select: { id: true, email: true, isGuest: true, emailVerified: true } },
      coupon: { select: { code: true } },
      events: { orderBy: { createdAt: 'asc' } },
      payments: {
        select: { id: true, provider: true, status: true, amountMinor: true, createdAt: true },
      },
    },
  })
  if (!order) throw new AdminOrderError('NOT_FOUND', 'Sipariş bulunamadı.', 404)

  const status = order.status as OrderStatus
  return {
    ...order,
    statusLabel: ORDER_STATUS_META[status].label,
    isFulfillable: FULFILLMENT_ALLOWED_FROM.has(status),
    /** Ödeme beklenirken gösterilecek uyarı — fulfillment ekibi için */
    fulfillmentBlockedReason: FULFILLMENT_ALLOWED_FROM.has(status)
      ? null
      : 'Ödeme bekleniyor. Ödeme tamamlanmadan bu sipariş işleme alınamaz.',
  }
}

export interface AdminTransitionInput {
  orderNoOrId: string
  to: OrderStatus
  reason?: string | null
  actorId: string
  actorIpHash?: string | null
  actorType?: ActorType
}

/**
 * Admin durum değişikliği.
 *
 * ⚠️ Admin bile ödeme alınmadan siparişi işleme ALAMAZ. `transitionOrder`
 * içindeki fulfillment kapısı burada da geçerlidir — yetki bu kuralı aşmaz.
 */
export async function adminTransitionOrder(input: AdminTransitionInput) {
  const orderNo = normalizeOrderNo(input.orderNoOrId)
  const order = await db.order.findFirst({
    where: { OR: [{ orderNo }, { id: input.orderNoOrId }] },
    select: { id: true, orderNo: true, status: true, customerEmail: true, guestEmail: true },
  })
  if (!order) throw new AdminOrderError('NOT_FOUND', 'Sipariş bulunamadı.', 404)

  const from = order.status as OrderStatus

  try {
    const updated = await transitionOrder({
      orderId: order.id,
      to: input.to,
      actorType: input.actorType ?? 'ADMIN',
      actorId: input.actorId,
      reason: input.reason ?? null,
    })

    await writeAudit({
      actorId: input.actorId,
      actorIpHash: input.actorIpHash ?? null,
      action: 'order.status_change',
      entityType: 'Order',
      entityId: order.id,
      before: { status: from },
      after: { status: input.to, orderNo: order.orderNo, reason: input.reason ?? null },
    })

    /**
     * ⚠️ ADMIN DURUM DEĞİŞİKLİĞİ TEK BAŞINA E-POSTA ÜRETMEZ.
     *
     * Faz 8 öncesi burada her müşteriye görünür durum için "durum değişti"
     * e-postası gidiyordu. Bu, bildirimleri iki ayrı yerden yönetmek demekti
     * ve idempotency yoktu: aynı geçiş iki kez denendiğinde iki e-posta
     * gidebiliyordu.
     *
     * Artık tek kaynak `server/notifications`tır ve yalnızca ANLAMLI
     * kilometre taşları bildirim üretir (ödeme alındı, işleme alındı,
     * ilerleme, tamamlandı, telafi). "PROCESSING oldu" gibi ara durumlar
     * müşteri zaman çizelgesinde görünür ama e-posta üretmez.
     */

    return {
      orderNo: order.orderNo,
      from,
      to: updated.status as OrderStatus,
      statusLabel: ORDER_STATUS_META[updated.status as OrderStatus].label,
    }
  } catch (err) {
    if (err instanceof FulfillmentBeforePaymentError) {
      throw new AdminOrderError('FULFILLMENT_BEFORE_PAYMENT', err.message, 409)
    }
    if (err instanceof InvalidTransitionError) {
      throw new AdminOrderError('INVALID_TRANSITION', err.message, 409)
    }
    throw err
  }
}
