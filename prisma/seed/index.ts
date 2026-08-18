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
  /** Gerçek katalogda yer almadığı için pasifleştirilen kayıt sayıları */
  deactivated?: {
    platforms: number
    services: number
    variants: number
    pricingRules: number
  }
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
        isActive: (SERVICES[p.slug]?.length ?? 0) > 0,
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
        isActive: (SERVICES[p.slug]?.length ?? 0) > 0,
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
          isActive: true,
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
            description: v.description ?? null,
            badge: v.badge ?? null,
            isDefault: v.isDefault ?? false,
            packageItems: v.packageItems ?? [],
            minQuantity: v.minQuantity,
            maxQuantity: v.maxQuantity,
            quantityStep: v.quantityStep,
            presetQuantities: v.presetQuantities,
            presetOnly: v.presetOnly,
            estimatedStartMinutes: v.estimatedStartMinutes ?? null,
            estimatedCompleteMinutes: v.estimatedCompleteMinutes ?? null,
            refillDays: v.refillDays ?? null,
            sortOrder: (vIdx + 1) * 10,
            isActive: true,
            isVisible: true,
          },
          create: {
            serviceId: service.id,
            slug: v.slug,
            internalName: v.internalName,
            customerLabel: v.customerLabel,
            tagline: v.tagline ?? null,
            description: v.description ?? null,
            badge: v.badge ?? null,
            isDefault: v.isDefault ?? false,
            isVisible: true,
            packageItems: v.packageItems ?? [],
            minQuantity: v.minQuantity,
            maxQuantity: v.maxQuantity,
            quantityStep: v.quantityStep,
            presetQuantities: v.presetQuantities,
            presetOnly: v.presetOnly,
            estimatedStartMinutes: v.estimatedStartMinutes ?? null,
            estimatedCompleteMinutes: v.estimatedCompleteMinutes ?? null,
            refillDays: v.refillDays ?? null,
            sortOrder: (vIdx + 1) * 10,
            isActive: true,
          },
        })
        variantCount++

        /**
         * ⚠️ GERÇEK FİYAT LİSTESİ OTORİTEDİR.
         *
         * Faz 5'te fiyatlar müşteriye gösterilen gerçek satış fiyatlarıdır;
         * demo verisinden kalan bir kademe hayatta kalırsa yanlış fiyattan
         * satış demektir. Bu yüzden varyantın kademeleri BİREBİR listeye
         * eşitlenir: fazlalıklar pasifleştirilir (silinmez — geçmiş
         * siparişler `appliedPricingRuleId` ile bu satırlara bakar).
         */
        const wanted = new Map(v.tiers.map((t) => [`${t.minQuantity}:${t.maxQuantity ?? 'inf'}`, t]))
        const current = await db.pricingRule.findMany({ where: { serviceVariantId: variant.id } })

        for (const rule of current) {
          const key = `${rule.minQuantity}:${rule.maxQuantity ?? 'inf'}`
          const want = wanted.get(key)
          if (!want) {
            if (rule.isActive) {
              await db.pricingRule.update({ where: { id: rule.id }, data: { isActive: false } })
            }
            continue
          }
          wanted.delete(key)
          await db.pricingRule.update({
            where: { id: rule.id },
            data: {
              mode: want.mode,
              unitPriceMinor: want.unitPriceMinor,
              packagePriceMinor: want.packagePriceMinor ?? null,
              setupFeeMinor: want.setupFeeMinor ?? 0,
              isActive: true,
            },
          })
          tierCount++
        }

        for (const t of wanted.values()) {
          await db.pricingRule.create({
            data: {
              serviceVariantId: variant.id,
              mode: t.mode,
              currency: 'TRY',
              minQuantity: t.minQuantity,
              maxQuantity: t.maxQuantity,
              unitPriceMinor: t.unitPriceMinor,
              packagePriceMinor: t.packagePriceMinor ?? null,
              setupFeeMinor: t.setupFeeMinor ?? 0,
              priority: 0,
              isActive: true,
            },
          })
          tierCount++
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

/**
 * ⚠️ DEMO KATALOG TEMİZLİĞİ (Faz 5)
 *
 * Faz 0-4'te kullanılan örnek hizmetler/fiyatlar GERÇEK katalog değildir ve
 * canlıda müşteriye gösterilirse uydurma fiyattan satış demektir.
 *
 * SİLİNMEZ, PASİFLEŞTİRİLİR: bu kayıtlara geçmiş siparişler
 * (`Order.serviceId`, `OrderItem.serviceVariantId`, `appliedPricingRuleId`)
 * bağlıdır. Silmek geçmişi ve muhasebeyi bozardı.
 */
async function deactivateStaleCatalog(db: PrismaClient): Promise<{
  platforms: number
  services: number
  variants: number
  pricingRules: number
}> {
  const stale = { platforms: 0, services: 0, variants: 0, pricingRules: 0 }

  const platforms = await db.platform.findMany({
    include: { services: { include: { variants: true } } },
  })

  for (const platform of platforms) {
    const realServices = SERVICES[platform.slug] ?? []
    const realServiceSlugs = new Set(realServices.map((s) => s.slug))

    for (const service of platform.services) {
      const realService = realServices.find((s) => s.slug === service.slug)
      const serviceIsReal = realServiceSlugs.has(service.slug)

      if (!serviceIsReal && service.isActive) {
        await db.service.update({ where: { id: service.id }, data: { isActive: false } })
        stale.services++
      }

      const realVariantSlugs = new Set((realService?.variants ?? []).map((v) => v.slug))
      for (const variant of service.variants) {
        const variantIsReal = serviceIsReal && realVariantSlugs.has(variant.slug)
        if (variantIsReal) continue

        if (variant.isActive || variant.isDefault) {
          await db.serviceVariant.update({
            where: { id: variant.id },
            data: {
              isActive: false,
              /**
               * ⚠️ `isDefault` DA DÜŞÜRÜLÜR.
               * Demo varyant "varsayılan" kalırsa aynı hizmette İKİ varsayılan
               * olur; sihirbaz hangisini açacağını kayıt sırasına göre seçer ve
               * müşteri yanlış varyantla karşılaşabilir.
               */
              isDefault: false,
            },
          })
          if (variant.isActive) stale.variants++
        }
        const { count } = await db.pricingRule.updateMany({
          where: { serviceVariantId: variant.id, isActive: true },
          data: { isActive: false },
        })
        stale.pricingRules += count
      }
    }

    if (realServices.length === 0 && platform.isActive) {
      await db.platform.update({ where: { id: platform.id }, data: { isActive: false } })
      stale.platforms++
    }
  }

  if (stale.platforms + stale.services + stale.variants + stale.pricingRules > 0) {
    console.log(
      `  ✓ Gerçek katalogda olmayan kayıtlar pasifleştirildi: ` +
        `${stale.platforms} platform · ${stale.services} hizmet · ` +
        `${stale.variants} varyant · ${stale.pricingRules} fiyat kademesi`,
    )
  }
  return stale
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
  const deactivated = await deactivateStaleCatalog(db)
  await seedCoupon(db)
  await seedAdmin(db)
  return { ...result, deactivated }
}
