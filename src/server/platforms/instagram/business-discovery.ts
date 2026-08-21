import 'server-only'

import { env } from '@/env'
import { ADAPTER_TIMEOUT_MS, fetchWithTimeout } from '../adapter'

/**
 * ⭐ INSTAGRAM BUSINESS DISCOVERY — RESMÎ META GRAPH API İSTEMCİSİ
 *
 * SCRAPING YOKTUR. Tek çağrılan adres `graph.facebook.com`'un resmî
 * `business_discovery` alan genişletmesidir:
 *
 *   GET /{IG_USER_ID}?fields=business_discovery.username(HEDEF){...}
 *
 * ⚠️ BU DOSYA BİR SIR SINIRIDIR.
 *
 * `IG_ACCESS_TOKEN` istek URL'inin QUERY STRING'inde gider. Bu yüzden burada
 * ÜÇ kural mutlaktır:
 *
 *   1. İstek URL'i HİÇBİR log satırına, hata mesajına veya dönüş değerine
 *      yazılmaz. `fetch` istisnalarının `message` alanı URL taşıyabildiği için
 *      istisnalardan yalnızca `err.name` okunur.
 *   2. Meta'nın cevap gövdesi olduğu gibi dışarı verilmez; yalnızca
 *      ihtiyacımız olan dört alan süzülür.
 *   3. Dönen `avatarCdnUrl` İMZALI bir Meta CDN adresidir ve **istemciye
 *      asla verilmez** — `media/avatar-store.ts` üzerinden proxy'lenir.
 *
 * ⚠️ ASLA THROW ETMEZ. `PlatformAdapter.resolve()` sözleşmesi "adapter çökmesi
 *    sipariş kaybına dönüşmemeli" der; bu dosya o sözleşmenin ilk halkasıdır.
 *    Her başarısızlık sınıflandırılmış bir sonuç olarak döner.
 */

/** Meta'dan gerçekten dönen ve bizim kullandığımız alanlar. */
export interface BusinessDiscoveryProfile {
  username: string
  /**
   * ⚠️ Meta bu alanı Business Discovery kapsamında GARANTİ ETMİYOR
   * (IG User alan tablosunda "Public" işareti yok). Eksik dönebilir.
   */
  displayName: string | null
  /** Instagram kullanıcı ID'si — `Target.externalId`. Kullanıcı adından KALICIDIR. */
  externalId: string | null
  biography: string | null
  followerCount: number | null
  mediaCount: number | null
  /** ⚠️ İMZALI ve SÜRELİ Meta CDN adresi. İstemciye verilmez, proxy'lenir. */
  avatarCdnUrl: string | null
}

/**
 * Başarısızlık türleri.
 *
 * Hepsi çağıran tarafta AYNI sonuca çıkar (mevcut UNVERIFIED akışı); ayrı ayrı
 * isimlendirilmelerinin sebebi teşhis ve önbellek süresidir — "hedef kişisel
 * hesap" kalıcı bir gerçektir, "zaman aşımı" ise geçici.
 */
export type BusinessDiscoveryFailure =
  /** Bayrak kapalı — hiçbir ağ çağrısı YAPILMADI. */
  | 'disabled'
  /** IG_ACCESS_TOKEN veya IG_USER_ID yok — çağrı yapılamaz. */
  | 'not_configured'
  /** Hedef kişisel (personal) hesap, gizli veya yok. Kalıcı. */
  | 'not_professional'
  /** Meta rate limit'i (kod 4/17/32/613/80002). Geçici. */
  | 'rate_limited'
  /** Token süresi dolmuş/iptal (kod 190). Kalıcı — operatör müdahalesi ister. */
  | 'auth'
  /** İzin verilmemiş (kod 10/200/(299)). Kalıcı. */
  | 'permission'
  /** 3 sn içinde cevap gelmedi. Geçici. */
  | 'timeout'
  /** DNS/ağ/TLS. Geçici. */
  | 'network'
  /** 2xx geldi ama beklenen yapı yok. */
  | 'bad_response'

export type BusinessDiscoveryResult =
  | { ok: true; profile: BusinessDiscoveryProfile }
  | { ok: false; failure: BusinessDiscoveryFailure }

/** Bayrak AÇIK ve gerekli sırlar TANIMLI mı? */
export function isBusinessDiscoveryConfigured(): boolean {
  return Boolean(
    env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED &&
      env.IG_ACCESS_TOKEN &&
      env.IG_USER_ID,
  )
}

