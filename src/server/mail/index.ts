import 'server-only'

import { getMailProvider, maskEmail, type MailSendResult } from './provider'
import { renderEmail, type EmailPayload } from './templates'

/**
 * ⭐ E-POSTA GÖNDERİMİ — TEK GİRİŞ NOKTASI (Faz 8)
 *
 *   sendEmail({ to, template, variables })
 *
 * Sağlayıcıdan bağımsızdır: Resend'den başka bir servise geçildiğinde çağıran
 * kodun tek satırı değişmez.
 *
 * ⚠️ Bu fonksiyon SİPARİŞ AKIŞINA DOĞRUDAN ÇAĞRILMAZ. Sipariş bildirimleri
 * `server/notifications` üzerinden gider; orada idempotency ve kayıt tutma
 * vardır. Buraya doğrudan yalnızca sipariş dışı e-postalar (misafir devralma)
 * gelir.
 *
 * ⚠️ GÖNDERİM ASLA ASIL İŞLEMİ DÜŞÜRMEZ. Hata yakalanır, `ok:false` döner.
 * ⚠️ Ama BAŞARISIZLIK GİZLENMEZ: sağlayıcı yoksa sonuç `ok:false`'tur.
 */

/**
 * ⚠️ `interface … extends` KULLANILAMAZ: `EmailPayload` bir birleşim (union)
 * tipidir ve arayüzler birleşimi genişletemez. Kesişim (intersection) sayesinde
 * `template` ile `variables` arasındaki ayrımlı eşleşme korunur — yanlış
 * şablona yanlış değişken kümesi geçilirse derleme başarısız olur.
 */
export type SendEmailInput = EmailPayload & { to: string }

export interface SendEmailResult extends MailSendResult {
  /** Hangi sağlayıcı denedi: none | console | resend | memory */
  provider: string
  /** Gerçekten teslim edebilen bir sağlayıcı mıydı? */
  delivered: boolean
  recipientMasked: string
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = getMailProvider()
  const recipientMasked = maskEmail(input.to)

  const base = { provider: provider.name, recipientMasked }

  if (!input.to || !input.to.includes('@')) {
    return { ...base, ok: false, delivered: false, error: 'Geçersiz alıcı adresi.' }
  }

  try {
    const rendered = renderEmail(input)
    const result = await provider.send({
      ...rendered,
      to: input.to,
      template: input.template,
    })
    return {
      ...base,
      ...result,
      /** ⚠️ console/memory `ok:true` döner ama TESLİM ETMEZ — ayrımı koru. */
      delivered: result.ok && provider.canDeliver,
    }
  } catch (err) {
    // ⚠️ Hata mesajı gövdeyi (ve dolayısıyla takip token'ını) taşıyabilir →
    // yalnızca hata TÜRÜ loglanır.
    console.error(
      `[mail:error] template=${input.template} to=${recipientMasked} kind=${(err as Error).name}`,
    )
    return { ...base, ok: false, delivered: false, error: (err as Error).name }
  }
}

export { getMailProvider, setMailProvider, maskEmail, resolveMailProvider } from './provider'
export {
  ConsoleMailProvider,
  MemoryMailProvider,
  NoneMailProvider,
  ResendMailProvider,
} from './provider'
export type { MailProvider, OutgoingMail, MailSendResult } from './provider'
export { renderEmail, assertSafeVariables, UnsafeEmailVariableError } from './templates'
export type {
  EmailPayload,
  EmailTemplateKey,
  OrderEmailVars,
  ProgressEmailVars,
  CompletedEmailVars,
  ReplacementEmailVars,
  RenderedEmail,
} from './templates'
export { ORDER_EMAIL_TEMPLATES } from './templates'
