import 'server-only'

import { unstable_cache } from 'next/cache'
import { CACHE_TAGS, CATALOG_REVALIDATE_SECONDS } from '@/server/cache'
import type { MeasurementMode, TargetType } from '@/lib/enums'
import type { PricingTier } from '@/lib/pricing/types'
import { db } from '@/server/db'
import { getAdapter } from '@/server/platforms/registry'
import type { AdapterCapabilities } from '@/server/platforms/adapter'

/**
 * KATALOG SNAPSHOT
 *
 * Sihirbaz TEK SAYFA olduğu için platform → hizmet → varyant geçişlerinde
 * ağ isteği OLMAMALIDIR. Tüm katalog (fiyat kademeleri dahil) tek çağrıda
 * gelir, adımlar 0 ms'de değişir.
 *
 * Fiyat kademelerinin istemciye gönderilmesi bilinçlidir: kademeler zaten
 * herkese açık bilgidir ve izomorfik pricing engine'in tarayıcıda çalışması
 * için gereklidir. Kupon kuralları GÖNDERİLMEZ — onlar gizli veridir.
 */

export interface CatalogVariant {
  id: string
  slug: string
  /** Müşteriye gösterilen etiket — internalName ASLA gönderilmez */
  customerLabel: string
  tagline: string | null
  /** Müşteriye gösterilen uzun açıklama */
  description: string | null
  badge: string | null
  isDefault: boolean
  /** Sabit paketin içerik maddeleri — ayrı ayrı fiyatlandırılmaz */
  packageItems: string[]
  minQuantity: number
  maxQuantity: number
  quantityStep: number
  presetQuantities: number[]
  /** true ⇒ slider yok; yalnızca hazır miktarlar seçilebilir */
  presetOnly: boolean
  estimatedStartMinutes: number | null
  estimatedCompleteMinutes: number | null
  refillDays: number | null
  tiers: PricingTier[]
}

export interface CatalogService {
  id: string
  slug: string
  name: string
  shortDescription: string | null
  iconSlug: string | null
  targetType: TargetType
  measurementMode: MeasurementMode
  /** Gösterim birimi: "adet" | "paket" | "hafta" ... — fiyat mantığına girmez */
  unitLabel: string
  inputLabel: string
  inputPlaceholder: string
  inputHelpText: string | null
  inputExample: string
  variants: CatalogVariant[]
}

export interface CatalogPlatform {
  id: string
  slug: string
  name: string
  iconSlug: string | null
  iconUrl: string | null
  brandColor: string | null
  gradientFrom: string | null
  gradientTo: string | null
  /** Adapter yetenekleri — UI hangi önizleme alanlarını render edeceğine buradan karar verir */
  capabilities: AdapterCapabilities
  services: CatalogService[]
}

export interface CatalogSnapshot {
  platforms: CatalogPlatform[]
  /** Sipariş anındaki KDV oranı, basis point */
  taxRateBp: number
  currency: 'TRY'
  pricesTaxInclusive: true
  generatedAt: string
}

export async function buildCatalogSnapshot(defaultTaxRateBp: number): Promise<CatalogSnapshot> {
  const now = new Date()

  const [platforms, taxRate] = await Promise.all([
    db.platform.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        services: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            variants: {
              where: { isActive: true, isVisible: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              include: {
                pricingRules: {
                  where: {
                    isActive: true,
                    validFrom: { lte: now },
                    OR: [{ validUntil: null }, { validUntil: { gte: now } }],
                  },
                  orderBy: { minQuantity: 'asc' },
                },
              },
            },
          },
        },
      },
    }),
    db.taxRate.findFirst({
      where: { isActive: true, isDefault: true },
      select: { rateBp: true },
    }),
  ])

  return {
    currency: 'TRY',
    pricesTaxInclusive: true,
    taxRateBp: taxRate?.rateBp ?? defaultTaxRateBp,
    generatedAt: now.toISOString(),
    platforms: platforms
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        iconSlug: p.iconSlug,
        iconUrl: p.iconUrl,
        brandColor: p.brandColor,
        gradientFrom: p.gradientFrom,
        gradientTo: p.gradientTo,
        capabilities: getAdapter(p.adapterKey).capabilities,
        services: p.services
          .map((s) => ({
            id: s.id,
            slug: s.slug,
            name: s.name,
            shortDescription: s.shortDescription,
            iconSlug: s.iconSlug,
            targetType: s.targetType as TargetType,
            measurementMode: s.measurementMode as MeasurementMode,
            unitLabel: s.unitLabel,
            inputLabel: s.inputLabel,
            inputPlaceholder: s.inputPlaceholder,
            inputHelpText: s.inputHelpText,
            inputExample: s.inputExample,
            variants: s.variants
              .map((v) => ({
                id: v.id,
                slug: v.slug,
                customerLabel: v.customerLabel,
                tagline: v.tagline,
                description: v.description,
                badge: v.badge,
                isDefault: v.isDefault,
                packageItems: v.packageItems,
                minQuantity: v.minQuantity,
                maxQuantity: v.maxQuantity,
                quantityStep: v.quantityStep,
                presetQuantities: v.presetQuantities,
                presetOnly: v.presetOnly,
                estimatedStartMinutes: v.estimatedStartMinutes,
                estimatedCompleteMinutes: v.estimatedCompleteMinutes,
                refillDays: v.refillDays,
                tiers: v.pricingRules.map(
                  (r): PricingTier => ({
                    id: r.id,
                    mode: r.mode,
                    minQuantity: r.minQuantity,
                    maxQuantity: r.maxQuantity,
                    unitPriceMinor: r.unitPriceMinor,
                    packagePriceMinor: r.packagePriceMinor,
                    setupFeeMinor: r.setupFeeMinor,
                    priority: r.priority,
                  }),
                ),
              }))
              // Fiyat kademesi olmayan varyant kullanıcıya gösterilmez —
              // aksi halde seçilebilir ama fiyatlandırılamaz bir seçenek olur.
              .filter((v) => v.tiers.length > 0),
          }))
          .filter((s) => s.variants.length > 0),
      }))
      .filter((p) => p.services.length > 0),
  }
}

/**
 * Önbelleklenmiş snapshot.
 *
 * `unstable_cache` + tag kullanılır (route seviyesinde ISR yerine): böylece
 * route dinamik kalır ve BUILD SIRASINDA veritabanına bağlanmaya çalışılmaz —
 * Vercel/CI derlemesi DB olmadan da geçer. Admin katalogda değişiklik yapınca
 * `revalidateCatalog()` bu önbelleği anında düşürür.
 */
export const getCachedCatalogSnapshot = unstable_cache(
  async (defaultTaxRateBp: number) => buildCatalogSnapshot(defaultTaxRateBp),
  ['catalog-snapshot'],
  { tags: [CACHE_TAGS.catalog, CACHE_TAGS.pricing], revalidate: CATALOG_REVALIDATE_SECONDS },
)

/** Sihirbazın varsayılan seçimi: isDefault, yoksa ilk varyant. */
export function pickDefaultVariant(service: CatalogService): CatalogVariant | undefined {
  return service.variants.find((v) => v.isDefault) ?? service.variants[0]
}

/**
 * Varyant seçici gösterilsin mi?
 * Tek görünür varyant varsa kullanıcıya HİÇBİR teknik seçim gösterilmez.
 */
export function shouldShowVariantPicker(service: CatalogService): boolean {
  return service.variants.length > 1
}
