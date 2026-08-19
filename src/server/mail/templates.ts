import 'server-only'

import { formatMinor, formatQuantity } from '@/lib/money'
import { withUnit } from '@/lib/units'

/**
 * ⭐ E-POSTA ŞABLONLARI (Faz 8)
 *
 * ⚠️ ŞABLONA YALNIZCA MÜŞTERİ İÇİN GÜVENLİ ALANLAR GİRER.
 * Kart bilgisi, CVV, sağlayıcı sırrı, oturum token'ı, iç fulfillment enum'ları,
 * operatör kimliği ve teknik hata sebepleri BURAYA GİREMEZ. `assertSafeVariables`
 * bunu çalışma zamanında da zorlar; testler ayrıca şablon çıktısını tarar.
 *
 * ⚠️ Takip bağlantısı token içerir — e-postaya GİRER ama LOG'A YAZILMAZ.
 * Bu yüzden gövde (text/html) hiçbir log satırında geçmez; sağlayıcı katmanı
 * yalnızca şablon adını ve maskeli alıcıyı yazar.
 *
 * Tasarım dili: beyaz zemin, nötr griler, tek indigo aksan. Neon, degrade,
 * sahte sayaç, sahte aciliyet YOK.
 */

// ---------------------------------------------------------------------------
// Sözleşme
// ---------------------------------------------------------------------------

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

/** Her şablonun paylaştığı sipariş özeti — hepsi müşteriye açık alanlar. */
export interface OrderEmailVars {
  /** Varsa müşterinin adı; yoksa selamlama kişiselleştirilmez. */
  customerName?: string | null
  orderNo: string
  platformName: string
  serviceName: string
  variantLabel: string
  quantity: number
  unitLabel: string
  totalMinor: number
  targetHandle?: string | null
  /** Token içerebilir — loglanmaz. */
  trackingUrl: string
}

export interface ProgressEmailVars extends OrderEmailVars {
  delivered: number
  remaining: number
  percent: number
}

export interface CompletedEmailVars extends OrderEmailVars {
  delivered: number
  /** Garanti tanımlıysa gün sayısı; yoksa garanti bölümü hiç basılmaz. */
  guaranteeDays?: number | null
  /** ISO tarih; yoksa basılmaz. Tahmin ÜRETİLMEZ. */
  guaranteeEndsAt?: string | null
}

export interface ReplacementEmailVars extends OrderEmailVars {
  replacementQuantity: number
}

export interface GuestClaimVars {
  claimUrl: string
}

export type EmailPayload =
  | { template: 'ORDER_CREATED'; variables: OrderEmailVars }
  | { template: 'PAYMENT_RECEIVED'; variables: OrderEmailVars }
  | { template: 'ORDER_STARTED'; variables: OrderEmailVars }
  | { template: 'ORDER_PROGRESS'; variables: ProgressEmailVars }
  | { template: 'ORDER_COMPLETED'; variables: CompletedEmailVars }
  | { template: 'REPLACEMENT_APPROVED'; variables: ReplacementEmailVars }
  | { template: 'REPLACEMENT_COMPLETED'; variables: ReplacementEmailVars }
  | { template: 'ORDER_TRACKING'; variables: OrderEmailVars }
  | { template: 'GUEST_CLAIM'; variables: GuestClaimVars }

export type EmailTemplateKey = EmailPayload['template']

/** Bildirim üretilebilen sipariş şablonları (GUEST_CLAIM sipariş bildirimi değildir). */
export const ORDER_EMAIL_TEMPLATES = [
  'ORDER_CREATED',
  'PAYMENT_RECEIVED',
  'ORDER_STARTED',
  'ORDER_PROGRESS',
  'ORDER_COMPLETED',
  'REPLACEMENT_APPROVED',
  'REPLACEMENT_COMPLETED',
  'ORDER_TRACKING',
] as const satisfies readonly EmailTemplateKey[]

// ---------------------------------------------------------------------------
// Güvenlik kapısı
// ---------------------------------------------------------------------------

/**
 * ⚠️ Şablon değişkenlerinde ASLA bulunmaması gereken anahtar adları.
 * `trackingUrl` bilinçli olarak listede DEĞİLDİR: müşteriye ulaşmasının tek
 * yolu odur. Ama ham `trackingToken` geçilemez — token'ı taşıyan tek şey
 * URL olmalı ki hiçbir yerde tek başına loglanmasın.
 */