/** Meta hata kodunu bizim başarısızlık türümüze çevirir. */
function classify(code: number, httpStatus: number): BusinessDiscoveryFailure {
  // Kaynak: Meta — Graph API Error Codes / IG User node hata tablosu
  if (code === 190) return 'auth'
  if (code === 10 || code === 200 || code === 299) return 'permission'
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002) {
    return 'rate_limited'
  }
  // 110 "Invalid user id" · 100 "Invalid parameter" → hedef professional değil,
  // gizli ya da hiç yok. Meta hangisinin hangisi olduğunu BELGELEMİYOR, bu
  // yüzden üçünü tek kovada topluyoruz: sonuç kullanıcı için aynı.
  if (code === 110 || code === 100) return 'not_professional'
  if (httpStatus === 429) return 'rate_limited'
  if (httpStatus === 401 || httpStatus === 403) return 'permission'
  return 'bad_response'
}

/** Meta'nın sayısal alanları bazen dize gelir; güvenli çevir. */
function toCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}

/**
 * ⚠️ CDN adresi doğrulaması — SSRF ve açık yönlendirme kalkanı.
 *
 * Meta'nın döndürdüğü adres sonradan `avatar-store` tarafından İNDİRİLİR.
 * Yani bu değer, sunucumuzun istek atacağı bir adrese dönüşür. Meta'nın
 * cevabına körü körüne güvenmek, cevabı bir gün değişirse (veya araya biri
 * girerse) sunucumuzu keyfî bir adrese istek atmaya ikna edebilir.
 */
const ALLOWED_CDN_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i

export function isAllowedAvatarUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return url.protocol === 'https:' && ALLOWED_CDN_HOSTS.test(url.hostname)
}

/**
 * ⚠️ `ig:verify` scripti 10 sn kullanıyor ve ÇALIŞIYOR; uygulama ise paylaşılan
 *    `ADAPTER_TIMEOUT_MS` (3 sn) ile çağırıyordu.
 *
 * 3 sn, Frankfurt'tan (`vercel.json` → `regions: ["fra1"]`) `graph.facebook.com`'a
 * SOĞUK bir bağlantı için gerçekten dar: DNS + TCP + TLS el sıkışması + istek
 * bütçenin tamamını yiyebilir. Sıcak bağlantıda 3 sn boldur, soğukta değil —
 * ve trafiği az bir sitede neredeyse her istek soğuktur.
 *
 * ⚠️ SABİT YALNIZCA INSTAGRAM'A ÖZELDİR. `ADAPTER_TIMEOUT_MS` değiştirilmedi;
 *    diğer platformların davranışı aynen korunur.
 */
const BUSINESS_DISCOVERY_TIMEOUT_MS = 8_000

/**
 * ⚠️ `id` DAHİLDİR: `Target.externalId` alanına yazılır. Kullanıcı adı
 *    DEĞİŞEBİLİR ama IG kullanıcı ID'si sabittir — sipariş kaydının hangi
 *    hesaba ait olduğunu kalıcı olarak bağlayan tek alan budur.
 *
 * ⚠️ Meta, `name` · `profile_picture_url` · `id` alanlarını Business Discovery
 *    kapsamında GARANTİ ETMİYOR (IG User alan tablosunda "Public" işaretleri
 *    yok). Eksik dönebilirler; kod hepsini opsiyonel kabul eder.
 */
const FIELDS =
  'username,name,id,profile_picture_url,biography,followers_count,media_count'

/**
 * ⚠️ TOKEN SÜZGECİ — Meta'nın hata metni isteğin kendisini yankılayabilir.
 *
 * Bazı Graph API hata mesajları başarısız olan URL'i (dolayısıyla
 * `access_token=` query'sini) içerir. Log'a giden HER metin buradan geçer.
 */
