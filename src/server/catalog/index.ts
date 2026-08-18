import 'server-only'

import { unstable_cache } from 'next/cache'
import { env } from '@/env'
import { CACHE_TAGS, CATALOG_REVALIDATE_SECONDS } from '@/server/cache'
import { getRedis, isRedisEnabled } from '@/server/redis'
import { buildCatalogSnapshot, type CatalogSnapshot } from './snapshot'

/**
 * KATALOĞUN TEK GİRİŞ NOKTASI.
 *
 * Kaynak HER ZAMAN veritabanıdır. (Faz 0'daki `fixture.ts` geçici önizleme
 * katmanı, gerçek PostgreSQL devreye girdiği için Faz 1'de KALDIRILDI.)
 *
 * İki katmanlı önbellek:
 *   1. Redis — çok örnekli dağıtımda paylaşımlı, `revalidateCatalog()` ile düşer
 *   2. Next `unstable_cache` — süreç içi, tag tabanlı
 *
 * Redis yoksa (dev) yalnızca 2. katman çalışır; davranış aynı kalır.
 */

const REDIS_CACHE_KEY = 'catalog:snapshot:v1'

function resolveTaxRateBp(): number {
  // SAVUNMA: SKIP_ENV_VALIDATION=true ile çalıştırılırsa env değerleri ham
  // string kalır ve pricing engine tam sayı beklediği için reddeder.
  const taxRateBp = Number(env.DEFAULT_TAX_RATE_BP)
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0) {
    throw new Error(
      `Geçersiz DEFAULT_TAX_RATE_BP: ${String(env.DEFAULT_TAX_RATE_BP)}. ` +
        'Basis point tam sayı olmalı (ör. %20 → 2000).',
    )
  }
  return taxRateBp
}

const cachedFromDb = unstable_cache(
  async (taxRateBp: number) => buildCatalogSnapshot(taxRateBp),
  ['catalog-snapshot'],
  { tags: [CACHE_TAGS.catalog, CACHE_TAGS.pricing], revalidate: CATALOG_REVALIDATE_SECONDS },
)

export async function getCatalog(): Promise<CatalogSnapshot> {
  const taxRateBp = resolveTaxRateBp()

  // 1) Redis
  if (isRedisEnabled()) {
    const redis = getRedis()
    if (redis) {
      try {
        const hit = await redis.get(REDIS_CACHE_KEY)
        if (hit) return JSON.parse(hit) as CatalogSnapshot
      } catch (err) {
        console.error('[catalog] Redis okuma hatası:', (err as Error).message)
      }
    }
  }

  // 2) Next cache → DB
  //    `unstable_cache` yalnızca Next istek bağlamında çalışır. Route handler
  //    dışından çağrıldığında (worker, script, entegrasyon testi) doğrudan
  //    DB'ye düşülür — davranış aynı, yalnızca süreç-içi önbellek devre dışı.
  let snapshot: CatalogSnapshot
  try {
    snapshot = await cachedFromDb(taxRateBp)
  } catch (err) {
    if (!(err as Error)?.message?.includes('incrementalCache')) throw err
    snapshot = await buildCatalogSnapshot(taxRateBp)
  }

  if (isRedisEnabled()) {
    const redis = getRedis()
    if (redis) {
      redis
        .set(REDIS_CACHE_KEY, JSON.stringify(snapshot), 'EX', CATALOG_REVALIDATE_SECONDS)
        .catch((err: Error) => console.error('[catalog] Redis yazma hatası:', err.message))
    }
  }

  return snapshot
}

/** Admin katalog/fiyat değişikliğinden sonra çağrılır — Redis anahtarını da düşürür. */
export async function invalidateCatalogCache(): Promise<void> {
  const redis = getRedis()
  if (redis) await redis.del(REDIS_CACHE_KEY).catch(() => undefined)
}

export { buildCatalogSnapshot } from './snapshot'
export type {
  CatalogPlatform,
  CatalogService,
  CatalogSnapshot,
  CatalogVariant,
} from './snapshot'
export { pickDefaultVariant, shouldShowVariantPicker } from './snapshot'
