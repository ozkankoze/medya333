import 'server-only'

import { createHash } from 'node:crypto'
import { env } from '@/env'
import { getRedis } from '@/server/redis'
import { isAllowedAvatarUrl } from '@/server/platforms/instagram/business-discovery'

/**
 * ⭐ MEDIA-PROXY DEPOSU — profil fotoğrafı
 *
 * ⚠️ NEDEN VAR? (`api/v1/targets/resolve/route.ts` içindeki nota karşılık)
 *
 * Meta'nın `profile_picture_url` alanı İMZALI ve SÜRELİ bir CDN adresidir.
 * Bunu doğrudan istemciye vermek İKİ ayrı sorun üretir:
 *
 *   1. **Kırık görsel.** Adres süresi dolunca `<img>` boş kalır. Meta bu
 *      sürenin ne olduğunu BELGELEMİYOR, yani "yeterince kısa cache" diye bir
 *      güvenli varsayım yok.
 *   2. **Müşteri IP'sinin sızması.** `<img src="https://...cdninstagram.com">`
 *      müşterinin TARAYICISINDAN Meta'ya istek attırır. Müşterinin IP'si,
 *      user-agent'ı ve referrer'ı Meta'ya gider. Bu, KVKK açısından bizim
 *      istemediğimiz bir aktarımdır ve mimari notumuz bunu açıkça yasaklar.
 *
 * ÇÖZÜM: Görseli SUNUCUDA bir kez indiririz, Redis'te kısa süre saklarız ve
 * kendi adresimizden servis ederiz. Meta CDN adresi istemciye HİÇ ULAŞMAZ.
 *
 * ⚠️ KALICI ARŞİV DEĞİL. Meta Platform Terms §3.d "meşru iş amacı bitince
 *    Platform Data'yı sil" der. Redis TTL'i bu yükümlülüğü yapısal hale
 *    getirir: kimse silmeyi unutamaz, süre dolunca kendiliğinden gider.
 */

/** Önbellek ömrü — kısa. Kalıcı saklama BİLİNÇLİ olarak yapılmaz. */
export const AVATAR_TTL_SECONDS = 60 * 60 // 1 saat

/** Kabul edilen en büyük görsel. Bundan büyüğü indirilmez. */
export const AVATAR_MAX_BYTES = 512 * 1024 // 512 KB

/** İndirme için ayrı, KISA zaman aşımı — sipariş akışını bekletmemeli. */
const AVATAR_FETCH_TIMEOUT_MS = 2_000

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface StoredAvatar {
  contentType: string
  bytes: Buffer
}

/**
 * Opak depo anahtarı.
 *
 * ⚠️ Kullanıcı adı DÜZ METİN olarak adrese konmaz: proxy adresi HTML'e girer,
 *    tarayıcı geçmişine ve ara sunucu loglarına düşer. `IP_HASH_SALT` ile
 *    hash'lemek, adresi tahmin edilemez ve geri-okunamaz yapar.
 */
export function avatarKey(platform: string, normalized: string): string {
  return createHash('sha256')
    .update(`${env.IP_HASH_SALT}:avatar:${platform}:${normalized.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

function redisKey(key: string): string {
  return `media:avatar:${key}`
}

/**
 * Meta CDN'inden görseli indirir ve Redis'e yazar.
 *
 * ⚠️ ASLA THROW ETMEZ. Avatar bir SÜS'tür; alınamazsa sipariş akışı aynen
 *    devam eder ve UI platform logosunu gösterir (`TargetConfirmCard`).
 *
 * @returns Başarılıysa proxy anahtarı, değilse `null`.
 */
export async function storeAvatarFromCdn(
  platform: string,
  normalized: string,
  cdnUrl: string,
): Promise<string | null> {
  // ⚠️ İKİNCİ KAPI. Çağıran taraf da doğruluyor; burada tekrar doğruluyoruz
  //    çünkü bu fonksiyon sunucumuzun İSTEK ATTIĞI yerdir (SSRF sınırı).
  if (!isAllowedAvatarUrl(cdnUrl)) return null

  const redis = getRedis()
  if (!redis) return null // Redis yoksa proxy de yok — hotlink'e DÜŞMEYİZ.

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(cdnUrl, {
      signal: controller.signal,
      // Meta'ya kendi sayfamızın adresini bile sızdırmayalım.
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
    })
    if (!res.ok) return null

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (!contentType || !ALLOWED_MIME.has(contentType)) return null

    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > AVATAR_MAX_BYTES) return null

    const buf = Buffer.from(await res.arrayBuffer())
    // Content-Length yalan söyleyebilir; gerçek boyutu da denetle.
    if (buf.byteLength === 0 || buf.byteLength > AVATAR_MAX_BYTES) return null

    const key = avatarKey(platform, normalized)
    await redis.setex(
      redisKey(key),
      AVATAR_TTL_SECONDS,
      JSON.stringify({ contentType, data: buf.toString('base64') }),
    )
    return key
  } catch (err) {
    // ⚠️ Yalnızca hata TÜRÜ — `message` imzalı CDN adresini taşır.
    const name = err instanceof Error ? err.name : 'bilinmeyen'
    console.warn(`[media.avatar] indirilemedi · tür=${name}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Depodan okur. Yoksa `null` — çağıran 404 döner. */
export async function readAvatar(key: string): Promise<StoredAvatar | null> {
  if (!/^[a-f0-9]{32}$/.test(key)) return null

  const redis = getRedis()
  if (!redis) return null

  try {
    const raw = await redis.get(redisKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { contentType?: unknown; data?: unknown }
    if (typeof parsed.contentType !== 'string' || typeof parsed.data !== 'string') return null
    if (!ALLOWED_MIME.has(parsed.contentType)) return null
    return { contentType: parsed.contentType, bytes: Buffer.from(parsed.data, 'base64') }
  } catch {
    return null
  }
}

/** İstemciye verilen ADRES — Meta CDN adresi değil, bizim adresimiz. */
export function avatarProxyPath(key: string): string {
  return `/api/v1/media/avatar/${key}`
}