const FORBIDDEN_VARIABLE_KEYS = [
  'password',
  'passwordhash',
  'secret',
  'token',
  'trackingtoken',
  'sessiontoken',
  'authorization',
  'apikey',
  'cardnumber',
  'pan',
  'cvv',
  'cvc',
  'merchantkey',
  'merchantsalt',
  'internalnote',
  'failurereason',
  'operatorid',
  'assignedtoname',
]

export class UnsafeEmailVariableError extends Error {
  constructor(key: string) {
    super(`E-posta şablonuna geçirilemez alan: "${key}"`)
    this.name = 'UnsafeEmailVariableError'
  }
}

/** Şablona hassas alan sızmasını çalışma zamanında engeller. */
export function assertSafeVariables(variables: Record<string, unknown>): void {
  for (const key of Object.keys(variables)) {
    if (FORBIDDEN_VARIABLE_KEYS.includes(key.toLowerCase())) {
      throw new UnsafeEmailVariableError(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Görsel dil
// ---------------------------------------------------------------------------

const INK_900 = '#18181b'
const INK_600 = '#52525b'
const INK_500 = '#71717a'
const INK_200 = '#e4e4e7'
const BRAND = '#4f46e5'

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Ortak kabuk. Mobil için tek sütun, `max-width` + akışkan padding;
 * tablo yerleşimi kullanılmaz çünkü içerik zaten tek sütundur.
 */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:${INK_900};-webkit-text-size-adjust:100%">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-size:18px;font-weight:700;margin-bottom:20px;letter-spacing:-.01em">Medya <span style="color:${BRAND}">333</span></div>
  <div style="background:#ffffff;border:1px solid ${INK_200};border-radius:14px;padding:24px">
    <h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;font-weight:600">${esc(title)}</h1>
    ${body}
  </div>
  <p style="margin:20px 0 0;font-size:12px;color:${INK_500};line-height:1.6">
    Medya 333 hizmetleri gerçek kullanıcılar tarafından manuel olarak gerçekleştirilir.
    Bot, sahte hesap veya otomatik etkileşim sistemi kullanılmaz.
  </p>
</div></body></html>`
}

function button(url: string, label: string): string {
  return `<a href="${esc(url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:15px">${esc(label)}</a>`
}

/** Sipariş özeti kutusu — her şablonda aynı biçim. */
function summaryBlock(v: OrderEmailVars): string {
  return `
  <p style="margin:0 0 4px;color:${INK_600};font-size:13px">Sipariş numarası</p>
  <p style="margin:0 0 16px;font-size:20px;font-weight:700;letter-spacing:.02em">${esc(v.orderNo)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;font-size:14px">
    ${row('Hizmet', `${v.platformName} · ${v.serviceName}`)}
    ${row('Paket', v.variantLabel)}
    ${row('Miktar', withUnit(v.quantity, v.unitLabel))}
    ${v.targetHandle ? row('Hedef', `@${v.targetHandle}`) : ''}
    ${row('Toplam', `${formatMinor(v.totalMinor)} (KDV dahil)`)}
  </table>`
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:${INK_600};white-space:nowrap;vertical-align:top">${esc(label)}</td>
    <td style="padding:6px 0 6px 12px;text-align:right;color:${INK_900};font-weight:500">${esc(value)}</td>
  </tr>`
}

function notice(text: string): string {
  return `<div style="background:#fafafa;border:1px solid ${INK_200};border-radius:10px;padding:14px;margin-bottom:18px;font-size:14px;color:${INK_600};line-height:1.55">${esc(text)}</div>`
}

function greeting(name?: string | null): string {
  return name && name.trim().length > 0 ? `Merhaba ${name.trim()},` : 'Merhaba,'
}

function summaryText(v: OrderEmailVars): string {
  return [
    `Sipariş no: ${v.orderNo}`,
    `Hizmet: ${v.platformName} · ${v.serviceName}`,
    `Paket: ${v.variantLabel}`,
    `Miktar: ${withUnit(v.quantity, v.unitLabel)}`,
    v.targetHandle ? `Hedef: @${v.targetHandle}` : '',
    `Toplam: ${formatMinor(v.totalMinor)} (KDV dahil)`,
  ]
    .filter(Boolean)
    .join('\n')
}

function textMail(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join('\n\n')
}

// ---------------------------------------------------------------------------
// Şablonlar
// ---------------------------------------------------------------------------

function orderCreated(v: OrderEmailVars): RenderedEmail {
  return {
    subject: `Siparişiniz oluşturuldu — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      'Siparişiniz oluşturuldu. Ödeme tamamlanana kadar işleme alınmaz.',
      summaryText(v),
      `Siparişinizi buradan takip edebilirsiniz:\n${v.trackingUrl}`,
    ]),
    html: layout(
      'Siparişiniz oluşturuldu',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       ${summaryBlock(v)}
       ${notice('Siparişiniz ödeme tamamlanana kadar işleme alınmaz.')}
       ${button(v.trackingUrl, 'Siparişimi Takip Et')}`,
    ),
  }
}

function paymentReceived(v: OrderEmailVars): RenderedEmail {
  return {
    subject: `Ödemeniz alındı — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      'Ödemeniz doğrulandı. Siparişiniz sıraya alındı.',
      summaryText(v),
      `Takip: ${v.trackingUrl}`,
    ]),
    html: layout(
      'Ödemeniz alındı',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       ${summaryBlock(v)}
       ${notice('Ödemeniz doğrulandı. Siparişiniz sıraya alındı ve ekibimiz tarafından elle işleme alınacak.')}
       ${button(v.trackingUrl, 'Siparişimi Görüntüle')}`,
    ),
  }
}

function orderStarted(v: OrderEmailVars): RenderedEmail {
  return {
    subject: `Siparişiniz işleme alındı — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      'Siparişiniz işleme alındı.',
      summaryText(v),
      `Takip: ${v.trackingUrl}`,
    ]),
    html: layout(
      'Siparişiniz işleme alındı',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       ${summaryBlock(v)}
       ${notice('Siparişiniz işleme alındı. İlerlemeyi takip sayfanızdan izleyebilirsiniz.')}
       ${button(v.trackingUrl, 'İlerlemeyi Gör')}`,
    ),
  }
}

function orderProgress(v: ProgressEmailVars): RenderedEmail {
  const line = `${formatQuantity(v.delivered)} / ${formatQuantity(v.quantity)} ${v.unitLabel} (%${v.percent})`
  return {
    subject: `Siparişiniz devam ediyor — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      `Siparişiniz devam ediyor.\nTeslim edilen: ${line}\nKalan: ${formatQuantity(v.remaining)} ${v.unitLabel}`,
      summaryText(v),
      `Takip: ${v.trackingUrl}`,
    ]),
    html: layout(
      'Siparişiniz devam ediyor',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       <p style="margin:0 0 6px;font-size:15px">Teslim edilen: <strong>${esc(line)}</strong></p>
       <p style="margin:0 0 14px;font-size:14px;color:${INK_600}">Kalan: ${esc(formatQuantity(v.remaining))} ${esc(v.unitLabel)}</p>
       <div style="height:8px;background:${INK_200};border-radius:999px;overflow:hidden;margin-bottom:18px">
         <div style="height:8px;width:${Math.max(0, Math.min(100, v.percent))}%;background:${BRAND};border-radius:999px"></div>
       </div>
       ${summaryBlock(v)}
       ${button(v.trackingUrl, 'Siparişimi Görüntüle')}`,
    ),
  }
}

