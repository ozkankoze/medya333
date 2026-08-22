import { env } from '@/env'

/**
 * WHATSAPP NUMARASI — TEK KAYNAK
 *
 * İki ayrı yerde kullanılıyor ve ikisinin KOŞULU FARKLI:
 *
 *   · Ödeme köprüsü  → `NEXT_PUBLIC_MANUAL_PAYMENT_ENABLED` bayrağına BAĞLI.
 *                      PayTR bağlanınca kaybolmalı.
 *   · Destek düğmesi → bayraktan BAĞIMSIZ. Ödeme sağlayıcısı gelse bile
 *                      müşteri desteğe yazabilmeli.
 *
 * Numara temizliği tek yerde yapılır; iki bileşende iki farklı regex
 * bulunması, birinde "+90 555…" biçiminin çalışıp diğerinde kırılması
 * demekti.
 */

/** Boşluk, parantez, tire ve baştaki "+" atılır — wa.me sade rakam ister. */
export function waDigits(raw: string): string {
  return raw.replace(/[^\d]/g, '')
}

/**
 * Yapılandırılmış numara (yalnızca rakam) ya da null.
 *
 * ⚠️ 10 haneden kısa değer NULL sayılır. Yarım girilmiş bir numarayla
 * bağlantı üretmek, müşteriyi WhatsApp'ın "geçersiz numara" ekranına
 * götürür — düğmeyi hiç göstermemek daha dürüsttür.
 */
export function supportWhatsappNumber(): string | null {
  const digits = waDigits(env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '')
  return digits.length >= 10 ? digits : null
}

/** Manuel ödeme köprüsü için — AYRICA bayrağın açık olmasını ister. */
export function manualPaymentNumber(): string | null {
  if (!env.NEXT_PUBLIC_MANUAL_PAYMENT_ENABLED) return null
  return supportWhatsappNumber()
}

export function whatsappPaymentHref(orderNo: string, phone: string): string {
  const text = `${orderNo} nolu siparişim için ödeme yapmak istiyorum.`
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}
