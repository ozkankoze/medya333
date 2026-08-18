import 'server-only'

import { CUSTOMER_TIMELINE_STEPS, ORDER_STATUS_META } from '@/lib/orders/status'
import type { FulfillmentStatus, OrderStatus } from '@/lib/enums'
import {
  computeFulfillmentProgress,
  CUSTOMER_FULFILLMENT_VIEW,
  goalMetric,
} from '@/lib/fulfillment/status'
import { db } from '@/server/db'
import { normalizeOrderNo, safeEmailEquals, verifyAccessToken } from './order-no'

/**
 * SİPARİŞ GÖRÜNTÜLEME — güvenlik kritik
 *
 * İki erişim yolu:
 *   A) orderNo + e-posta  → ikisi de doğru olmalı; rate limit + sabit süreli
 *      karşılaştırma. `orderNo` yüksek entropili olduğu için enumeration yok.
 *   B) İmzalı takip token'ı → e-posta ile gönderilen link. DB'de yalnızca hash.
 *   C) Oturum sahibi       → sorgu `userId` ile KAPSAMLANIR (IDOR koruması).
 *
 * ⚠️ PII MİNİMİZASYONU: Public görünüm müşteri adı, telefon, IP, tam e-posta
 * ve iç notları DÖNDÜRMEZ. Yalnızca siparişi tanımak için gerekenler.
 */

export interface PublicOrderView {
  orderNo: string
  status: OrderStatus
  statusLabel: string
  statusDescription: string
  createdAt: string

  platformName: string
  platformSlug: string
  serviceName: string
  variantLabel: string
  unitLabel: string

  targetHandle: string | null
  targetCanonicalUrl: string | null

  quantity: number
  deliveredQuantity: number
  progressPercent: number

  currency: string
  unitPriceMinor: number
  listSubtotalMinor: number
  discountMinor: number
  subtotalMinor: number
  taxRateBp: number
  taxAmountMinor: number
  totalMinor: number

  /** Müşteriye görünür olaylar, eskiden yeniye */
  timeline: Array<{
    type: string
    label: string
    at: string
    message: string | null
  }>

  /** Stepper: hangi adımdayız */
  steps: Array<{ step: number; label: string; state: 'done' | 'current' | 'upcoming' }>

  /** Maskelenmiş e-posta — doğru siparişte olduğunu teyit için */
  maskedEmail: string | null

  /**
   * OPERASYON İLERLEMESİ — müşteri görünümü.
   *
   * ⚠️ Buraya İÇ bilgi GİRMEZ: operatör adı, iç not, teknik hata sebebi,
   * atama, maliyet ve sağlayıcı bilgileri yoktur. Durum metni
   * `CUSTOMER_FULFILLMENT_VIEW` üzerinden güvenli dile çevrilir.
   */
  fulfillment: {
    label: string
    description: string
    tone: string
    /** Müşteri tarafı yoklamaya devam etsin mi? */
    polling: boolean
    requested: number
    delivered: number
    remaining: number
    percent: number
    /** METRIC modunda: başlangıç / mevcut / hedef */
    initialMetric: number | null
    currentMetric: number | null
    goalMetric: number | null
    startedAt: string | null
    completedAt: string | null
    /** SUPPORT+ tarafından yazılmış kontrollü müşteri notu */
    customerNote: string | null
  } | null
}

export class OrderAccessDeniedError extends Error {
  readonly code = 'ORDER_NOT_FOUND'
  constructor() {
    // Bilgi sızdırmamak için "bulunamadı" ile aynı mesaj:
    // var/yok ayrımı yapılırsa enumeration mümkün olur.
    super('Sipariş bulunamadı. Sipariş numarası ve e-posta adresini kontrol edin.')
    this.name = 'OrderAccessDeniedError'
  }
}