function orderCompleted(v: CompletedEmailVars): RenderedEmail {
  /** ⚠️ Garanti bilgisi UYDURULMAZ: yalnızca sipariş kaydında varsa basılır. */
  const guarantee =
    v.guaranteeDays && v.guaranteeDays > 0
      ? `${v.guaranteeDays} gün telafi garantisi kapsamındasınız.` +
        (v.guaranteeEndsAt
          ? ` Garanti bitişi: ${new Date(v.guaranteeEndsAt).toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}.`
          : '')
      : null

  return {
    subject: `Siparişiniz tamamlandı — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      `Siparişiniz tamamlandı. Teslim edilen: ${formatQuantity(v.delivered)} ${v.unitLabel}`,
      summaryText(v),
      guarantee,
      `Takip: ${v.trackingUrl}`,
    ]),
    html: layout(
      'Siparişiniz tamamlandı',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       <p style="margin:0 0 16px;font-size:15px">Teslim edilen: <strong>${esc(formatQuantity(v.delivered))} ${esc(v.unitLabel)}</strong></p>
       ${summaryBlock(v)}
       ${guarantee ? notice(guarantee) : ''}
       ${button(v.trackingUrl, 'Siparişimi Görüntüle')}`,
    ),
  }
}

function replacementApproved(v: ReplacementEmailVars): RenderedEmail {
  return {
    subject: `Telafi talebiniz onaylandı — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      `Telafi talebiniz onaylandı. Telafi miktarı: ${withUnit(v.replacementQuantity, v.unitLabel)}`,
      summaryText(v),
      `Takip: ${v.trackingUrl}`,
    ]),
    html: layout(
      'Telafi talebiniz onaylandı',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       <p style="margin:0 0 16px;font-size:15px">Telafi miktarı: <strong>${esc(withUnit(v.replacementQuantity, v.unitLabel))}</strong></p>
       ${summaryBlock(v)}
       ${notice('Telafi işlemi ekibimiz tarafından elle gerçekleştirilecek. Ek ücret alınmaz.')}
       ${button(v.trackingUrl, 'Siparişimi Görüntüle')}`,
    ),
  }
}

