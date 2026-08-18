import 'server-only'

import { env } from '@/env'
import { formatMinor } from '@/lib/money'
import { withUnit } from '@/lib/units'
import { ORDER_STATUS_META } from '@/lib/orders/status'
import type { OrderStatus } from '@/lib/enums'

/**
 * E-POSTA SOYUTLAMASI
 *
 * Gerçek sağlayıcı (Resend/Postmark) HENÜZ BAĞLI DEĞİL. Arayüz hazır:
 * `MailProvider` implementasyonu değiştirildiğinde çağıran kodun tek satırı
 * değişmez.
 *
 * Geliştirmede `ConsoleMailProvider` konsola yazar ve gönderilenleri bellekte
 * tutar — entegrasyon testleri gönderimi buradan doğrular.
 *
 * ⚠️ E-posta gönderimi ASLA asıl işlemi (sipariş oluşturma) düşürmez.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
  /** Log/teşhis için — PII içermez */
  template: string
}

export interface MailProvider {
  readonly name: string
  send(message: MailMessage): Promise<{ ok: boolean; id?: string; error?: string }>
}

// ---------------------------------------------------------------------------
// Sağlayıcılar
// ---------------------------------------------------------------------------

class ConsoleMailProvider implements MailProvider {
  readonly name = 'console'
  /** Test/preview için son gönderilenler (en fazla 50) */
  readonly outbox: MailMessage[] = []

  async send(message: MailMessage) {
    this.outbox.push(message)
    if (this.outbox.length > 50) this.outbox.shift()
    // PII minimizasyonu: alıcı adresi maskelenerek loglanır
    const [local, domain] = message.to.split('@')
    const masked = `${local?.slice(0, 2)}***@${domain}`
    console.log(`[mail:${message.template}] → ${masked} | ${message.subject}`)
    return { ok: true, id: `console-${Date.now()}` }
  }
}

/** Faz 3+: gerçek sağlayıcı buraya eklenir, arayüz aynı kalır. */
class NoopMailProvider implements MailProvider {
  readonly name = 'noop'
  async send() {
    return { ok: true }
  }
}

const globalForMail = globalThis as unknown as { mailProvider?: MailProvider }

export function getMailProvider(): MailProvider {
  if (globalForMail.mailProvider) return globalForMail.mailProvider
  // RESEND_API_KEY geldiğinde burada ResendMailProvider döndürülecek.
  globalForMail.mailProvider = env.NODE_ENV === 'test' ? new NoopMailProvider() : new ConsoleMailProvider()
  return globalForMail.mailProvider
}

/** Testlerde sağlayıcıyı değiştirmek için. */
export function setMailProvider(provider: MailProvider): void {
  globalForMail.mailProvider = provider
}

export { ConsoleMailProvider }

// ---------------------------------------------------------------------------
// Şablonlar
// ---------------------------------------------------------------------------

const SITE = env.NEXT_PUBLIC_SITE_URL

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="tr"><body style="margin:0;background:#fafafa;font-family:Inter,system-ui,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
  <div style="font-size:20px;font-weight:700;margin-bottom:24px">Medya <span style="color:#4f46e5">333</span></div>
  <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 16px;font-size:20px">${title}</h1>
    ${body}
  </div>
  <p style="margin-top:24px;font-size:12px;color:#71717a;line-height:1.6">
    Medya 333 hizmetleri gerçek kullanıcılar tarafından manuel olarak gerçekleştirilir.
    Bot, sahte hesap veya otomatik etkileşim sistemi kullanılmaz.
  </p>
