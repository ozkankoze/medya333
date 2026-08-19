import 'server-only'

import { env } from '@/env'
import type { RenderedEmail } from './templates'

/**
 * ⭐ E-POSTA SAĞLAYICI KATMANI (Faz 8)
 *
 * ⚠️ EN ÖNEMLİ KURAL: SAĞLAYICI YOKSA "GÖNDERİLDİ" DENMEZ.
 * Faz 7'ye kadar `ConsoleMailProvider` her çağrıda `ok: true` dönüyordu —
 * yani müşteriye hiçbir şey gitmediği hâlde sistem başarılı sayıyordu.
 * Artık üç ayrı sağlayıcı var ve `none` açıkça BAŞARISIZ döner.
 *
 *   none    → gönderim YAPILMAZ, sonuç FAILED. Üretim varsayılanı.
 *   console → yalnızca geliştirme; gövdeyi DEĞİL, yalnızca başlığı yazar.
 *   resend  → gerçek HTTP çağrısı; API anahtarı olmadan seçilemez.
 *
 * ⚠️ Hiçbir sağlayıcı e-posta GÖVDESİNİ loglamaz: gövde takip bağlantısını,
 * o da misafir takip token'ını taşır.
 */

export interface MailSendResult {
  ok: boolean
  /** Sağlayıcı mesaj kimliği — destek talebinde iz sürmek için */
  id?: string
  /** Kısa, sır içermeyen hata açıklaması */
  error?: string
}

export interface OutgoingMail extends RenderedEmail {
  to: string
  /** Log/teşhis için — PII içermez */
  template: string
}

export interface MailProvider {
  readonly name: 'none' | 'console' | 'resend' | 'memory'
  /** Gerçekten e-posta teslim edebilir mi? `none` ve `memory` için false. */
  readonly canDeliver: boolean
  send(message: OutgoingMail): Promise<MailSendResult>
}

/** ⚠️ Ham adres hiçbir yere yazılmaz. `ab***@site.com` */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = address.slice(0, at)
  const domain = address.slice(at + 1)
  return `${local.slice(0, 2)}***@${domain}`
}

// ---------------------------------------------------------------------------
// Sağlayıcılar
// ---------------------------------------------------------------------------

/**
 * ÜRETİM VARSAYILANI. Gönderim yapmaz ve bunu SAKLAMAZ.
 * Çağıran taraf `ok:false` görür, bildirim kaydı FAILED olur, operasyon
 * ekranında "e-posta gönderilemedi" görünür.
 */
export class NoneMailProvider implements MailProvider {
  readonly name = 'none' as const
  readonly canDeliver = false

  async send(message: OutgoingMail): Promise<MailSendResult> {
    console.error(
      `[mail:FAILED] template=${message.template} to=${maskEmail(message.to)} ` +
        'reason=EMAIL_PROVIDER_NOT_CONFIGURED',
    )
    return {
      ok: false,
      error: 'E-posta sağlayıcısı yapılandırılmadı (EMAIL_PROVIDER=none).',
    }
  }
}

/**
 * GELİŞTİRME sağlayıcısı. Gerçek teslim YOKTUR — bu yüzden `canDeliver=false`.
 * `ok:true` döner ki yerel akış test edilebilsin, ama üretimde SEÇİLEMEZ
 * (bkz. production-guard → EMAIL_CONSOLE_IN_PRODUCTION).
 */
export class ConsoleMailProvider implements MailProvider {
  readonly name = 'console' as const
  readonly canDeliver = false
  /** Son 50 gönderim — entegrasyon testleri buradan doğrular. */
  readonly outbox: OutgoingMail[] = []

  async send(message: OutgoingMail): Promise<MailSendResult> {
    this.outbox.push(message)
    if (this.outbox.length > 50) this.outbox.shift()
    // ⚠️ Yalnızca şablon + maskeli alıcı + konu. GÖVDE YAZILMAZ.
    console.log(
      `[mail:console] template=${message.template} to=${maskEmail(message.to)} subject="${message.subject}"`,
    )
    return { ok: true, id: `console-${this.outbox.length}` }
  }
}

/** Testlerde kullanılan sessiz sağlayıcı. */
export class MemoryMailProvider implements MailProvider {
  readonly name = 'memory' as const
  readonly canDeliver = false
  readonly outbox: OutgoingMail[] = []