function replacementCompleted(v: ReplacementEmailVars): RenderedEmail {
  return {
    subject: `Telafi işleminiz tamamlandı — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      `Telafi işleminiz tamamlandı. Telafi miktarı: ${withUnit(v.replacementQuantity, v.unitLabel)}`,
      summaryText(v),
      `Takip: ${v.trackingUrl}`,
    ]),
    html: layout(
      'Telafi işleminiz tamamlandı',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       <p style="margin:0 0 16px;font-size:15px">Telafi miktarı: <strong>${esc(withUnit(v.replacementQuantity, v.unitLabel))}</strong></p>
       ${summaryBlock(v)}
       ${button(v.trackingUrl, 'Siparişimi Görüntüle')}`,
    ),
  }
}

function orderTracking(v: OrderEmailVars): RenderedEmail {
  return {
    subject: `Sipariş takip bağlantınız — ${v.orderNo}`,
    text: textMail([
      greeting(v.customerName),
      `${v.orderNo} numaralı siparişinizi buradan görüntüleyebilirsiniz:\n${v.trackingUrl}`,
      'Bu bağlantı size özeldir, kimseyle paylaşmayın.',
    ]),
    html: layout(
      'Sipariş takip bağlantınız',
      `<p style="margin:0 0 16px;font-size:15px;color:${INK_600}">${esc(greeting(v.customerName))}</p>
       <p style="margin:0 0 4px;color:${INK_600};font-size:13px">Sipariş numarası</p>
       <p style="margin:0 0 16px;font-size:20px;font-weight:700;letter-spacing:.02em">${esc(v.orderNo)}</p>
       ${notice('Aşağıdaki bağlantı size özeldir; kimseyle paylaşmayın.')}
       ${button(v.trackingUrl, 'Siparişimi Görüntüle')}`,
    ),
  }
}

function guestClaim(v: GuestClaimVars): RenderedEmail {
  return {
    subject: 'Geçmiş siparişlerinizi hesabınıza bağlayın',
    text: textMail([
      'Merhaba,',
      `Bu e-posta ile verdiğiniz siparişleri hesabınıza bağlamak için:\n${v.claimUrl}`,
      'Bağlantı 7 gün geçerlidir.',
    ]),
    html: layout(
      'Geçmiş siparişlerinizi bağlayın',
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${INK_600}">Bu e-posta ile verdiğiniz siparişleri hesabınıza bağlamak için aşağıdaki bağlantıya tıklayın. Bağlantı 7 gün geçerlidir.</p>
       ${button(v.claimUrl, 'Siparişlerimi Bağla')}`,
    ),
  }
}

// ---------------------------------------------------------------------------

/** Şablonu ada göre çözer ve derler. */
export function renderEmail(payload: EmailPayload): RenderedEmail {
  assertSafeVariables(payload.variables as unknown as Record<string, unknown>)

  switch (payload.template) {
    case 'ORDER_CREATED':
      return orderCreated(payload.variables)
    case 'PAYMENT_RECEIVED':
      return paymentReceived(payload.variables)
    case 'ORDER_STARTED':
      return orderStarted(payload.variables)
    case 'ORDER_PROGRESS':
      return orderProgress(payload.variables)
    case 'ORDER_COMPLETED':
      return orderCompleted(payload.variables)
    case 'REPLACEMENT_APPROVED':
      return replacementApproved(payload.variables)
    case 'REPLACEMENT_COMPLETED':
      return replacementCompleted(payload.variables)
    case 'ORDER_TRACKING':
      return orderTracking(payload.variables)
    case 'GUEST_CLAIM':
      return guestClaim(payload.variables)
  }
}
