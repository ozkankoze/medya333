import 'server-only'

import { env } from '@/env'

/**
 * ⭐ HATA İZLEME VE KORELASYON (Faz 9)
 *
 * ⚠️ SENTRY BAĞLI DEĞİL. `@sentry/nextjs` bağımlılığı KURULMADI ve sahte bir
 * entegrasyon YAZILMADI. Bu dosya iki şey yapar:
 *
 *   1. Uygulamanın hata raporlama ÇAĞRI NOKTALARINI bugünden tekilleştirir.
 *      Bugün konsola yazar; `SENTRY_DSN` geldiğinde `deliver()` içine tek bir
 *      `Sentry.captureException` satırı eklenir ve çağıran kodun tek satırı
 *      değişmez.
 *   2. **PII/sır temizliğini bugünden zorunlu kılar.** Sentry'yi sonradan
 *      bağlayıp "scrubbing'i sonra yaparız" demek, ilk gün kart bilgisi ve
 *      oturum token'ı içeren olayların üçüncü tarafa gitmesi demektir.
 *
 * ⚠️ `isErrorTrackingEnabled()` DSN yoksa **false** döner. Hiçbir ekran,
 * belge veya rapor "hata izleme aktif" demez — çünkü değil.
 */

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

export type ErrorTrackingState =
  /** DSN yok → hiçbir şey gönderilmiyor */
  | 'not_configured'
  /** DSN var ama SDK kurulu değil → hâlâ gönderilmiyor */
  | 'pending_sdk'
  /** DSN var, SDK kurulu, gönderim açık */
  | 'active'

/**
 * ⚠️ SDK henüz projeye eklenmedi. Bu sabit, `@sentry/nextjs` kurulup
 * `deliver()` bağlandığında `true` yapılır — ve o zamana kadar hiçbir yerde
 * "aktif" gösterilmesini engeller.
 */
const SENTRY_SDK_INSTALLED = false

export function errorTrackingState(): ErrorTrackingState {
  if (!env.SENTRY_DSN) return 'not_configured'
  return SENTRY_SDK_INSTALLED ? 'active' : 'pending_sdk'
}

export function isErrorTrackingEnabled(): boolean {
  return errorTrackingState() === 'active'
}

// ---------------------------------------------------------------------------
// Korelasyon bağlamı
// ---------------------------------------------------------------------------

/**
 * Bir olayı iz sürülebilir kılan alanlar.
 *
 * ⚠️ HEPSİ TANIMLAYICI, HİÇBİRİ PII DEĞİL. Sipariş numarası müşteriyi
 * tanımlamaz (tek başına erişim de vermez — e-posta veya imzalı token şarttır).
 * E-posta, ad, telefon, IP ve token bu yapıya GİREMEZ; `scrubContext` bunu
 * çalışma zamanında da zorlar.
 */
export interface CorrelationContext {
  /** Her istek için üretilen rastgele kimlik */
  requestId?: string
  orderId?: string
  orderNo?: string
  paymentId?: string
  /** Sağlayıcının olay kimliği — webhook tekrarlarını izlemek için */
  providerEventId?: string
  fulfillmentId?: string
  /** Hata nerede oluştu: 'orders.create', 'payment.webhook' … */
  scope?: string
}

const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'requestId',
  'orderId',
  'orderNo',
  'paymentId',
  'providerEventId',
  'fulfillmentId',
  'scope',
])

/**
 * ⚠️ Beyaz liste (allow-list), kara liste DEĞİL.
 *
 * Kara liste yaklaşımı ("password'ü çıkar") her yeni hassas alanda güncellenmek
 * zorundadır ve biri unutulduğunda sessizce sızar. Beyaz listede ise
 * tanımlanmamış her alan otomatik olarak DIŞARIDA kalır: yeni bir alan eklemek
 * bilinçli bir karar gerektirir.
 */
export function scrubContext(context: Record<string, unknown>): CorrelationContext {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue
    if (typeof value !== 'string' || value.length === 0) continue
    // Uzunluk sınırı: beklenmedik büyüklükte bir değer log satırını şişirmesin.
    out[key] = value.slice(0, 120)
  }
  return out as CorrelationContext
}