  async send(message: OutgoingMail): Promise<MailSendResult> {
    this.outbox.push(message)
    return { ok: true, id: `mem-${this.outbox.length}` }
  }
}

/**
 * GERÇEK SAĞLAYICI — Resend HTTP API.
 *
 * ⚠️ API anahtarı olmadan bu sınıf ASLA örneklenmez (`resolveMailProvider`
 * kontrol eder). Anahtar hiçbir log satırına, hata mesajına veya bildirim
 * kaydına girmez.
 */
export class ResendMailProvider implements MailProvider {
  readonly name = 'resend' as const
  readonly canDeliver = true

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: OutgoingMail): Promise<MailSendResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          // ⚠️ Bu başlık hiçbir yerde loglanmaz.
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })

      if (!res.ok) {
        // Sağlayıcı gövdesi anahtarı yansıtabilir → yalnızca durum kodu tutulur.
        return { ok: false, error: `Sağlayıcı ${res.status} döndü.` }
      }

      const data = (await res.json().catch(() => null)) as { id?: string } | null
      return { ok: true, ...(data?.id ? { id: data.id } : {}) }
    } catch (err) {
      return { ok: false, error: `Sağlayıcıya ulaşılamadı: ${(err as Error).name}` }
    }
  }
}

// ---------------------------------------------------------------------------
// Çözümleme
// ---------------------------------------------------------------------------

export interface MailProviderDecision {
  provider: MailProvider
  /** Neden bu sağlayıcı seçildi — teşhis için, sır içermez. */
  reason: string
}

/**
 * Hangi sağlayıcı kullanılacak?
 *
 * `EMAIL_PROVIDER` açıkça verilmişse ona uyulur; ancak `resend` seçilip
 * anahtar yoksa SESSİZCE console'a düşülmez — `none`'a düşülür ve gönderim
 * başarısız sayılır. "Yapılandırma eksik ama sistem çalışıyor gibi görünüyor"
 * durumunun oluşmasına izin verilmez.
 */
export function resolveMailProvider(): MailProviderDecision {
  const configured = env.EMAIL_PROVIDER
  const hasKey = Boolean(env.RESEND_API_KEY)

  if (configured === 'resend') {
    if (!hasKey) {
      return {
        provider: new NoneMailProvider(),
        reason: 'EMAIL_PROVIDER=resend ama RESEND_API_KEY yok — gönderim yapılmaz.',
      }
    }
    return {
      provider: new ResendMailProvider(env.RESEND_API_KEY!, env.MAIL_FROM),
      reason: 'EMAIL_PROVIDER=resend',
    }
  }

  if (configured === 'console') {
    return { provider: new ConsoleMailProvider(), reason: 'EMAIL_PROVIDER=console' }
  }

  if (configured === 'none') {
    return { provider: new NoneMailProvider(), reason: 'EMAIL_PROVIDER=none' }
  }

  // --- Açık seçim yok: anahtar varsa gerçek sağlayıcı, yoksa ortama göre ----
  if (hasKey) {
    return {
      provider: new ResendMailProvider(env.RESEND_API_KEY!, env.MAIL_FROM),
      reason: 'RESEND_API_KEY tanımlı — gerçek sağlayıcı seçildi.',
    }
  }
  if (env.NODE_ENV === 'test') {
    return { provider: new MemoryMailProvider(), reason: 'test ortamı' }
  }
  if (env.NODE_ENV === 'production' && env.APP_ENV === 'production') {
    /** ⚠️ CANLI ORTAMDA SESSİZ CONSOLE YOK. Gönderim başarısız sayılır. */
    return {
      provider: new NoneMailProvider(),
      reason: 'Canlı ortamda sağlayıcı yapılandırılmadı — gönderim yapılmaz.',
    }
  }
  return { provider: new ConsoleMailProvider(), reason: 'geliştirme varsayılanı' }
}

const globalForMail = globalThis as unknown as { mailProvider?: MailProvider }

export function getMailProvider(): MailProvider {
  if (!globalForMail.mailProvider) {
    globalForMail.mailProvider = resolveMailProvider().provider
  }
  return globalForMail.mailProvider
}

/** Testlerde ve önizlemede sağlayıcıyı değiştirmek için. */
export function setMailProvider(provider: MailProvider | null): void {
  if (provider) globalForMail.mailProvider = provider
  else delete globalForMail.mailProvider
}