function redact(text: string): string {
  let out = text
  const token = env.IG_ACCESS_TOKEN
  if (token && token.length > 6) out = out.split(token).join('<TOKEN GİZLENDİ>')
  return out.replace(/access_token=[^&\s"']+/g, 'access_token=<GİZLENDİ>').slice(0, 300)
}

/**
 * Tek bir Instagram kullanıcı adını Business Discovery ile çözer.
 *
 * @param username `@` işareti OLMADAN, normalize edilmiş kullanıcı adı.
 */
export async function fetchBusinessDiscovery(
  username: string,
): Promise<BusinessDiscoveryResult> {
  if (!env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED) return { ok: false, failure: 'disabled' }

  const token = env.IG_ACCESS_TOKEN
  const userId = env.IG_USER_ID
  if (!token || !userId) return { ok: false, failure: 'not_configured' }

  // Kullanıcı adı doğrudan URL'e giriyor — biçimi burada da sabitlenir.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
    return { ok: false, failure: 'not_professional' }
  }

  const url =
    `https://graph.facebook.com/${env.IG_GRAPH_API_VERSION}/${encodeURIComponent(userId)}` +
    `?fields=business_discovery.username(${encodeURIComponent(username)}){${FIELDS}}` +
    `&access_token=${encodeURIComponent(token)}`

  let res: Response
  try {
    res = await fetchWithTimeout(
      url,
      { headers: { accept: 'application/json' } },
      BUSINESS_DISCOVERY_TIMEOUT_MS,
    )
  } catch (err) {
    // ⚠️ SADECE err.name. `err.message` istek URL'ini — yani token'ı — taşır.
    const name = err instanceof Error ? err.name : ''
    const failure = name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'network'
    diagnose({ failure, http: 0, code: 0, message: `fetch ${name || 'bilinmeyen hata'}` })
    return { ok: false, failure }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, failure: 'bad_response' }
  }

  const asRecord = (v: unknown): Record<string, unknown> | null =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

  const root = asRecord(body)
  const err = root ? asRecord(root.error) : null

  if (!res.ok || err) {
    const code = Number(err?.code ?? 0)
    const failure = classify(code, res.status)
    diagnose({
      failure,
      http: res.status,
      code,
      message: typeof err?.message === 'string' ? err.message : '(mesaj yok)',
      subcode: Number(err?.error_subcode ?? 0) || undefined,
      type: typeof err?.type === 'string' ? err.type : undefined,
    })
    return { ok: false, failure }
  }

  const discovery = root ? asRecord(root.business_discovery) : null
  if (!discovery) {
    // 2xx ama `business_discovery` yok → hedef professional değil.
    diagnose({
      failure: 'not_professional',
      http: res.status,
      code: 0,
      message: '2xx döndü ama cevapta `business_discovery` alanı yok',
    })
    return { ok: false, failure: 'not_professional' }
  }

  const resolvedUsername = toText(discovery.username) ?? username
  const avatarRaw = toText(discovery.profile_picture_url)

  return {
    ok: true,
    profile: {
      username: resolvedUsername,
      displayName: toText(discovery.name),
      externalId: toText(discovery.id),
      biography: toText(discovery.biography),
      followerCount: toCount(discovery.followers_count),
      mediaCount: toCount(discovery.media_count),
      avatarCdnUrl: avatarRaw && isAllowedAvatarUrl(avatarRaw) ? avatarRaw : null,
    },
  }
}

/**
 * ⭐ TEŞHİS LOGU — HTTP durumu + Meta hata kodu + mesaj.
 *
 * ⚠️ TOKEN ASLA YAZILMAZ. Mesaj `redact()` süzgecinden geçer; istek URL'i
 *    hiçbir koşulda loglanmaz.
 *
 * ⚠️ MESAJ YALNIZCA GELİŞTİRMEDE. Meta'nın hata metinleri isteğin parçalarını
 *    yankılayabildiği için üretimde yalnızca SAYISAL kod ve HTTP durumu
 *    yazılır — teşhis için yeterli, sızıntı yüzeyi olarak asgari.
 *
 * `not_professional` üretimde HİÇ loglanmaz: kişisel hesap hedeflemek normal
 * ve sık bir durumdur, hata değildir; loglamak gürültü üretir.
 */
function diagnose(info: {
  failure: BusinessDiscoveryFailure
  http: number
  code: number
  message: string
  subcode?: number
  type?: string
}): void {
  const dev = env.NODE_ENV !== 'production'
  if (info.failure === 'not_professional' && !dev) return

  const parts = [
    `tür=${info.failure}`,
    `http=${info.http}`,
    `kod=${info.code}`,
    ...(info.subcode ? [`altkod=${info.subcode}`] : []),
    ...(info.type ? [`tip=${info.type}`] : []),
    ...(dev ? [`mesaj="${redact(info.message)}"`] : []),
  ]
  console.warn(`[instagram.bd] ${parts.join(' · ')}`)
}
