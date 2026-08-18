import 'server-only'

/**
 * ÖDEME VERİSİ ARINDIRMA
 *
 * ⚠️ Sağlayıcı yanıtları veritabanına (PaymentEvent.payload) ve log'a yazılır.
 * Bu fonksiyondan geçmeyen hiçbir sağlayıcı verisi saklanmaz.
 *
 * ASLA SAKLANMAZ:
 *   • kart numarası (tam veya BIN+son 4'ten fazlası), CVV/CVC
 *   • son kullanma tarihi, kart sahibi adı
 *   • merchant key/salt/secret, api key, imza hesaplama girdileri
 *   • Authorization başlıkları, token'ların ham hâli
 *
 * SAKLANABİLİR (PCI kapsamı dışı, teşhis için gerekli):
 *   • kart markası, son 4 hane, banka adı, taksit
 *   • sağlayıcı işlem kimlikleri, durum ve hata kodları, tutar
 */

/** Anahtar adı bunlardan birini İÇERİYORSA değer tamamen atılır. */
const FORBIDDEN_KEY_PATTERNS = [
  'cardnumber',
  'cardno',
  'pan',
  'cvc',
  'cvv',
  'securitycode',
  'expiry',
  'expire',
  'expmonth',
  'expyear',
  'cardholder',
  'cardowner',
  'holdername',
  'secret',
  'salt',
  'merchantkey',
  'apikey',
  'privatekey',
  'password',
  'authorization',
  'paytrtoken',
  'signature',
  'hash',
]

/** Bu anahtarlar korunur — kısmi/maskeli olduğu bilinen alanlar. */
const ALLOWED_EXACT = new Set([
  'cardassociation',
  'cardfamily',
  'cardtype',
  'lastfourdigits',
  'binnumber',
  'cardbrand',
  'cardlast4',
])

/**
 * 12–19 haneli, araya boşluk/tire girmiş olabilecek kart numarası deseni.
 *
 * Not: tembel `(?:\d[ -]*?){12,19}` kullanılamaz — ayırıcıları tüketmediği
 * için "4111 1111 1111 1111" yakalanmıyordu. Burada ilk rakamdan sonra
 * 11–18 kez "isteğe bağlı ayırıcı + rakam" aranır; toplam 12–19 hane eder.
 * Öncesi/sonrası rakam olmamalı ki daha uzun sayı dizilerinin ortası
 * yanlışlıkla eşleşmesin.
 */
const PAN_RE = /(?<!\d)\d(?:[ -]?\d){11,18}(?!\d)/g

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_\-\s]/g, '')
  if (ALLOWED_EXACT.has(k)) return false
  return FORBIDDEN_KEY_PATTERNS.some((p) => k.includes(p))
}

/** Luhn — rastgele uzun sayıları kart sanıp bozmamak için. */
function passesLuhn(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

/** Metin içine gömülmüş kart numaralarını maskeler. */
export function maskPanInText(text: string): string {
  return text.replace(PAN_RE, (match) => {
    const digits = match.replace(/\D/g, '')
    if (digits.length < 12 || digits.length > 19) return match
    if (!passesLuhn(digits)) return match
    return `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`
  })
}

const MAX_DEPTH = 6
const MAX_STRING = 500

/**
 * Sağlayıcı payload'ını saklanabilir hâle getirir.
 * Yasaklı anahtarlar `[REDACTED]` olur, metinlerdeki PAN maskelenir,
 * derinlik ve uzunluk sınırlanır.
 */
export function redactProviderPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth > MAX_DEPTH) return '[TRUNCATED]'

  if (typeof value === 'string') {
    const masked = maskPanInText(value)
    return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactProviderPayload(v, depth + 1))
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isForbiddenKey(k) ? '[REDACTED]' : redactProviderPayload(v, depth + 1)
    }
    return out
  }

  return '[UNSUPPORTED]'
}

/** Log'a yazılacak tek satırlık, PII'sız özet. */
export function safeLogLine(
  scope: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): string {
  const parts = Object.entries(fields)
    .filter(([k]) => !isForbiddenKey(k))
    .map(([k, v]) => `${k}=${v === null || v === undefined ? '-' : maskPanInText(String(v))}`)
  return `[${scope}] ${parts.join(' ')}`
}
