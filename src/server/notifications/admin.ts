import 'server-only'

import type { UserRole } from '@/lib/enums'
import { ROLE_LEVEL } from '@/lib/enums'
import { db } from '@/server/db'
import { notifyOrderEvent } from './index'

/**
 * ⭐ BİLDİRİM İZLEME — YÖNETİM OKUMA KATMANI (Faz 9)
 *
 * Faz 8'de bildirim kayıtları tutulmaya başlandı ama görülebilecekleri bir yer
 * yoktu: "müşteriye e-posta gitti mi?" sorusunun cevabı yalnızca doğrudan
 * veritabanı sorgusuydu.
 *
 * ⚠️ BU EKRAN PII SIZDIRMAZ. Kayıtta zaten ham adres yok (maskeli tutuluyor);
 * burada ayrıca sağlayıcı ham cevabı, takip token'ı ve API anahtarı DÖNMEZ.
 * `failureReason` yalnızca sağlayıcının kısa durum açıklamasıdır ve 300
 * karakterle sınırlıdır.
 */

export type NotificationFilter = 'all' | 'failed' | 'sent' | 'skipped'

export interface NotificationRow {
  id: string
  template: string
  orderNo: string
  /** ⚠️ MASKELİ. Ham e-posta hiçbir zaman DB'ye yazılmadı. */
  recipientMasked: string
  status: string
  provider: string
  attempts: number
  failureReason: string | null
  createdAt: string
  sentAt: string | null
}

export interface NotificationPage {
  items: NotificationRow[]
  counts: { total: number; failed: number; sent: number; skipped: number; pending: number }
  nextCursor: string | null
  prevCursor: string | null
  filter: NotificationFilter
}

const STATUS_FOR_FILTER: Record<Exclude<NotificationFilter, 'all'>, string[]> = {
  failed: ['FAILED'],
  sent: ['SENT'],
  skipped: ['SKIPPED', 'PENDING'],
}

const PAGE_SIZE = 50

/**
 * ⚠️ Cursor sayfalama — OFFSET değil. Bildirim tablosu her siparişte büyür;
 * kuyrukta olduğu gibi burada da yeni kayıt araya girdiğinde sayfa sınırları
 * bozulmamalı. Sıralama `createdAt DESC + id DESC` (tie-breaker zorunlu).
 */
export async function listNotifications(params: {
  filter?: NotificationFilter
  search?: string
  cursor?: string
  direction?: 'forward' | 'backward'
}): Promise<NotificationPage> {
  const filter: NotificationFilter = params.filter ?? 'failed'

  const where: Record<string, unknown> = {}
  if (filter !== 'all') where.status = { in: STATUS_FOR_FILTER[filter] }
  if (params.search) {
    const q = params.search.trim().slice(0, 40).toUpperCase()
    if (q) where.order = { orderNo: { contains: q } }
  }

  const backward = params.direction === 'backward' && Boolean(params.cursor)
  const take = PAGE_SIZE + 1

  const [rows, grouped] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: backward ? -take : take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        template: true,
        recipientMasked: true,
        status: true,
        provider: true,
        attempts: true,
        failureReason: true,
        createdAt: true,
        sentAt: true,
        order: { select: { orderNo: true } },
      },
    }),
    db.notification.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const hasExtra = rows.length > PAGE_SIZE
  const page = hasExtra ? (backward ? rows.slice(1) : rows.slice(0, PAGE_SIZE)) : rows

  const byStatus = Object.fromEntries(
    grouped.map((g) => [g.status, (g._count as { _all: number })._all]),
  )
  const n = (k: string) => byStatus[k] ?? 0

  return {
    items: page.map((r) => ({
      id: r.id,
      template: r.template,
      orderNo: r.order.orderNo,
      recipientMasked: r.recipientMasked,
      status: r.status,
      provider: r.provider,
      attempts: r.attempts,
      failureReason: r.failureReason,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
    })),
    counts: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      failed: n('FAILED'),
      sent: n('SENT'),
      skipped: n('SKIPPED'),
      pending: n('PENDING'),
    },
    nextCursor: backward
      ? (page[page.length - 1]?.id ?? null)
      : hasExtra
        ? (page[page.length - 1]?.id ?? null)
        : null,
    prevCursor: backward
      ? hasExtra
        ? (page[0]?.id ?? null)
        : null
      : params.cursor
        ? (page[0]?.id ?? null)
        : null,
    filter,
  }
}

// ---------------------------------------------------------------------------
// Yeniden gönderim
// ---------------------------------------------------------------------------

export class NotificationRetryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'NotificationRetryError'
  }
}

export interface RetryResult {
  outcome: 'SENT' | 'FAILED'
  attempts: number
}

/**
 * ⭐ BAŞARISIZ BİLDİRİMİ ELLE YENİDEN DENER.
 *
 * ⚠️ OTOMATİK TEKRAR YOKTUR. Zamanlanmış bir yeniden deneme kuyruğu
 * eklenmedi: sağlayıcı yapılandırılmamışken çalışan bir retry döngüsü,
 * saatte binlerce başarısız denemeyi log'a yazmaktan başka bir şey yapmaz.
 * Yeniden deneme, sorunun düzeltildiğini BİLEN bir insanın kararıdır.
 *
 * ⚠️ IDEMPOTENCY BOZULMAZ. Yeni bir `Notification` satırı AÇILMAZ —
 * `unique(orderEventId, channel)` zaten buna izin vermez. Mevcut kayıt
 * güncellenir ve `attempts` artar. Yani "aynı olay için tek bildirim"
 * kuralı yeniden denemeden sonra da geçerlidir.
 *
 * ⚠️ Yalnızca BAŞARISIZ kayıtlar denenebilir. `SENT` bir bildirimi tekrar
 * göndermek müşteriye ikinci bir e-posta atmak demektir.
 */