function maskEmail(email: string | null): string | null {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!local || !domain) return null
  const head = local.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`
}

const ORDER_INCLUDE = {
  fulfillment: {
    select: {
      status: true,
      requestedQuantity: true,
      deliveredQuantity: true,
      initialMetric: true,
      currentMetric: true,
      startedAt: true,
      completedAt: true,
      customerNote: true,
    },
  },
  platform: { select: { name: true, slug: true } },
  service: { select: { name: true, unitLabel: true } },
  serviceVariant: { select: { customerLabel: true } },
  target: { select: { handle: true, normalized: true, canonicalUrl: true } },
  items: { select: { deliveredQuantity: true, quantity: true } },
  events: {
    where: { isCustomerVisible: true },
    orderBy: { createdAt: 'asc' as const },
    select: { type: true, createdAt: true, message: true, toStatus: true },
  },
} as const

const EVENT_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Sipariş oluşturuldu',
  ORDER_CONFIRMED: 'Sipariş onaylandı',
  FULFILLMENT_COMPLETED: 'İşlem tamamlandı',
  TARGET_CONFIRMED: 'Hedef onaylandı',
  PAYMENT_PENDING: 'Ödeme bekleniyor',
  PAYMENT_RECEIVED: 'Ödeme alındı',
  PAYMENT_FAILED: 'Ödeme başarısız',
  PROCESSING: 'Hazırlanıyor',
  STARTED: 'İşlem başladı',
  PROGRESS_UPDATED: 'İlerleme güncellendi',
  PARTIAL: 'Kısmen tamamlandı',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal edildi',
  REFUNDED: 'İade edildi',
  STATUS_CHANGED: 'Durum güncellendi',
}

type OrderWithRelations = Awaited<
  ReturnType<typeof db.order.findFirst<{ include: typeof ORDER_INCLUDE }>>
>

function toPublicView(order: NonNullable<OrderWithRelations>): PublicOrderView {
  const delivered = order.items.reduce((n, i) => n + i.deliveredQuantity, 0)
  const percent = order.quantity > 0 ? Math.round((delivered / order.quantity) * 100) : 0
  const meta = ORDER_STATUS_META[order.status as OrderStatus]

  const currentStep = meta.step
  const steps = CUSTOMER_TIMELINE_STEPS.map((s) => ({
    step: s.step,
    label: s.label,
    state:
      currentStep < 0
        ? ('upcoming' as const)
        : s.step < currentStep
          ? ('done' as const)
          : s.step === currentStep
            ? ('current' as const)
            : ('upcoming' as const),
  }))

  return {
    orderNo: order.orderNo,
    status: order.status as OrderStatus,
    statusLabel: meta.label,
    statusDescription: meta.description,
    createdAt: order.createdAt.toISOString(),

    platformName: order.platform.name,
    platformSlug: order.platform.slug,
    serviceName: order.service.name,
    variantLabel: order.serviceVariant.customerLabel,
    unitLabel: order.service.unitLabel,

    targetHandle: order.target.handle ?? order.target.normalized,
    targetCanonicalUrl: order.target.canonicalUrl,

    quantity: order.quantity,
    deliveredQuantity: delivered,
    progressPercent: percent,

    currency: order.currency,
    unitPriceMinor: order.unitPriceMinor,
    listSubtotalMinor: order.listSubtotalMinor,
    discountMinor: order.discountMinor,
    subtotalMinor: order.subtotalMinor,
    taxRateBp: order.taxRateBp,
    taxAmountMinor: order.taxAmountMinor,
    totalMinor: order.totalMinor,

    timeline: order.events.map((e) => ({
      type: e.type,
      label: EVENT_LABELS[e.type] ?? 'Güncelleme',
      at: e.createdAt.toISOString(),
      message: e.message,
    })),
    steps,
    maskedEmail: maskEmail(order.customerEmail ?? order.guestEmail),
    fulfillment: toCustomerFulfillment(order.fulfillment),
  }
}

/** İç fulfillment kaydını GÜVENLİ müşteri görünümüne çevirir. */
function toCustomerFulfillment(
  f: {
    status: string
    requestedQuantity: number
    deliveredQuantity: number
    initialMetric: number | null
    currentMetric: number | null
    startedAt: Date | null
    completedAt: Date | null
    customerNote: string | null
  } | null,
): PublicOrderView['fulfillment'] {
  if (!f) return null
  const view = CUSTOMER_FULFILLMENT_VIEW[f.status as FulfillmentStatus]
  const p = computeFulfillmentProgress({
    requestedQuantity: f.requestedQuantity,
    deliveredQuantity: f.deliveredQuantity,
  })
  return {
    label: view.label,
    description: view.description,
    tone: view.tone,
    polling: view.polling,
    requested: p.requested,
    delivered: p.delivered,
    remaining: p.remaining,
    percent: p.percent,
    initialMetric: f.initialMetric,
    currentMetric: f.currentMetric,
    goalMetric: goalMetric(f.initialMetric, p.requested),
    startedAt: f.startedAt?.toISOString() ?? null,
    completedAt: f.completedAt?.toISOString() ?? null,
    customerNote: f.customerNote,
  }
}

/** A) Misafir sorgusu: orderNo + e-posta İKİSİ BİRDEN doğru olmalı. */
export async function lookupOrderByEmail(
  orderNoRaw: string,
  emailRaw: string,
): Promise<PublicOrderView> {
  const orderNo = normalizeOrderNo(orderNoRaw)
  const email = emailRaw.trim().toLowerCase()

  const order = await db.order.findUnique({ where: { orderNo }, include: ORDER_INCLUDE })
  if (!order) throw new OrderAccessDeniedError()

  const stored = (order.customerEmail ?? order.guestEmail ?? '').trim().toLowerCase()
  // Sabit süreli karşılaştırma — zamanlama üzerinden e-posta tahmini engellenir
  if (!stored || !safeEmailEquals(stored, email)) throw new OrderAccessDeniedError()

  return toPublicView(order)
}

/** B) İmzalı takip linki. */
export async function lookupOrderByToken(
  orderNoRaw: string,
  token: string,
): Promise<PublicOrderView> {
  const orderNo = normalizeOrderNo(orderNoRaw)
  const order = await db.order.findUnique({ where: { orderNo }, include: ORDER_INCLUDE })
  if (!order?.accessTokenHash) throw new OrderAccessDeniedError()
  if (order.accessExpiresAt && order.accessExpiresAt < new Date()) throw new OrderAccessDeniedError()
  if (!verifyAccessToken(token, order.accessTokenHash)) throw new OrderAccessDeniedError()
  return toPublicView(order)
}

/**
 * C) Oturum sahibi.
 * ⚠️ IDOR: `userId` SORGUNUN İÇİNDE. Önce bul-sonra-kontrol et YAPILMAZ.
 */
export async function getOrderForUser(
  orderNoRaw: string,
  userId: string,
): Promise<PublicOrderView> {
  const order = await db.order.findFirst({
    where: { orderNo: normalizeOrderNo(orderNoRaw), userId },
    include: ORDER_INCLUDE,
  })
  if (!order) throw new OrderAccessDeniedError()
  return toPublicView(order)
}

/** Kullanıcının sipariş listesi — aktif / geçmiş ayrımıyla. */
export async function listOrdersForUser(userId: string) {
  const orders = await db.order.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      orderNo: true,
      status: true,
      createdAt: true,
      quantity: true,
      totalMinor: true,
      currency: true,
      platform: { select: { name: true, slug: true } },
      service: { select: { name: true, unitLabel: true } },
      target: { select: { handle: true, normalized: true } },
      items: { select: { deliveredQuantity: true } },
    },
  })

  const TERMINAL: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED'])

  return orders.map((o) => ({
    orderNo: o.orderNo,
    status: o.status as OrderStatus,
    statusLabel: ORDER_STATUS_META[o.status as OrderStatus].label,
    createdAt: o.createdAt.toISOString(),
    platformName: o.platform.name,
    platformSlug: o.platform.slug,
    serviceName: o.service.name,
    unitLabel: o.service.unitLabel,
    targetHandle: o.target.handle ?? o.target.normalized,
    quantity: o.quantity,
    deliveredQuantity: o.items.reduce((n, i) => n + i.deliveredQuantity, 0),
    totalMinor: o.totalMinor,
    currency: o.currency,
    isActive: !TERMINAL.has(o.status),
  }))
}
