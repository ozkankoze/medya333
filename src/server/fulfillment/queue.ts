import 'server-only'

import type { FulfillmentStatus, OrderStatus, UserRole } from '@/lib/enums'
import { ROLE_LEVEL } from '@/lib/enums'
import {
  computeFulfillmentProgress,
  QUEUE_BUCKETS,
  QUEUE_PRIORITY,
  type QueueBucket,
} from '@/lib/fulfillment/status'
import {
  computeWaiting,
  type WaitingKind,
} from '@/lib/fulfillment/waiting'
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

/**
 * ⭐ SIRALAMA SEÇENEKLERİ (Faz 8)
 *
 * Her seçenek `id` ile biter. Bu bir detay değil, sayfalamanın TEMELİDİR:
 * `createdAt` iki kayıtta aynı olabilir (aynı webhook toplu işlendiğinde
 * milisaniyeye kadar aynı olur). Tie-breaker olmadan bir kayıt iki sayfada
 * birden görünür veya hiç görünmez.
 */
const SORT_ORDERS = {
  /** En yeni sipariş ÜSTTE. Varsayılan — yeni iş asla gözden kaçmaz. */
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  /** En eski önce — FIFO çalışan ekipler için. */
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  /**
   * Durum önceliği: READY → PROCESSING → STARTED → PARTIAL → COMPLETED →
   * FAILED → REVIEW_REQUIRED.
   *
   * ⚠️ Bu sıra PostgreSQL enum TANIM SIRASIDIR (`FulfillmentStatus`), uygulama
   * içindeki `QUEUE_PRIORITY` haritası değil. İkisi ilk dört adımda birebir
   * aynıdır; son üçünde ayrışır (QUEUE_PRIORITY incelemeyi tamamlanandan önce
   * sayar). Enum sırası veritabanında değiştirilemediği için burada tek
   * kaynak enum'dur — ve inceleme kuyruğu zaten kendi sekmesinden
   * (`bucket=review`) izlenir.
   */
  priority: [{ status: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
} as const

export type QueueSort = keyof typeof SORT_ORDERS
export const QUEUE_SORTS = Object.keys(SORT_ORDERS) as QueueSort[]

export const QUEUE_SORT_LABELS: Record<QueueSort, string> = {
  newest: 'En yeni',
  oldest: 'En eski',
  priority: 'Durum önceliği',
}

export const DEFAULT_QUEUE_PAGE_SIZE = 50
const MAX_QUEUE_PAGE_SIZE = 100

export interface QueueParams {
  bucket?: QueueBucket | 'all'
  status?: FulfillmentStatus
  /** Siparişin kendi durumu (fulfillment durumundan ayrıdır) */
  orderStatus?: OrderStatus
  platformSlug?: string
  serviceSlug?: string
  variantSlug?: string
  /** Belirli bir operatör; `'unassigned'` atanmamış işleri getirir */
  assignedToUserId?: string
  /** Yalnızca bana atanmış işler */
  mineOnly?: boolean
  /** Sipariş no · müşteri e-postası · hedef */
  search?: string
  /** ISO tarih (dahil) */
  createdFrom?: string
  /** ISO tarih (dahil) */
  createdTo?: string
  sort?: QueueSort
  /**
   * ⚠️ CURSOR — OFFSET DEĞİL.
   * Bir önceki sayfanın son (veya ilk) kaydının kimliği. Prisma bu kimliği
   * sıralama alanlarının değerlerine çevirip keyset sorgusu üretir.
   */
  cursor?: string
  /** Cursor'dan hangi yöne gidiliyor */
  direction?: 'forward' | 'backward'
  pageSize?: number
}

export interface QueueRow {
  id: string
  orderNo: string
  status: FulfillmentStatus
  orderStatus: OrderStatus
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
  /**
   * ⭐ BEKLEME SÜRESİ (Faz 10)
   *
   * ⚠️ Yalnızca ÖLÇÜM. "gecikti" gibi bir yargı YOKTUR — tanımlı bir SLA
   * olmadan böyle bir yargı üretilemez (bkz. src/lib/fulfillment/waiting.ts).
   */
  waitingKind: WaitingKind
  waitingMs: number | null
  waitingLabel: string | null
}

export interface QueuePage {
  items: QueueRow[]
  sort: QueueSort
  bucket: QueueBucket | 'all'
  pageSize: number
  /** ⚠️ Gerçek DB verisi — sahte istatistik yok. */
  counts: {
    new: number
    active: number
    partial: number
    review: number
    completed: number
    mine: number
  }
  /** Uygulanan filtrelerdeki toplam kayıt (sayfa göstergesi için) */
  filteredTotal: number
  /** Sonraki sayfanın cursor'ı — yoksa null */
  nextCursor: string | null
  /** Önceki sayfanın cursor'ı — yoksa null */
  prevCursor: string | null
}

/**
 * ⚠️ Serbest metin aramasında `contains` kullanılırken kullanıcı girdisi
 * SQL'e string olarak GÖMÜLMEZ — Prisma parametreli sorgu üretir. Girdi ayrıca
 * uzunlukla sınırlanır ki pahalı tarama yapılamasın.
 */
function buildSearchFilter(raw: string) {
  const q = raw.trim().slice(0, 120)
  if (!q) return null

  const filters: Record<string, unknown>[] = [
    // Sipariş numarası — büyük harfe normalize, kısmi eşleşme
    { orderNo: { contains: q.toUpperCase() } },
    // Müşteri e-postası (kayıtlı ve misafir)
    { customerEmail: { contains: q.toLowerCase() } },
    { guestEmail: { contains: q.toLowerCase() } },
    // Hedef — @ işareti yazılmışsa temizlenir
    { target: { handle: { contains: q.replace(/^@/, ''), mode: 'insensitive' } } },
    { target: { normalized: { contains: q.replace(/^@/, ''), mode: 'insensitive' } } },
  ]
  return { OR: filters }
}

function buildWhere(params: QueueParams, viewerId: string): Record<string, unknown> {
  const orderWhere: Record<string, unknown> = {
    // ⚠️ İkinci kapı: yalnızca ödenmiş siparişlerin işleri.
    status: { in: PAID_ORDER_STATUSES },
  }
  const where: Record<string, unknown> = { order: orderWhere }

  if (params.status) {
    where.status = params.status
  } else if (params.bucket && params.bucket !== 'all') {
    where.status = { in: [...QUEUE_BUCKETS[params.bucket]] }
  }

  if (params.mineOnly) {
    where.assignedToUserId = viewerId
  } else if (params.assignedToUserId === 'unassigned') {
    where.assignedToUserId = null
  } else if (params.assignedToUserId) {
    where.assignedToUserId = params.assignedToUserId
  }

  if (params.orderStatus) {
    // ⚠️ Ödenmiş sipariş kapısını GEVŞETMEZ; onun içinde daraltır.
    orderWhere.status = PAID_ORDER_STATUSES.includes(params.orderStatus)
      ? params.orderStatus
      : { in: [] as OrderStatus[] }
  }
  if (params.platformSlug) orderWhere.platform = { slug: params.platformSlug }
  if (params.serviceSlug) orderWhere.service = { slug: params.serviceSlug }
  if (params.variantSlug) orderWhere.serviceVariant = { slug: params.variantSlug }

  if (params.search) {
    const search = buildSearchFilter(params.search)
    if (search) Object.assign(orderWhere, search)
  }

  const createdAt: Record<string, Date> = {}
  const from = params.createdFrom ? new Date(params.createdFrom) : null
  const to = params.createdTo ? new Date(params.createdTo) : null
  if (from && !Number.isNaN(from.getTime())) createdAt.gte = from
  if (to && !Number.isNaN(to.getTime())) {
    // Tarih (saatsiz) verildiyse o günün tamamı kapsanır.
    to.setHours(23, 59, 59, 999)
    createdAt.lte = to
  }
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt

  return where
}

const QUEUE_SELECT = {
  id: true,
  status: true,
  requestedQuantity: true,
  deliveredQuantity: true,
  assignedToUserId: true,
  createdAt: true,
  startedAt: true,
  targetSnapshot: true,
  assignedTo: { select: { name: true, email: true } },
  order: { select: { orderNo: true, status: true } },
} as const

type QueueRecord = {
  id: string
  status: string
  requestedQuantity: number
  deliveredQuantity: number
  assignedToUserId: string | null
  createdAt: Date
  startedAt: Date | null
  targetSnapshot: unknown
  assignedTo: { name: string | null; email: string } | null
  order: { orderNo: string; status: string }
}

function toRow(f: QueueRecord, now: number): QueueRow {
  const snap = f.targetSnapshot as TargetSnapshot | null
  const p = computeFulfillmentProgress({
    requestedQuantity: f.requestedQuantity,
    deliveredQuantity: f.deliveredQuantity,
  })
  return {
    id: f.id,
    orderNo: f.order.orderNo,
    status: f.status as FulfillmentStatus,
    orderStatus: f.order.status as OrderStatus,
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
    ...(() => {
      const w = computeWaiting(
        {
          status: f.status as FulfillmentStatus,
          createdAt: f.createdAt,
          startedAt: f.startedAt,
        },
        now,
      )
      return { waitingKind: w.kind, waitingMs: w.ms, waitingLabel: w.label }
    })(),
  }
}

/**
 * ⭐ OPERASYON KUYRUĞU — CURSOR TABANLI SAYFALAMA (Faz 8)
 *
 * ⚠️ NEDEN OFFSET DEĞİL?
 * `skip: (page-1)*size` ile sayfalanan bir kuyrukta, siz 2. sayfadayken yeni
 * bir sipariş gelirse tüm kayıtlar bir sıra kayar: 1. sayfanın son kaydı
 * 2. sayfanın başında TEKRAR görünür ve bir kayıt tamamen ATLANIR. Sürekli
 * yeni iş düşen bir operasyon kuyruğunda bu teorik değil, günlük bir hatadır.
 *
 * Cursor (keyset) sayfalamada sorgu "şu kayıttan sonrakiler" der; araya yeni
 * kayıt girmesi sayfa sınırlarını bozmaz.
 *
 * ⚠️ Sıralama HER ZAMAN `id` ile biter. Aynı `createdAt` değerine sahip iki
 * kayıt (toplu işlenen webhook'lar) tie-breaker olmadan kararsız sıralanır ve
 * cursor mantığı çöker.
 */
export async function listFulfillmentQueue(
  params: QueueParams,
  viewer: { userId: string; role: UserRole },
): Promise<QueuePage> {
  const pageSize = Math.min(MAX_QUEUE_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_QUEUE_PAGE_SIZE))
  const sort: QueueSort = params.sort && params.sort in SORT_ORDERS ? params.sort : 'newest'
  const orderBy = SORT_ORDERS[sort] as unknown as Record<string, 'asc' | 'desc'>[]
  const where = buildWhere(params, viewer.userId)
  const backward = params.direction === 'backward' && Boolean(params.cursor)

  /**
   * `take: pageSize + 1` — bir fazla çekip "daha var mı?" sorusunu ayrı bir
   * COUNT sorgusu olmadan cevaplarız. Negatif `take` geriye doğru okur.
   */
  const takeCount = pageSize + 1

  const [rows, filteredTotal, grouped, mine] = await Promise.all([
    db.fulfillment.findMany({
      where,
      orderBy,
      select: QUEUE_SELECT,
      take: backward ? -takeCount : takeCount,
      ...(params.cursor
        ? { cursor: { id: params.cursor }, skip: 1 }
        : {}),
    }),
    db.fulfillment.count({ where }),
    db.fulfillment.groupBy({
      by: ['status'],
      _count: { _all: true },
      // ⚠️ Sekme sayaçları FİLTRELERDEN BAĞIMSIZDIR: arama yaparken sekme
      // sayıları değişirse operatör "işler kayboldu" sanır.
      where: { order: { status: { in: PAID_ORDER_STATUSES } } },
    }),
    db.fulfillment.count({
      where: {
        assignedToUserId: viewer.userId,
        status: { in: ['PROCESSING', 'STARTED', 'PARTIAL'] },
      },
    }),
  ])

  const hasExtra = rows.length > pageSize
  // Fazladan çekilen kayıt, okuma yönüne göre baştan veya sondan atılır.
  const pageRows = hasExtra ? (backward ? rows.slice(1) : rows.slice(0, pageSize)) : rows

  const first = pageRows[0]
  const last = pageRows[pageRows.length - 1]

  /**
   * İleri giderken: fazladan kayıt varsa sonraki sayfa vardır. Geri
   * giderken sonraki sayfa her zaman vardır (oradan geldik).
   */
  const nextCursor = backward ? (last?.id ?? null) : hasExtra ? (last?.id ?? null) : null
  const prevCursor = backward
    ? hasExtra
      ? (first?.id ?? null)
      : null
    : params.cursor
      ? (first?.id ?? null)
      : null

  const byStatus = Object.fromEntries(
    grouped.map((g) => [g.status, (g._count as { _all: number })._all]),
  )
  const bucketCount = (b: QueueBucket) =>
    QUEUE_BUCKETS[b].reduce((n, st) => n + (byStatus[st] ?? 0), 0)

  /**
   * ⚠️ TEK BİR "ŞİMDİ" — sayfadaki her satır AYNI ana göre ölçülür.
   * Satır başına `Date.now()` çağırmak, uzun sayfalarda satırlar arasında
   * milisaniyelik tutarsızlık üretir ve sıralamayı açıklanamaz kılar.
   */
  const now = Date.now()

  return {
    items: pageRows.map((r) => toRow(r as QueueRecord, now)),
    sort,
    bucket: params.bucket ?? 'all',
    pageSize,
    counts: {
      new: bucketCount('new'),
      active: bucketCount('active'),
      partial: bucketCount('partial'),
      review: bucketCount('review'),
      completed: bucketCount('completed'),
      mine,
    },
    filteredTotal,
    nextCursor,
    prevCursor,
  }
}

/**
 * Filtre açılır listeleri için katalog seçenekleri.
 * ⚠️ Yalnızca ADLAR ve slug'lar döner; fiyat, maliyet veya iç alan yoktur.
 */
export async function listQueueFilterOptions() {
  const platforms = await db.platform.findMany({
    orderBy: { sortOrder: 'asc' },
    select: {
      slug: true,
      name: true,
      services: {
        orderBy: { sortOrder: 'asc' },
        select: {
          slug: true,
          name: true,
          variants: {
            orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
            select: { slug: true, customerLabel: true },
          },
        },
      },
    },
  })
  return platforms
}

// ---------------------------------------------------------------------------

export interface FulfillmentDetail extends QueueRow {
  /**
   * ⚠️ HEDEF — YALNIZCA GÜVENLİ ALANLAR.
   * Snapshot'ta parola, token, oturum veya yetkilendirme başlığı YOKTUR ve
   * olamaz (bkz. `TargetSnapshot`). Operatörün işi yapabilmesi için gereken
   * tek şey hedefin herkese açık adresi ve tipidir.
   */
  targetType: string
  targetCanonicalUrl: string | null
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

  // ⚠️ Ölçüm — yargı değil. Detay ekranında da "gecikti" yazmaz.
  const waiting = computeWaiting(
    {
      status: f.status as FulfillmentStatus,
      createdAt: f.createdAt,
      startedAt: f.startedAt,
    },
    Date.now(),
  )

  return {
    waitingKind: waiting.kind,
    waitingMs: waiting.ms,
    waitingLabel: waiting.label,
    id: f.id,
    orderNo: f.order.orderNo,
    status: f.status as FulfillmentStatus,
    orderStatus: f.order.status as OrderStatus,
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
    targetType: snap?.targetType ?? '—',
    targetCanonicalUrl: snap?.targetCanonicalUrl ?? null,
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
