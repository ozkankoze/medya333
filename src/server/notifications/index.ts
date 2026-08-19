import 'server-only'

import type { OrderEventType } from '@/lib/enums'
import { appBaseUrl } from '@/server/base-url'
import { db } from '@/server/db'
import { maskEmail, sendEmail } from '@/server/mail'
import type { EmailPayload, EmailTemplateKey } from '@/server/mail'
import { computeFulfillmentProgress } from '@/lib/fulfillment/status'

/**
 * ⭐ BİLDİRİM SERVİSİ (Faz 8)
 *
 * Akış tek yönlüdür ve tek kaynaktan beslenir:
 *
 *     OrderEvent  →  NotificationService  →  EmailAdapter
 *
 * ⚠️ YENİ PARALEL EVENT SİSTEMİ YOK. Bildirim üretebilen tek şey, zaten var
 * olan `OrderEvent` kaydıdır. Sipariş kodu artık e-posta ÇAĞIRMAZ; yalnızca
 * olayı yazar ve bu servisi tetikler.
 *
 * ⚠️ IDEMPOTENCY VERİTABANINDADIR, UYGULAMADA DEĞİL.
 * `Notification` tablosunda `@@unique([orderEventId, channel])` vardır. Aynı
 * olay için ikinci gönderim denemesi INSERT aşamasında P2002 alır ve
 * `DUPLICATE` olarak döner. Yarış koşulunda bile iki e-posta gitmez.
 *
 * ⚠️ HİÇBİR HATA ASIL İŞLEMİ DÜŞÜRMEZ. Sipariş oluşturma, ödeme doğrulama ve
 * fulfillment geçişleri bildirim başarısızlığından etkilenmez.
 *
 * ⚠️ SMS / WhatsApp EKLENMEDİ. `NotificationChannel` genişletilebilir ama bu
 * fazda yalnızca EMAIL uygulanmıştır.
 */

export type NotificationOutcome =
  /** Bu olay türü için bildirim tanımlı değil — kayıt bile açılmaz */
  | 'NOT_APPLICABLE'
  /** Aynı olay için zaten gönderilmiş */
  | 'DUPLICATE'
  /** Alıcı adresi yok veya sipariş verisi eksik */
  | 'SKIPPED'
  | 'SENT'
  /** ⚠️ Sağlayıcı yok veya gönderim reddedildi — BAŞARILI SAYILMAZ */
  | 'FAILED'

export interface NotifyResult {
  outcome: NotificationOutcome
  notificationId?: string
  template?: EmailTemplateKey
}

/**
 * OrderEvent türü → e-posta şablonu.
 *
 * ⚠️ Listede OLMAYAN her olay bildirim üretmez. "Not eklendi", "durum
 * değiştirildi" gibi iç olaylar müşteriye e-posta göndermez; bu, listenin
 * kapalı (allow-list) olmasıyla garanti altındadır.
 */
export const TEMPLATE_FOR_EVENT: Partial<Record<OrderEventType, EmailTemplateKey>> = {
  ORDER_CREATED: 'ORDER_CREATED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  STARTED: 'ORDER_STARTED',
  PROGRESS_UPDATED: 'ORDER_PROGRESS',
  FULFILLMENT_COMPLETED: 'ORDER_COMPLETED',
  REPLACEMENT_APPROVED: 'REPLACEMENT_APPROVED',
  REPLACEMENT_COMPLETED: 'REPLACEMENT_COMPLETED',
  TRACKING_LINK_SENT: 'ORDER_TRACKING',
}

export interface NotifyOptions {
  /**
   * ⚠️ HAM takip token'ı. Yalnızca onu ÜRETEN çağıran verebilir; veritabanında
   * yalnızca hash'i durur, bu yüzden servis kendi başına türetemez.
   * Verilmezse bağlantı token'sız takip sayfasına düşer.
   *
   * Bu değer HİÇBİR log satırına, bildirim kaydına veya hata mesajına yazılmaz.
   */
  trackingToken?: string | null
}

/** Takip bağlantısı. Token varsa doğrudan sipariş sayfası, yoksa takip formu. */
function trackingUrlFor(orderNo: string, token?: string | null): string {
  const base = appBaseUrl()
  return token
    ? `${base}/siparisler/${orderNo}?t=${encodeURIComponent(token)}`
    : `${base}/siparis-takip?o=${encodeURIComponent(orderNo)}`
}

