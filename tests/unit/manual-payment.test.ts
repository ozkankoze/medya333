import { describe, expect, it } from 'vitest'

/**
 * MANUEL ÖDEME (WhatsApp) — bağlantı ve mesaj sözleşmesi
 *
 * ⚠️ Burada test edilen şey bir ÖDEME değildir. Bu köprü hiçbir tahsilat
 * yapmaz, hiçbir sipariş durumunu ilerletmez; yalnızca doğru sipariş
 * numarasıyla doğru numaraya götürür. Yanlış numara = kayıp müşteri,
 * yanlış sipariş no = yanlış siparişin tahsilatı.
 */

/** `WhatsappPayButton.tsx` içindeki iki saf yardımcının aynısı. */
function waDigits(raw: string): string {
  return raw.replace(/[^\d]/g, '')
}

function whatsappPaymentHref(orderNo: string, phone: string): string {
  const text = `${orderNo} nolu siparişim için ödeme yapmak istiyorum.`
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

function manualPaymentNumber(enabled: boolean, raw: string | undefined): string | null {
  if (!enabled) return null
  const digits = waDigits(raw ?? '')
  return digits.length >= 10 ? digits : null
}

describe('manuel ödeme — WhatsApp köprüsü', () => {
  it('mesajda sipariş numarası GEÇER', () => {
    const href = whatsappPaymentHref('M333-KZ0MET94', '905551112233')
    expect(decodeURIComponent(href)).toContain('M333-KZ0MET94 nolu siparişim için ödeme yapmak istiyorum.')
  })

  it('⚠️ metin URL-kodlanır — boşluk ve Türkçe karakter bağlantıyı kırmaz', () => {
    const href = whatsappPaymentHref('M333-ABC', '905551112233')
    // Ham boşluk veya "ı/ş/ç" bağlantıda ASLA görünmemeli.
    expect(href).not.toMatch(/[ışçöüğİŞÇÖÜĞ ]/)
    expect(href.startsWith('https://wa.me/905551112233?text=')).toBe(true)
  })

  it('numara biçimi temizlenir (+, boşluk, parantez, tire)', () => {
    expect(waDigits('+90 (555) 111 22 33')).toBe('905551112233')
    expect(waDigits('0555-111-22-33')).toBe('05551112233')
  })

  it('⚠️ BAYRAK KAPALIYSA düğme YOK — sağlayıcı akışı korunur', () => {
    expect(manualPaymentNumber(false, '905551112233')).toBeNull()
  })

  it('⚠️ NUMARA YOKSA/EKSİKSE düğme YOK — bozuk bağlantı gösterilmez', () => {
    expect(manualPaymentNumber(true, undefined)).toBeNull()
    expect(manualPaymentNumber(true, '')).toBeNull()
    expect(manualPaymentNumber(true, '5551')).toBeNull()
  })

  it('bayrak açık + geçerli numara → düğme çıkar', () => {
    expect(manualPaymentNumber(true, '+90 555 111 22 33')).toBe('905551112233')
  })
})
