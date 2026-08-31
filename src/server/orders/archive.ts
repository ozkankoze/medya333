import 'server-only'

import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'

/**
 * ⭐ SİPARİŞ ARŞİVİ VE SİLME — GERÇEK MÜŞTERİ SİPARİŞLERİ
 *
 * ⚠️⚠️ BU MODÜL `Order` TABLOSUNA DOKUNUR — KASA DEFTERİNE DEĞİL.
 * Kasa'daki `ManualOrder` işletmenin kendi defteridir ve serbestçe silinir.
 * Buradaki kayıtlar gerçek müşteri siparişleridir: ödeme kaydı, iade kaydı,
 * onay snapshot'ı ve müşterinin takip linki bunlara bağlıdır.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ İKİ AYRI İŞLEM VARDIR ve karıştırılmamalıdır:
 *
 *   ARŞİVLE → kayıt yerinde durur, yalnızca İş Kuyruğu'ndan kalkar.
 *             Geri alınabilir. Para izi bozulmaz.
 *   SİL     → kayıt gerçekten gider. YALNIZCA ödeme kaydı olmayan
 *             siparişlerde mümkündür.
 *
 * ⚠️ NEDEN HER SİPARİŞ SİLİNEMİYOR?
 *
 * Veritabanı zaten izin vermiyor: `Payment` ve `Refund` tablolarının
 * yabancı anahtarları ON DELETE RESTRICT. Yani ödemesi olan bir siparişi
 * silmeye çalışmak, uygulama ne yaparsa yapsın, veritabanı hatasıyla
 * biter. Buradaki kontrol o hatayı ANLAŞILIR bir mesaja çevirmek içindir;
 * korumanın kendisi veritabanındadır.
 *
 * ⚠️ SİLME NEYİ BERABERİNDE GÖTÜRÜR (ON DELETE CASCADE):
 *     OrderItem · OrderEvent · Fulfillment · Notification
 * Yani sipariş kalemi, TÜM olay geçmişi, operasyon kaydı ve gönderilmiş
 * bildirim kayıtları da silinir. Terk edilmiş bir sepet için doğru; gerçek
 * bir iş için yanlıştır — o yüzden gerçek işler zaten silinemiyor.
 *
 * ⚠️ MÜŞTERİNİN TAKİP LİNKİ SİLİNEN SİPARİŞTE 404 VERİR. Ödemesiz bir
 * siparişte bunun pratik bir bedeli yok (müşteri zaten ödemedi), ama
 * bilinerek kabul edilmiş bir sonuçtur.
 */

export class OrderArchiveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'OrderArchiveError'
  }
}

interface Actor {
  actorId: string
  actorIpHash?: string | null
}

/** Siparişi İş Kuyruğu'ndan kaldırır. Kayıt ve para izi yerinde kalır. */
export async function archiveOrder(orderNo: string, actor: Actor) {
  const order = await db.order.findUnique({
    where: { orderNo },
    select: { id: true, orderNo: true, status: true, archivedAt: true },
  })
  if (!order) throw new OrderArchiveError('NOT_FOUND', 'Sipariş bulunamadı.', 404)
  if (order.archivedAt) {
    throw new OrderArchiveError('ALREADY_ARCHIVED', 'Bu sipariş zaten arşivde.')
  }

  const updated = await db.order.update({
    where: { id: order.id },
    data: { archivedAt: new Date(), archivedById: actor.actorId },
    select: { id: true, orderNo: true, archivedAt: true },
  })

  await writeAudit({
    actorId: actor.actorId,
    actorIpHash: actor.actorIpHash ?? null,
    action: 'order.archive',
    entityType: 'Order',
    entityId: order.id,
    before: { archivedAt: null },
    after: { archivedAt: updated.archivedAt, orderNo: order.orderNo },
  })

  return updated
}

