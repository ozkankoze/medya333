/**
 * SEED — idempotent. Birden fazla kez çalıştırılabilir.
 *
 * Katalog `upsert` ile yazılır; mevcut fiyat kademelerini ezmemek için
 * PricingRule yalnızca varyantta HİÇ kural yoksa oluşturulur. Böylece admin
 * panelden yapılan fiyat değişiklikleri seed tekrar çalıştırılınca kaybolmaz.
 */

import type { PrismaClient } from '../../src/generated/prisma/client'
import { PLATFORMS } from './platforms'
import { SERVICES } from './services'

export interface SeedResult {
  platforms: number
  services: number
  variants: number
  pricingRules: number
}

async function seedTaxRates(db: PrismaClient) {
  await db.taxRate.upsert({
    where: { code: 'KDV20' },
    update: { name: 'KDV %20', rateBp: 2000, isDefault: true, isActive: true },
    create: { code: 'KDV20', name: 'KDV %20', rateBp: 2000, isDefault: true, isActive: true },
  })
  await db.taxRate.upsert({
    where: { code: 'KDV10' },
    update: { name: 'KDV %10', rateBp: 1000, isDefault: false, isActive: true },
    create: { code: 'KDV10', name: 'KDV %10', rateBp: 1000, isDefault: false, isActive: true },
  })
  console.log('  ✓ Vergi oranları (varsayılan: KDV %20 — fiyatlar KDV DAHİL)')
}

async function seedCatalog(db: PrismaClient): Promise<SeedResult> {
  let serviceCount = 0
  let variantCount = 0
  let tierCount = 0

  for (const p of PLATFORMS) {
    const platform = await db.platform.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        adapterKey: p.adapterKey,
        iconSlug: p.iconSlug,
        brandColor: p.brandColor,
        sortOrder: p.sortOrder,
        seoTitle: p.seoTitle,
        seoDescription: p.seoDescription,
      },
      create: {
        slug: p.slug,
        name: p.name,
        adapterKey: p.adapterKey,
        iconSlug: p.iconSlug,
        brandColor: p.brandColor,
        sortOrder: p.sortOrder,
        seoTitle: p.seoTitle,
        seoDescription: p.seoDescription,
        isActive: true,
      },
    })

    const services = SERVICES[p.slug] ?? []
    for (const [sIdx, s] of services.entries()) {
      const service = await db.service.upsert({
        where: { platformId_slug: { platformId: platform.id, slug: s.slug } },
        update: {
          name: s.name,
          shortDescription: s.shortDescription,
          targetType: s.targetType,
          measurementMode: s.measurementMode,
          unitLabel: s.unitLabel,
          inputLabel: s.inputLabel,
          inputPlaceholder: s.inputPlaceholder,
          inputHelpText: s.inputHelpText,
          inputExample: s.inputExample,
          sortOrder: (sIdx + 1) * 10,
        },
        create: {
          platformId: platform.id,
          slug: s.slug,
          name: s.name,
          shortDescription: s.shortDescription,
          targetType: s.targetType,
          measurementMode: s.measurementMode,
          unitLabel: s.unitLabel,
          inputLabel: s.inputLabel,
          inputPlaceholder: s.inputPlaceholder,
          inputHelpText: s.inputHelpText,
          inputExample: s.inputExample,
          sortOrder: (sIdx + 1) * 10,
          isActive: true,
        },
      })
      serviceCount++

      for (const [vIdx, v] of s.variants.entries()) {
        const variant = await db.serviceVariant.upsert({
          where: { serviceId_slug: { serviceId: service.id, slug: v.slug } },
          update: {
            internalName: v.internalName,
            customerLabel: v.customerLabel,
            tagline: v.tagline ?? null,
            badge: v.badge ?? null,
            isDefault: v.isDefault ?? false,
            minQuantity: v.minQuantity,
            maxQuantity: v.maxQuantity,
            quantityStep: v.quantityStep,
            presetQuantities: v.presetQuantities,
            estimatedStartMinutes: v.estimatedStartMinutes ?? null,
            estimatedCompleteMinutes: v.estimatedCompleteMinutes ?? null,
            refillDays: v.refillDays ?? null,
            sortOrder: (vIdx + 1) * 10,
          },
          create: {
            serviceId: service.id,
            slug: v.slug,
            internalName: v.internalName,
            customerLabel: v.customerLabel,
            tagline: v.tagline ?? null,
            badge: v.badge ?? null,
            isDefault: v.isDefault ?? false,
            isVisible: true,
            minQuantity: v.minQuantity,
            maxQuantity: v.maxQuantity,
            quantityStep: v.quantityStep,
            presetQuantities: v.presetQuantities,
            estimatedStartMinutes: v.estimatedStartMinutes ?? null,
            estimatedCompleteMinutes: v.estimatedCompleteMinutes ?? null,
            refillDays: v.refillDays ?? null,
            sortOrder: (vIdx + 1) * 10,
            isActive: true,
          },
        })
        variantCount++

        // Admin panelden yapılan fiyat değişiklikleri EZİLMEZ.
        const existing = await db.pricingRule.count({ where: { serviceVariantId: variant.id } })
        if (existing === 0) {
          await db.pricingRule.createMany({
            data: v.tiers.map((t) => ({
              serviceVariantId: variant.id,
              mode: 'FLAT_TIER' as const,
              currency: 'TRY',
              minQuantity: t.minQuantity,
              maxQuantity: t.maxQuantity,
              unitPriceMinor: t.unitPriceMinor,
              setupFeeMinor: t.setupFeeMinor ?? 0,
              priority: 0,
              isActive: true,
            })),
          })
          tierCount += v.tiers.length
        }
      }
    }
  }

  console.log(
    `  ✓ Katalog: ${PLATFORMS.length} platform · ${serviceCount} hizmet · ${variantCount} varyant · ${tierCount} fiyat kademesi`,
  )
  return {
    platforms: PLATFORMS.length,
    services: serviceCount,
    variants: variantCount,
    pricingRules: tierCount,
  }
}