function customerNameOf(order: {
  customerFirstName: string | null
  guestName: string | null
}): string | null {
  return order.customerFirstName?.trim() || order.guestName?.trim() || null
}

function recipientOf(order: {
  customerEmail: string | null
  guestEmail: string | null
}): string | null {
  return order.customerEmail ?? order.guestEmail ?? null
}

/**
 * Bir OrderEvent için bildirim gönderir.
 *
 * Çağıran taraf sonucu beklemek zorunda değildir; ama beklerse hiçbir zaman
 * exception almaz — tüm hatalar `FAILED` sonucuna çevrilir.
 */
export async function notifyOrderEvent(
  orderEventId: string,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  try {
    return await dispatch(orderEventId, options)
  } catch (err) {
    // ⚠️ Bildirim hatası asıl işlemi düşürmez ve gövde/token loglanmaz.
    console.error(
      `[notification:error] event=${orderEventId} kind=${(err as Error).name}`,
    )
    return { outcome: 'FAILED' }
  }
}

/**
 * Siparişin BELİRLİ TÜRDEKİ EN SON olayı için bildirim gönderir.
 *
 * Çağıran tarafın olay kimliğini elde tutması gerekmez — olayı zaten kendisi
 * yazmıştır. İdempotency yine olay kimliği üzerinden çalıştığı için bu
 * fonksiyonu iki kez çağırmak ikinci e-postayı GÖNDERMEZ.
 */
