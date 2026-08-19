import 'server-only'

import { db } from '@/server/db'
import { notifyOrderEvent } from '@/server/notifications'
import { createAccessToken, normalizeOrderNo, safeEmailEquals } from './order-no'

/**
 * TAKİP BAĞLANTISI YENİDEN GÖNDERİMİ
 *
 * ⚠️ CEVAP HER ZAMAN AYNIDIR.
 * Sipariş bulunamasa da, e-posta eşleşmese de çağıran `{ sent: true }` alır.
 * Aksi halde bu uç, "bu sipariş numarası var mı / bu e-postaya mı ait"
 * sorusuna cevap veren bir oracle'a dönüşürdü.
 *
 * Bağlantı YALNIZCA siparişte kayıtlı e-postaya gider; istekte verilen
 * adrese değil. Böylece başkasının siparişinin linki kendine gönderilemez.
 */

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 90 // 90 gün

export async function resendTrackingLink(orderNoRaw: string, emailRaw: string): Promise<void> {
  const orderNo = normalizeOrderNo(orderNoRaw)
  const email = emailRaw.trim().toLowerCase()

  const order = await db.order.findUnique({
    where: { orderNo },
    select: {
      id: true,
      orderNo: true,
      status: true,
      quantity: true,
      totalMinor: true,
      customerEmail: true,
      guestEmail: true,
      platform: { select: { name: true } },
      service: { select: { name: true, unitLabel: true } },
      serviceVariant: { select: { customerLabel: true } },
      target: { select: { handle: true, normalized: true } },
    },
  })
  if (!order) return

  const stored = (order.customerEmail ?? order.guestEmail ?? '').trim().toLowerCase()
  if (!stored || !safeEmailEquals(stored, email)) return

  // Token DÖNDÜRÜLMEZ — yalnızca e-postaya gider. Eskisi geçersiz kılınır.
  const { token, hash } = createAccessToken()
  await db.order.update({
    where: { id: order.id },
    data: { accessTokenHash: hash, accessExpiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  })

  const event = await db.orderEvent.create({
    data: {
      orderId: order.id,
      type: 'TRACKING_LINK_SENT',
      message: 'Takip bağlantısı e-posta ile gönderildi.',
      actorType: 'CUSTOMER',
      isCustomerVisible: false,
    },
    select: { id: true },
  })

  /**
   * ⚠️ Her yeniden gönderim YENİ bir olay yazar, dolayısıyla yeni bir bildirim
   * üretir — idempotency olay bazlıdır, sipariş bazlı değil. Kötüye kullanım
   * rate limit ile engellenir (orders.sendlink.ip / .orderNo, 3/saat).
   *
   * ⚠️ `token` yalnızca burada ham hâldedir; DB'de hash'i durur ve hiçbir log
   * satırına yazılmaz.
   */
  await notifyOrderEvent(event.id, { trackingToken: token })
}