async function seedAdmin(db: PrismaClient) {
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!email || !password) {
    console.log('  – Admin kullanıcı atlandı (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD yok)')
    return
  }

  const { hash } = await import('@node-rs/argon2')
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })

  await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: { role: 'SUPERADMIN', passwordHash, emailVerified: new Date(), isGuest: false },
    create: {
      email: email.toLowerCase(),
      name: 'Medya 333 Yönetici',
      role: 'SUPERADMIN',
      passwordHash,
      emailVerified: new Date(),
    },
  })
  console.log(`  ✓ SUPERADMIN: ${email}`)
}

async function seedCoupon(db: PrismaClient) {
  await db.coupon.upsert({
    where: { code: 'HOSGELDIN10' },
    update: {},
    create: {
      code: 'HOSGELDIN10',
      description: 'İlk siparişe %10 indirim',
      discountType: 'PERCENTAGE',
      discountValue: 1000, // basis point = %10
      maxDiscountMinor: 15_000, // en fazla 150 ₺
      minOrderMinor: 5000, // en az 50 ₺ sepet
      maxRedemptionsPerUser: 1,
      isActive: true,
    },
  })
  console.log('  ✓ Örnek kupon: HOSGELDIN10 (%10, tavan 150 ₺)')
}

/**
 * Tohumlamanın tamamı. Hem CLI (`npm run db:seed`) hem entegrasyon testleri
 * BU fonksiyonu çağırır — test edilen kod ile çalıştırılan kod aynıdır.
 */
export async function seedAll(db: PrismaClient): Promise<SeedResult> {
  await seedTaxRates(db)
  const result = await seedCatalog(db)
  await seedCoupon(db)
  await seedAdmin(db)
  return result
}