/** Arşivden çıkarır — sipariş kuyruğa geri döner. */
export async function unarchiveOrder(orderNo: string, actor: Actor) {
  const order = await db.order.findUnique({
    where: { orderNo },
    select: { id: true, orderNo: true, archivedAt: true },
  })
  if (!order) throw new OrderArchiveError('NOT_FOUND', 'Sipariş bulunamadı.', 404)
  if (!order.archivedAt) {
    throw new OrderArchiveError('NOT_ARCHIVED', 'Bu sipariş arşivde değil.')
  }

  const updated = await db.order.update({
    where: { id: order.id },
    data: { archivedAt: null, archivedById: null },
    select: { id: true, orderNo: true },
  })

  await writeAudit({
    actorId: actor.actorId,
    actorIpHash: actor.actorIpHash ?? null,
    action: 'order.unarchive',
    entityType: 'Order',
    entityId: order.id,
    before: { archivedAt: order.archivedAt },
    after: { archivedAt: null, orderNo: order.orderNo },
  })

  return updated
}

export interface DeletableCheck {
  deletable: boolean
  /** Neden silinemiyor — arayüzde aynen gösterilir. */
  reason: string | null
  paymentCount: number
  refundCount: number
}

/**
 * Bir siparişin silinip silinemeyeceğini söyler.
 *
 * ⚠️ ARAYÜZ BU CEVABI KULLANIR ama ona GÜVENMEZ. Düğmeyi gizlemek bir
 * koruma değildir; asıl engel `deleteOrder` içindeki kontrol ve nihayetinde
 * veritabanının RESTRICT kısıtıdır.
 */
export async function checkDeletable(orderNo: string): Promise<DeletableCheck> {
  const order = await db.order.findUnique({
    where: { orderNo },
    select: {
      id: true,
      _count: { select: { payments: true, refunds: true } },
    },
  })
  if (!order) throw new OrderArchiveError('NOT_FOUND', 'Sipariş bulunamadı.', 404)

  const paymentCount = order._count.payments
  const refundCount = order._count.refunds

  if (paymentCount > 0 || refundCount > 0) {
    return {
      deletable: false,
      reason:
        'Bu siparişin ödeme kaydı var. Ödeme ve iade kayıtları sipariş silinerek yok edilemez — ' +
        'kuyruktan kaldırmak için arşivleyin.',
      paymentCount,
      refundCount,
    }
  }

  return { deletable: true, reason: null, paymentCount: 0, refundCount: 0 }
}

/**
 * ⚠️ GERÇEKTEN SİLER — yalnızca ödeme/iade kaydı YOKSA.
 *
 * Silinen sipariş geri getirilemez. Beraberinde giden CASCADE kapsamı
 * dosya başında yazılı.
 */
export async function deleteOrder(orderNo: string, actor: Actor) {
  const order = await db.order.findUnique({
    where: { orderNo },
    select: {
      id: true,
      orderNo: true,
      status: true,
      totalMinor: true,
      customerEmail: true,
      guestEmail: true,
      createdAt: true,
      _count: { select: { payments: true, refunds: true } },
    },
  })
  if (!order) throw new OrderArchiveError('NOT_FOUND', 'Sipariş bulunamadı.', 404)

  if (order._count.payments > 0 || order._count.refunds > 0) {
    throw new OrderArchiveError(
      'HAS_PAYMENT',
      'Ödeme kaydı olan sipariş silinemez. Kuyruktan kaldırmak için arşivleyin.',
    )
  }

  /**
   * ⚠️ DENETİM KAYDI SİLMEDEN ÖNCE YAZILIR ve siparişin ÖZETİNİ taşır.
   * Sonra yazılsaydı, silme başarısız olduğunda gerçekleşmemiş bir olay
   * kaydedilmiş olurdu. Özet olmadan ise denetim satırı "bir sipariş
   * silindi" demekten öteye geçmez — hangisi, ne kadardı, bilinemezdi.
   *
   * ⚠️ `entityId` silinen satırın kimliğidir ve o satır artık yok. AuditLog
   * bilinçli olarak yabancı anahtar TAŞIMAZ; taşısaydı sipariş silinirken
   * denetim kaydı da CASCADE ile silinir, yani silme işleminin izi silme
   * işlemiyle birlikte yok olurdu.
   */
  await writeAudit({
    actorId: actor.actorId,
    actorIpHash: actor.actorIpHash ?? null,
    action: 'order.delete',
    entityType: 'Order',
    entityId: order.id,
    before: {
      orderNo: order.orderNo,
      status: order.status,
      totalMinor: order.totalMinor,
      email: order.customerEmail ?? order.guestEmail,
      createdAt: order.createdAt,
    },
    after: null,
  })

  await db.order.delete({ where: { id: order.id } })

  return { orderNo: order.orderNo }
}