</div></body></html>`
}

export interface OrderMailData {
  orderNo: string
  email: string
  platformName: string
  serviceName: string
  variantLabel: string
  quantity: number
  unitLabel: string
  totalMinor: number
  targetHandle: string | null
  status: OrderStatus
  /** Ham takip token'ı — SADECE e-postaya girer, DB'de hash'i tutulur */
  trackingToken?: string | null
}

function trackingUrl(orderNo: string, token?: string | null): string {
  return token
    ? `${SITE}/siparisler/${orderNo}?t=${encodeURIComponent(token)}`
    : `${SITE}/siparis-takip?o=${encodeURIComponent(orderNo)}`
}

/** Sipariş oluşturuldu — ödeme bekleniyor. */
export function orderCreatedEmail(d: OrderMailData): MailMessage {
  const url = trackingUrl(d.orderNo, d.trackingToken)
  const summary = `${d.platformName} · ${d.serviceName} (${d.variantLabel}) — ${withUnit(d.quantity, d.unitLabel)}`
  const text = [
    `Siparişiniz oluşturuldu: ${d.orderNo}`,
    '',
    summary,
    d.targetHandle ? `Hedef: @${d.targetHandle}` : '',
    `Toplam: ${formatMinor(d.totalMinor)} (KDV dahil)`,
    '',
    'Durum: Ödeme bekleniyor',
    'Siparişiniz ödeme tamamlanana kadar işleme alınmaz.',
    '',
    `Takip: ${url}`,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    to: d.email,
    template: 'OrderCreatedEmail',
    subject: `Siparişiniz oluşturuldu — ${d.orderNo}`,
    text,
    html: layout(
      'Siparişiniz oluşturuldu',
      `<p style="margin:0 0 8px;color:#52525b">Sipariş numaranız</p>
       <p style="margin:0 0 20px;font-size:22px;font-weight:700;letter-spacing:.02em">${d.orderNo}</p>
       <p style="margin:0 0 6px">${summary}</p>
       ${d.targetHandle ? `<p style="margin:0 0 6px;color:#52525b">Hedef: @${d.targetHandle}</p>` : ''}
       <p style="margin:0 0 20px;font-size:18px;font-weight:600">${formatMinor(d.totalMinor)} <span style="font-size:12px;font-weight:400;color:#71717a">KDV dahil</span></p>
       <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:14px;margin-bottom:20px">
         <strong>Durum: Ödeme bekleniyor</strong><br>
         <span style="color:#52525b;font-size:14px">Siparişiniz ödeme tamamlanana kadar işleme alınmaz.</span>
       </div>
       <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Siparişimi Takip Et</a>`,
    ),
  }
}

/** Sipariş durumu değişti. */
export function orderStatusChangedEmail(d: OrderMailData): MailMessage {
  const meta = ORDER_STATUS_META[d.status]
  const url = trackingUrl(d.orderNo, d.trackingToken)
  return {
    to: d.email,
    template: 'OrderStatusChangedEmail',
    subject: `Sipariş durumu: ${meta.label} — ${d.orderNo}`,
    text: `${d.orderNo}\n\nDurum: ${meta.label}\n${meta.description}\n\nTakip: ${url}`,
    html: layout(
      `Sipariş durumu: ${meta.label}`,
      `<p style="margin:0 0 8px;color:#52525b">${d.orderNo}</p>
       <p style="margin:0 0 20px">${meta.description}</p>
       <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Siparişi Görüntüle</a>`,
    ),
  }
}

/** Takip bağlantısı (kullanıcı talebiyle yeniden gönderim). */
export function orderTrackingEmail(d: OrderMailData): MailMessage {
  const url = trackingUrl(d.orderNo, d.trackingToken)
  return {
    to: d.email,
    template: 'OrderTrackingEmail',
    subject: `Sipariş takip bağlantınız — ${d.orderNo}`,
    text: `${d.orderNo} siparişinizi buradan takip edebilirsiniz:\n${url}\n\nBu bağlantı size özeldir, paylaşmayın.`,
    html: layout(
      'Sipariş takip bağlantınız',
      `<p style="margin:0 0 8px;color:#52525b">${d.orderNo}</p>
       <p style="margin:0 0 20px">Aşağıdaki bağlantı size özeldir; başkasıyla paylaşmayın.</p>
       <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Siparişimi Görüntüle</a>`,
    ),
  }
}

/** Misafir siparişlerini hesaba bağlama bağlantısı. */
export function guestClaimEmail(d: { email: string; token: string }): MailMessage {
  const url = `${SITE}/hesabim?claim=${encodeURIComponent(d.token)}`
  return {
    to: d.email,
    template: 'GuestClaimEmail',
    subject: 'Geçmiş siparişlerinizi hesabınıza bağlayın',
    text: `Geçmiş siparişlerinizi hesabınıza bağlamak için:\n${url}\n\nBağlantı 7 gün geçerlidir.`,
    html: layout(
      'Geçmiş siparişlerinizi bağlayın',
      `<p style="margin:0 0 20px">Bu e-posta ile verdiğiniz siparişleri hesabınıza bağlamak için aşağıdaki bağlantıya tıklayın. Bağlantı 7 gün geçerlidir.</p>
       <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Siparişlerimi Bağla</a>`,
    ),
  }
}

/** Gönderim — hata asla çağıranı düşürmez. */
export async function sendMail(message: MailMessage): Promise<boolean> {
  try {
    const res = await getMailProvider().send(message)
    if (!res.ok) console.error(`[mail] gönderilemedi (${message.template}):`, res.error)
    return res.ok
  } catch (err) {
    console.error(`[mail] hata (${message.template}):`, (err as Error).message)
    return false
  }
}
