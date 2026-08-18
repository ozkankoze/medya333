import 'server-only'

import { revalidateTag } from 'next/cache'

/**
 * Cache tag sabitleri.
 *
 * Katalog snapshot'ı 5 dakika ISR ile önbelleklenir; admin katalogda değişiklik
 * yaptığında `revalidateCatalog()` çağrılır ve sihirbaz ANINDA yeni platformu
 * gösterir. Bu, "yeni platform eklemek deploy gerektirmesin" kararının
 * çalışmasını sağlayan mekanizmadır.
 */
export const CACHE_TAGS = {
  catalog: 'catalog',
  pricing: 'pricing',
  taxRates: 'tax-rates',
  campaigns: 'campaigns',
} as const

export const CATALOG_REVALIDATE_SECONDS = 300

/**
 * `revalidateTag` yalnızca Next istek/render bağlamında çalışır. Arka plan
 * işi, script veya test içinden çağrıldığında "static generation store missing"
 * ile patlar.
 *
 * Önbellek düşürme, ASIL İŞLEMİ (ör. admin fiyat güncellemesi) BAŞARISIZ
 * ETMEMELİDİR — en kötü ihtimalle katalog birkaç dakika bayat kalır.
 * Redis anahtarı zaten `invalidateCatalogCache()` ile ayrıca düşürülüyor.
 */
function safeRevalidate(...tags: string[]): void {
  for (const tag of tags) {
    try {
      revalidateTag(tag)
    } catch (err) {
      const message = (err as Error)?.message ?? ''
      if (!message.includes('static generation store')) {
        console.error('[cache] revalidateTag hatası:', message)
      }
    }
  }
}

export function revalidateCatalog(): void {
  safeRevalidate(CACHE_TAGS.catalog, CACHE_TAGS.pricing)
}

export function revalidatePricing(): void {
  safeRevalidate(CACHE_TAGS.pricing, CACHE_TAGS.catalog)
}

export function revalidateTaxRates(): void {
  safeRevalidate(CACHE_TAGS.taxRates, CACHE_TAGS.catalog)
}