export async function notifyLatestOrderEvent(
  orderId: string,
  type: OrderEventType,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  try {
    const event = await db.orderEvent.findFirst({
      where: { orderId, type },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!event) return { outcome: 'NOT_APPLICABLE' }
    return await dispatch(event.id, options)
  } catch (err) {
    console.error(`[notification:error] order=${orderId} kind=${(err as Error).name}`)
    return { outcome: 'FAILED' }
  }
}

async function dispatch(orderEventId: string, options: NotifyOptions): Promise<NotifyResult> {
  const event = await db.orderEvent.findUnique({
    where: { id: orderEventId },
    select: {
      id: true,
      type: true,
      orderId: true,
      order: {
        select: {
          orderNo: true,
          quantity: true,
          totalMinor: true,
          customerEmail: true,
          customerFirstName: true,
          guestEmail: true,
          guestName: true,
          platform: { select: { name: true } },
          service: { select: { name: true, unitLabel: true } },
          serviceVariant: { select: { customerLabel: true } },
          target: { select: { handle: true, normalized: true } },
          fulfillment: {
            select: {
              requestedQuantity: true,
              deliveredQuantity: true,
              guaranteeDays: true,
              guaranteeEndsAt: true,
              replacements: {
                where: { status: { in: ['APPROVED', 'REPLACEMENT_PROCESSING', 'COMPLETED'] } },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { replacementQuantity: true },
              },
            },
          },
        },
      },
    },
  })

  if (!event) return { outcome: 'NOT_APPLICABLE' }

  const template = TEMPLATE_FOR_EVENT[event.type as OrderEventType]
  if (!template) return { outcome: 'NOT_APPLICABLE' }

  const order = event.order
  const recipient = recipientOf(order)

  // --- Kayıt AÇ (idempotency kapısı) ---------------------------------------
  let notificationId: string
  try {
    const created = await db.notification.create({
      data: {
        orderId: event.orderId,
        orderEventId: event.id,
        channel: 'EMAIL',
        template,
        status: 'PENDING',
        // ⚠️ Ham adres DEĞİL, maskeli adres saklanır.
        recipientMasked: recipient ? maskEmail(recipient) : '—',
      },
      select: { id: true },
    })
    notificationId = created.id
  } catch (err) {
    // P2002 = unique ihlali ⇒ bu olay için zaten bildirim var.
    if ((err as { code?: string }).code === 'P2002') {
      return { outcome: 'DUPLICATE', template }
    }
    throw err
  }

  if (!recipient) {
    await db.notification.update({
      where: { id: notificationId },
      data: { status: 'SKIPPED', failureReason: 'Alıcı e-posta adresi yok.' },
    })
    return { outcome: 'SKIPPED', notificationId, template }
  }

  // --- Şablon değişkenleri (yalnızca müşteriye açık alanlar) ----------------
  const payload = buildPayload(template, {
    order,
    trackingUrl: trackingUrlFor(order.orderNo, options.trackingToken),
  })

  const result = await sendEmail({ to: recipient, ...payload })

  await db.notification.update({
    where: { id: notificationId },
    data: {
      /**
       * ⚠️ `delivered` KRİTİK: console/memory sağlayıcısı `ok:true` döner ama
       * teslim ETMEZ. Yalnızca gerçekten teslim edilebilen bir gönderim SENT
       * sayılır — aksi hâlde panel "gönderildi" yalanı söylerdi.
       */
      status: result.delivered ? 'SENT' : 'FAILED',
      provider: result.provider,
      attempts: { increment: 1 },
      ...(result.delivered ? { sentAt: new Date() } : {}),
      ...(result.id ? { providerMessageId: result.id.slice(0, 120) } : {}),
      ...(result.delivered
        ? { failureReason: null }
        : {
            failureReason: (
              result.error ?? 'Sağlayıcı teslim edemedi.'
            ).slice(0, 300),
          }),
    },
  })

  return {
    outcome: result.delivered ? 'SENT' : 'FAILED',
    notificationId,
    template,
  }
}

// ---------------------------------------------------------------------------

/**
 * Şablonun ihtiyaç duyduğu sipariş alanları.
 * ⚠️ Bu listede müşteriye kapalı hiçbir alan YOKTUR — iç not, operatör kimliği,
 * ödeme sağlayıcısı ve teknik hata sebebi bilinçli olarak dışarıda bırakılmıştır.
 */
interface OrderForMail {
  orderNo: string
  quantity: number
  totalMinor: number
  customerEmail: string | null
  customerFirstName: string | null
  guestEmail: string | null
  guestName: string | null
  platform: { name: string }
  service: { name: string; unitLabel: string }
  serviceVariant: { customerLabel: string }
  target: { handle: string | null; normalized: string }
  fulfillment: {
    requestedQuantity: number
    deliveredQuantity: number
    guaranteeDays: number | null
    guaranteeEndsAt: Date | null
    replacements: Array<{ replacementQuantity: number }>
  } | null
}

function buildPayload(
  template: EmailTemplateKey,
  ctx: { order: OrderForMail; trackingUrl: string },
): EmailPayload {
  const { order, trackingUrl } = ctx

  const base = {
    customerName: customerNameOf(order),
    orderNo: order.orderNo,
    platformName: order.platform.name,
    serviceName: order.service.name,
    variantLabel: order.serviceVariant.customerLabel,
    quantity: order.quantity,
    unitLabel: order.service.unitLabel,
    totalMinor: order.totalMinor,
    targetHandle: order.target.handle ?? order.target.normalized,
    trackingUrl,
  }

  const f = order.fulfillment
  const progress = f
    ? computeFulfillmentProgress({
        requestedQuantity: f.requestedQuantity,
        deliveredQuantity: f.deliveredQuantity,
      })
    : null

  switch (template) {
    case 'ORDER_PROGRESS':
      return {
        template,
        variables: {
          ...base,
          delivered: progress?.delivered ?? 0,
          remaining: progress?.remaining ?? base.quantity,
          percent: progress?.percent ?? 0,
        },
      }
    case 'ORDER_COMPLETED':
      return {
        template,
        variables: {
          ...base,
          delivered: progress?.delivered ?? base.quantity,
          // ⚠️ Garanti UYDURULMAZ: yalnızca kayıtta varsa geçirilir.
          guaranteeDays: f?.guaranteeDays ?? null,
          guaranteeEndsAt: f?.guaranteeEndsAt?.toISOString() ?? null,
        },
      }
    case 'REPLACEMENT_APPROVED':
    case 'REPLACEMENT_COMPLETED':
      return {
        template,
        variables: {
          ...base,
          replacementQuantity: f?.replacements[0]?.replacementQuantity ?? 0,
        },
      }
    default:
      return { template, variables: base } as EmailPayload
  }
}