export async function retryNotification(
  notificationId: string,
  actor: { userId: string; role: UserRole },
): Promise<RetryResult> {
  if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.ADMIN) {
    throw new NotificationRetryError(
      'FORBIDDEN',
      'Bildirim yeniden gönderimi yalnızca yöneticiler tarafından yapılabilir.',
      403,
    )
  }

  const existing = await db.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, status: true, orderEventId: true, attempts: true },
  })
  if (!existing) {
    throw new NotificationRetryError('NOT_FOUND', 'Bildirim kaydı bulunamadı.', 404)
  }
  if (existing.status !== 'FAILED') {
    throw new NotificationRetryError(
      'NOT_RETRYABLE',
      'Yalnızca başarısız bildirimler yeniden gönderilebilir.',
      409,
    )
  }

  /**
   * ⚠️ Kaydı PENDING'e alıp `notifyOrderEvent`i çağırmak İŞE YARAMAZDI:
   * o fonksiyon yeni kayıt açmayı dener ve P2002 alıp DUPLICATE döner.
   * Bu yüzden mevcut kaydı silip yeniden ürettiriyoruz — silme ve yeniden
   * oluşturma TEK transaction'da değil, çünkü gönderim ağ çağrısı içerir;
   * ama `orderEventId` unique olduğu için arada ikinci bir kayıt oluşamaz.
   */
  await db.notification.delete({ where: { id: notificationId } })

  const result = await notifyOrderEvent(existing.orderEventId)

  // Yeni kaydın deneme sayacı, önceki denemeleri de kapsasın.
  const fresh = await db.notification.findFirst({
    where: { orderEventId: existing.orderEventId },
    select: { id: true, attempts: true },
  })
  if (fresh) {
    await db.notification.update({
      where: { id: fresh.id },
      data: { attempts: existing.attempts + fresh.attempts },
    })
  }

  return {
    outcome: result.outcome === 'SENT' ? 'SENT' : 'FAILED',
    attempts: existing.attempts + (fresh?.attempts ?? 1),
  }
}

// ---------------------------------------------------------------------------
// Operasyon uyarıları
// ---------------------------------------------------------------------------

export interface OperationAlerts {
  /** Gönderilemeyen bildirimler */
  failedNotifications: number
  /** İnceleme bekleyen işler */
  reviewRequired: number
  /** 24 saatten uzun süredir READY'de bekleyen işler */
  waitingOver24h: number
  /** 30 gün içinde garantisi bitecek tamamlanmış işler */
  guaranteeEndingSoon: number
  /**
   * ⚠️ Garanti süresi TANIMLI OLMAYAN aktif varyant sayısı.
   * Bu bir HATA DEĞİL, bir bilgidir: o üründe garanti yoktur. Tahmini bir
   * süre atanmaz.
   */
  variantsWithoutGuarantee: number
}

/** Uzun bekleme eşiği — 24 saat. */
const WAITING_THRESHOLD_MS = 24 * 60 * 60 * 1000
/** Garanti bitişi yaklaşma eşiği — 30 gün. */
const GUARANTEE_SOON_MS = 30 * 24 * 60 * 60 * 1000

/**
 * ⚠️ BU SAYILAR "GECİKTİ" DEMEZ.
 *
 * Sistemde tanımlı bir SLA (hedef teslim süresi) YOKTUR. Uydurma bir eşiğe
 * bakıp "gecikti" demek, operasyon ekibine gerçek olmayan bir aciliyet
 * yaratır ve zamanla tüm uyarıların yok sayılmasına yol açar.
 *
 * Bunun yerine ölçülebilir bir olgu bildirilir: "24 saatten uzun süredir
 * sırada bekleyen N iş var." Bunun kabul edilebilir olup olmadığına insan
 * karar verir.
 */
export async function getOperationAlerts(now: Date = new Date()): Promise<OperationAlerts> {
  const waitingSince = new Date(now.getTime() - WAITING_THRESHOLD_MS)
  const guaranteeUntil = new Date(now.getTime() + GUARANTEE_SOON_MS)

  const [failedNotifications, reviewRequired, waitingOver24h, guaranteeEndingSoon, noGuarantee] =
    await Promise.all([
      db.notification.count({ where: { status: 'FAILED' } }),
      db.fulfillment.count({ where: { status: { in: ['REVIEW_REQUIRED', 'FAILED'] } } }),
      db.fulfillment.count({
        where: { status: 'READY', createdAt: { lt: waitingSince } },
      }),
      db.fulfillment.count({
        where: {
          status: 'COMPLETED',
          guaranteeEndsAt: { not: null, gte: now, lte: guaranteeUntil },
        },
      }),
      db.serviceVariant.count({
        where: { isActive: true, OR: [{ refillDays: null }, { refillDays: 0 }] },
      }),
    ])

  return {
    failedNotifications,
    reviewRequired,
    waitingOver24h,
    guaranteeEndingSoon,
    variantsWithoutGuarantee: noGuarantee,
  }
}
