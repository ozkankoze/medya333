import 'server-only'

import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { appBaseUrl } from '@/server/base-url'
import { AuthError } from '@/server/auth/errors'
import { reportError } from '@/server/observability'
import { RedisRequiredError } from '@/server/redis'

/**
 * ORTAK HTTP KATMANI
 *
 * Tüm API cevapları buradan geçer. Amaç:
 *   • Tek tip hata gövdesi: { error: { code, message, details? } }
 *   • İSTEK BOYUT SINIRI — gövdeyi parse etmeden önce reddet
 *   • İç hata detaylarının (stack, SQL, dosya yolu) DIŞARI SIZMAMASI
 */

/** Public endpoint'ler için gövde üst sınırı. 64 KB fazlasıyla yeterli. */
export const MAX_BODY_BYTES = 64 * 1024
/** Admin endpoint'lerinde ikon/uzun metin olabileceği için biraz daha geniş. */
export const MAX_ADMIN_BODY_BYTES = 256 * 1024

export interface ApiErrorOptions {
  details?: unknown
  headers?: Record<string, string>
  /** Sunucu log'u ile müşteri cevabını eşleştiren kimlik (PII içermez). */
  requestId?: string
}

/**
 * KORELASYON KİMLİĞİ
 *
 * Müşteriye gösterilen hata ile sunucu log satırını eşleştirir. Rastgeledir,
 * hiçbir PII veya iç bilgi taşımaz; destek "hata kodunuzu paylaşır mısınız"
 * diye sorduğunda log'da tek satırda bulunur.
 */
export function newRequestId(): string {
  return randomBytes(6).toString('hex')
}

export function apiError(
  code: string,
  message: string,
  status: number,
  opts: ApiErrorOptions = {},
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(opts.details !== undefined ? { details: opts.details } : {}),
        ...(opts.requestId ? { requestId: opts.requestId } : {}),
      },
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(opts.requestId ? { 'X-Request-Id': opts.requestId } : {}),
        ...(opts.headers ?? {}),
      },
    },
  )
}

/**
 * CSRF — Origin/Referer doğrulaması.
 *
 * Auth.js kendi CSRF token'ını yönetir; buradaki kontrol JSON API'lerimiz için.
 * Tarayıcı `Origin` başlığını script ile değiştiremez, bu yüzden durum
 * değiştiren her istekte kaynak kendi sitemiz olmalı.
 *
 * `SameSite=Lax` çerezi zaten cross-site POST'ta gönderilmez; bu ikinci kapı,
 * misafir (çerezsiz) uçlarda da koruma sağlar.
 */
export function assertSameOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin')
  // Origin yoksa (server-to-server, curl) çerez de yoktur — akış zaten
  // kimlik doğrulanmamış sayılır. Tarayıcı POST'unda Origin HER ZAMAN gelir.
  if (!origin) return null

  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return apiError('CSRF_BLOCKED', 'İstek reddedildi.', 403)
  }

  const expected = req.headers.get('host')
  if (expected && host === expected) return null

  try {
    // Çalışma zamanı adresi (APP_BASE_URL) öncelikli — derlemeye gömülü
    // NEXT_PUBLIC_SITE_URL staging/canlı ayrımını yansıtmayabilir.
    if (host === new URL(appBaseUrl()).host) return null
  } catch {
    /* yapılandırma hatası — aşağıda reddedilir */
  }

  return apiError('CSRF_BLOCKED', 'İstek reddedildi.', 403)
}

export type BodyResult =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse }

/**
 * Güvenli JSON gövde okuma.
 * Content-Length ve gerçek gövde uzunluğu iki kez kontrol edilir —
 * başlık yalan söyleyebilir.
 */
export async function readJsonBody(
  req: NextRequest,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<BodyResult> {
  const declared = req.headers.get('content-length')
  if (declared && Number(declared) > maxBytes) {
    return {
      ok: false,
      response: apiError('PAYLOAD_TOO_LARGE', 'İstek gövdesi çok büyük.', 413),
    }
  }

  let raw: string
  try {
    raw = await req.text()
  } catch {
    return { ok: false, response: apiError('INVALID_BODY', 'İstek gövdesi okunamadı.', 400) }
  }

  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { ok: false, response: apiError('PAYLOAD_TOO_LARGE', 'İstek gövdesi çok büyük.', 413) }
  }

  try {
    return { ok: true, data: raw ? JSON.parse(raw) : {} }
  } catch {
    return { ok: false, response: apiError('INVALID_JSON', 'Geçersiz JSON gövdesi.', 400) }
  }
}

/**
 * Beklenmeyen hataları güvenli cevaba çevirir.
 * İç mesaj/stack ASLA istemciye gitmez; sunucu log'una yazılır.
 */
/**
 * ⚠️ KORELASYON BAĞLAMI (Faz 9).
 * Yalnızca TANIMLAYICILAR geçilir — e-posta, ad, IP ve token DEĞİL.
 * `scrubContext` beyaz liste uygular; listede olmayan alan sessizce düşer.
 */
export interface ErrorContext {
  orderId?: string
  orderNo?: string
  paymentId?: string
  providerEventId?: string
  fulfillmentId?: string
}

export function handleUnexpected(
  scope: string,
  err: unknown,
  context: ErrorContext = {},
): NextResponse {
  const requestId = newRequestId()

  if (err instanceof RedisRequiredError) {
    // Yapılandırma hatası — opak 500 yerine teşhis edilebilir 503.
    console.error(`[${scope}][${requestId}] YAPILANDIRMA HATASI: ${err.message}`)
    return apiError(
      'SERVICE_UNAVAILABLE',
      'Servis geçici olarak kullanılamıyor. Lütfen kısa süre sonra tekrar deneyin.',
      503,
      { headers: { 'Retry-After': '30' }, requestId },
    )
  }
  if (err instanceof AuthError) {
    return apiError(err.code, err.message, err.code === 'UNAUTHENTICATED' ? 401 : 403)
  }
  if (err instanceof ZodError) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: err.flatten().fieldErrors,
    })
  }
  /**
   * ⚠️ Yalnızca SUNUCU log'una: mesaj + yığın izi. Müşteriye giden cevapta
   * korelasyon kimliğinden başka hiçbir iç bilgi YOKTUR.
   *
   * ⚠️ İzleme sistemine giden özet AYRI: `reportError` yığın izini
   * göndermez ve mesajı bağlantı dizesi / token / kart / IP kalıplarından
   * arındırır. Sunucu log'u zenginken dış servise giden veri asgaridir.
   */
  const reportable = reportError(err, { ...context, requestId, scope })
  console.error(
    `[${scope}][${requestId}]`,
    Object.entries(reportable.context)
      .filter(([k]) => k !== 'scope' && k !== 'requestId')
      .map(([k, v]) => `${k}=${v}`)
      .join(' '),
    err,
  )
  return apiError(
    'INTERNAL_ERROR',
    'Beklenmeyen bir hata oluştu. Sorun sürerse bu kodu destek ekibimize iletin.',
    500,
    { requestId },
  )
}
