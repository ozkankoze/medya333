import 'server-only'

import { db } from '@/server/db'
import { orderTrackingEmail, sendMail } from '@/server/mail'
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

  await db.orderEvent.create({
    data: {
      orderId: order.id,
      type: 'TRACKING_LINK_SENT',
      message: 'Takip bağlantısı e-posta ile gönderildi.',
      actorType: 'CUSTOMER',
      isCustomerVisible: false,
    },
  })

  await sendMail(
    orderTrackingEmail({
      orderNo: order.orderNo,
      email: stored,
      platformName: order.platform.name,
      serviceName: order.service.name,
      variantLabel: order.serviceVariant.customerLabel,
      quantity: order.quantity,
      unitLabel: order.service.unitLabel,
      totalMinor: order.totalMinor,
      targetHandle: order.target.handle ?? order.target.normalized,
      status: order.status,
      trackingToken: token,
    }),
  )
}