// ---------------------------------------------------------------------------
// PII / sır temizliği
// ---------------------------------------------------------------------------

/**
 * ⚠️ HATA MESAJINDA GEÇERSE MASKELENECEK KALIPLAR.
 *
 * Bir istisna mesajı beklenmedik yerlerden veri taşıyabilir: veritabanı
 * sürücüsü bağlantı dizesini, HTTP istemcisi `Authorization` başlığını,
 * doğrulama hatası kullanıcı girdisini mesaja koyabilir.
 */
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  // Bağlantı dizeleri (kullanıcı adı + parola içerir)
  [/\b(postgres(?:ql)?|redis|rediss|mysql|mongodb):\/\/[^\s"']+/gi, '$1://[REDACTED]'],
  // Authorization / Bearer
  [/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]'],
  [/\b(authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]'],
  // Anahtar=değer biçiminde sırlar
  [
    /\b(password|passwordHash|secret|apiKey|api_key|token|accessToken|sessionToken|merchantKey|merchantSalt|salt)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    '$1=[REDACTED]',
  ],
  // E-posta adresleri → maskeli
  [/\b([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2'],
  // Kart numarasına benzeyen 13–19 haneli diziler (boşluk/tire ile de)
  [/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_PAN]'],
  // IPv4 — KVKK gereği ham IP hiçbir yere yazılmaz
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_IP]'],
]

/** Serbest metni (hata mesajı, log satırı) hassas kalıplardan arındırır. */
export function scrubMessage(text: string): string {
  let out = text
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * Bir hatanın raporlanabilir özeti.
 *
 * ⚠️ YIĞIN İZİ (stack) GÖNDERİLMEZ. Yığın izinde dosya yolları, iç modül
 * adları ve bazen değişken değerleri bulunur. Sunucu log'unda tam istisna
 * zaten var; dışarıya yalnızca tür + temizlenmiş mesaj gider.
 */
export interface ReportableError {
  name: string
  message: string
  context: CorrelationContext
}

export function toReportable(err: unknown, context: Record<string, unknown> = {}): ReportableError {
  const error = err instanceof Error ? err : new Error(String(err))
  return {
    name: error.name,
    message: scrubMessage(error.message).slice(0, 500),
    context: scrubContext(context),
  }
}

// ---------------------------------------------------------------------------
// Gönderim
// ---------------------------------------------------------------------------

function formatContext(context: CorrelationContext): string {
  const parts = Object.entries(context).map(([k, v]) => `${k}=${v}`)
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

/**
 * Hatayı izleme sistemine bildirir.
 *
 * ⚠️ BUGÜN YALNIZCA SUNUCU LOG'UNA YAZAR. `SENTRY_DSN` ve SDK geldiğinde
 * aşağıdaki yorumdaki iki satır açılır; başka hiçbir yer değişmez.
 *
 * ⚠️ Bu fonksiyon ASLA fırlatmaz. Hata raporlamanın kendisi bir isteği
 * düşüremez.
 */
export function reportError(err: unknown, context: Record<string, unknown> = {}): ReportableError {
  const reportable = toReportable(err, context)

  try {
    if (isErrorTrackingEnabled()) {
      // Sentry bağlandığında:
      //   Sentry.captureException(err, { tags: reportable.context })
      // ⚠️ `beforeSend` içinde `scrubMessage` + `scrubContext` uygulanmalı;
      //    SDK'nın varsayılan `sendDefaultPii` ayarı KAPALI olmalıdır.
    }
  } catch {
    // Raporlama hatası yutulur — asıl işlem etkilenmez.
  }

  return reportable
}

/**
 * Yapılandırılmış, PII-güvenli log satırı.
 *
 * `[scope][requestId] orderNo=… paymentId=… mesaj`
 */
export function logWithContext(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  context: Record<string, unknown> = {},
): void {
  const safe = scrubContext(context)
  const line = `[${scope}]${formatContext(safe)} ${scrubMessage(message)}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
