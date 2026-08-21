import 'server-only'

import { getRedis } from '@/server/redis'
import { ADAPTER_CACHE_TTL_FAIL_S, ADAPTER_CACHE_TTL_OK_S } from '../adapter'
import type { BusinessDiscoveryFailure } from './business-discovery'

/**
 * ⭐ BUSINESS DISCOVERY ÖNBELLEĞİ
 *
 * ⚠️ NEDEN ZORUNLU (opsiyonel değil):
 *
 * Sihirbaz hedef alanını 600 ms'lik debounce ile çözümler
 * (`OrderWizard.tsx`), yani kullanıcı hedefi düzenlerken arka arkaya istek
 * doğar. Business Discovery ise **Platform Rate Limits**'e tabidir —
 * `200 × günlük tekil kullanıcı / saat`. Bu formül IMPRESSIONS'a değil,
 * KULLANICI SAYIMIZA bağlıdır: az kullanıcılı ama çok sorgulayan bir ürün
 * sınıra hızla toslar. Önbellek, Meta kotasını koruyan tek mekanizmadır.
 *
 * ⚠️ BAŞARISIZLIKLAR DA ÖNBELLEKLENİR — ve bu bilinçlidir. Hedef kişisel bir
 *    hesapsa bu KALICI bir gerçektir; her tuş vuruşunda Meta'ya tekrar sormak
 *    kotayı boşa harcar. Süresi başarıdan KISADIR (2 dk), çünkü "token
 *    süresi doldu" gibi bazı başarısızlıklar operatör müdahalesiyle düzelir.
 *
 * ⚠️ NE SAKLANIR: yalnızca dört süzülmüş alan ve PROXY anahtarı.
 *    Meta'nın imzalı CDN adresi buraya YAZILMAZ — süresi dolmuş bir adresi
 *    önbellekten geri sunmak kırık görsel üretirdi.
 */

/** Önbellekte tutulan biçim — istemciye gidecek hâliyle. */
export interface CachedProfile {
  displayName: string | null
  externalId: string | null
  biography: string | null
  followerCount: number | null
  mediaCount: number | null
  /** Bizim proxy anahtarımız (opak, 32 hex) — Meta adresi DEĞİL. */
  avatarKey: string | null
}

export type CachedEntry =
  | { hit: true; ok: true; profile: CachedProfile }
  | { hit: true; ok: false; failure: BusinessDiscoveryFailure }
  | { hit: false }

function key(normalized: string): string {
  return `ig:bd:${normalized.toLowerCase()}`
}

/**
 * Önbellekten okur.
 *
 * ⚠️ ASLA THROW ETMEZ. Redis düşerse önbellek YOK sayılır ve akış canlı
 *    çağrıya devam eder — önbellek bir hızlandırıcıdır, bir kapı değil.
 */
export async function readCachedProfile(normalized: string): Promise<CachedEntry> {
  const redis = getRedis()
  if (!redis) return { hit: false }

  try {
    const raw = await redis.get(key(normalized))
    if (!raw) return { hit: false }
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (parsed.ok === true) {
      return {
        hit: true,
        ok: true,
        profile: {
          displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
          externalId: typeof parsed.externalId === 'string' ? parsed.externalId : null,
          biography: typeof parsed.biography === 'string' ? parsed.biography : null,
          followerCount: typeof parsed.followerCount === 'number' ? parsed.followerCount : null,
          mediaCount: typeof parsed.mediaCount === 'number' ? parsed.mediaCount : null,
          avatarKey: typeof parsed.avatarKey === 'string' ? parsed.avatarKey : null,
        },
      }
    }
    if (typeof parsed.failure === 'string') {
      return { hit: true, ok: false, failure: parsed.failure as BusinessDiscoveryFailure }
    }
    return { hit: false }
  } catch {
    return { hit: false }
  }
}

/** Başarılı çözümlemeyi yazar (15 dk). Hata durumunda sessizce geçer. */
export async function writeCachedProfile(
  normalized: string,
  profile: CachedProfile,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.setex(
      key(normalized),
      ADAPTER_CACHE_TTL_OK_S,
      JSON.stringify({ ok: true, ...profile }),
    )
  } catch {
    /* önbellek yazımı akışı bozamaz */
  }
}

/** Başarısızlığı yazar (2 dk). `disabled` ve `not_configured` YAZILMAZ. */
export async function writeCachedFailure(
  normalized: string,
  failure: BusinessDiscoveryFailure,
): Promise<void> {
  // Bunlar ağ çağrısı üretmeyen yapılandırma durumlarıdır; önbelleklemek
  // bayrak açıldığında gereksiz 2 dk gecikme yaratırdı.
  if (failure === 'disabled' || failure === 'not_configured') return

  const redis = getRedis()
  if (!redis) return
  try {
    await redis.setex(
      key(normalized),
      ADAPTER_CACHE_TTL_FAIL_S,
      JSON.stringify({ ok: false, failure }),
    )
  } catch {
    /* önbellek yazımı akışı bozamaz */
  }
}
