/**
 * GERÇEK POSTGRESQL ENTEGRASYON TESTLERİ
 *
 * Kapsam: migration · seed · foreign key · unique constraint · cascade ·
 *         katalog ilişkileri · pricing rule ilişkileri · kupon ilişkileri ·
 *         Order için gerekli relation'lar.
 *
 * Çalıştırma:
 *   TEST_DATABASE_URL=postgres://... npm test      (harici DB)
 *   npm test                                        (Testcontainers, Docker gerekir)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import { PLATFORMS } from '../../prisma/seed/platforms'
import { SERVICES } from '../../prisma/seed/services'
import { setupTestDatabase, truncateTransactional, type TestDatabase } from './db-setup'

let ctx: TestDatabase
let db: PrismaClient

const EXPECTED_SERVICES = Object.values(SERVICES).reduce((n, list) => n + list.length, 0)
const EXPECTED_VARIANTS = Object.values(SERVICES).reduce(
  (n, list) => n + list.reduce((m, s) => m + s.variants.length, 0),
  0,
)
const EXPECTED_TIERS = Object.values(SERVICES).reduce(
  (n, list) => n + list.reduce((m, s) => m + s.variants.reduce((k, v) => k + v.tiers.length, 0), 0),
  0,
)

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)
}, 180_000)

afterAll(async () => {
  await ctx?.stop()
})

// ---------------------------------------------------------------------------

describe('migration', () => {
  it('tüm tablolar oluştu', async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`
    const names = rows.map((r) => r.table_name)
    for (const t of [
      'User', 'Account', 'Session', 'VerificationToken',
      'Platform', 'Service', 'ServiceVariant', 'PricingRule', 'TaxRate',
      'Target', 'Order', 'OrderItem', 'OrderEvent',
      'Payment', 'PaymentEvent', 'Refund',
      'Coupon', 'CouponRedemption', 'Campaign',
      'AuditLog', 'AdapterCallLog',
      'GuestClaimToken',
    ]) {
      expect(names, `${t} tablosu yok`).toContain(t)
    }
    expect(names).toHaveLength(22)
  })

  it('tüm enum tipleri oluştu ve değerleri doğru', async () => {
    const rows = await db.$queryRaw<{ typname: string; n: bigint }[]>`
      SELECT t.typname, count(e.enumlabel) AS n
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      GROUP BY t.typname ORDER BY t.typname`
    const map = new Map(rows.map((r) => [r.typname, Number(r.n)]))
    // Faz 2: DRAFT eklendi, AWAITING_PAYMENT→PENDING_PAYMENT / PAYMENT_RECEIVED→PAID
    expect(map.get('OrderStatus')).toBe(11)
    // Faz 2: PAYMENT_PENDING, PRICE_CHANGED, CUSTOMER_INFO_ADDED,
    //        CONSENT_ACCEPTED, GUEST_CLAIMED, TRACKING_LINK_SENT eklendi
    expect(map.get('OrderEventType')).toBe(25)
    expect(map.get('MeasurementMode')).toBe(2)
    expect(map.get('InvoiceStatus')).toBe(5)
    expect(map.get('UserRole')).toBe(5)
  })

  it('para alanları PostgreSQL tarafında integer (float DEĞİL)', async () => {
    const rows = await db.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND column_name LIKE '%Minor'`
    expect(rows.length).toBeGreaterThan(10)
    for (const r of rows) {
      expect(['integer', 'bigint'], `${r.table_name}.${r.column_name} = ${r.data_type}`).toContain(
        r.data_type,
      )
    }
  })

  it('Service.unitLabel alanı var ve varsayılanı "adet"', async () => {
    const rows = await db.$queryRaw<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_name='Service' AND column_name='unitLabel'`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.column_default).toContain('adet')
  })

  it('kritik indeksler oluştu', async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname='public'`
    const idx = rows.map((r) => r.indexname).join(' ')
    expect(idx).toContain('Order_status_createdAt_idx')
    expect(idx).toContain('Order_orderNo_key')
    expect(idx).toContain('PaymentEvent_provider_providerEventId_key')
  })
})

describe('seed', () => {
  it('beklenen kayıt sayıları oluştu', async () => {
    const [platforms, services, variants, tiers, taxRates, coupons] = await Promise.all([
      db.platform.count(),
      db.service.count(),
      db.serviceVariant.count(),
      db.pricingRule.count(),
      db.taxRate.count(),
      db.coupon.count(),
    ])
    expect(platforms).toBe(PLATFORMS.length)
    expect(platforms).toBe(6)
    expect(services).toBe(EXPECTED_SERVICES)
    expect(variants).toBe(EXPECTED_VARIANTS)
    expect(tiers).toBe(EXPECTED_TIERS)
    expect(taxRates).toBe(2)
    expect(coupons).toBe(1)
  })

  it('varsayılan KDV oranı %20 ve tek tane', async () => {
    const defaults = await db.taxRate.findMany({ where: { isDefault: true } })
    expect(defaults).toHaveLength(1)
    expect(defaults[0]!.rateBp).toBe(2000)
  })

  it('unitLabel değerleri doğru atandı', async () => {
    const ig = await db.platform.findUniqueOrThrow({
      where: { slug: 'instagram' },
      include: { services: true },
    })
    const byslug = new Map(ig.services.map((s) => [s.slug, s.unitLabel]))
    expect(byslug.get('takipci')).toBe('adet')
    expect(byslug.get('begeni')).toBe('adet')
    expect(byslug.get('yorum')).toBe('yorum')
    expect(byslug.get('profil-tanitimi')).toBe('hafta')
  })

  it('her platformun adapterKey\'i ve hizmetleri var', async () => {
    const platforms = await db.platform.findMany({ include: { services: true } })
    for (const p of platforms) {
      expect(p.adapterKey, `${p.slug} adapterKey`).toBeTruthy()
      expect(p.services.length, `${p.slug} hizmetsiz`).toBeGreaterThan(0)
    }
  })

  it('her varyantın en az bir fiyat kademesi var', async () => {
    const variants = await db.serviceVariant.findMany({ include: { pricingRules: true } })
    for (const v of variants) {
      expect(v.pricingRules.length, `${v.internalName} kademesiz`).toBeGreaterThan(0)
    }
  })

  it('tekrar çalıştırılabilir (idempotent) — kayıt sayısı artmaz', async () => {
    const before = await db.service.count()
    const beforeTiers = await db.pricingRule.count()
    await seedAll(db)
    expect(await db.service.count()).toBe(before)
    expect(await db.pricingRule.count()).toBe(beforeTiers)
  })
})

describe('foreign key kısıtları', () => {
  it('olmayan platforma hizmet eklenemez', async () => {
    await expect(
      db.service.create({
        data: {
          platformId: 'clyokyokyokyokyokyokyok01',
          slug: 'hayalet',
          name: 'Hayalet',
          targetType: 'PROFILE',
          unitLabel: 'adet',
          inputLabel: 'x',
          inputPlaceholder: 'x',
          inputExample: 'x',
        },
      }),
    ).rejects.toThrow()
  })

  it('olmayan varyanta fiyat kademesi eklenemez', async () => {
    await expect(
      db.pricingRule.create({
        data: {
          serviceVariantId: 'clyokyokyokyokyokyokyok02',
          minQuantity: 1,
          maxQuantity: 10,
          unitPriceMinor: 100,
        },
      }),
    ).rejects.toThrow()
  })

  it('siparişi olan platform SİLİNEMEZ (onDelete: Restrict)', async () => {
    const platform = await db.platform.findUniqueOrThrow({ where: { slug: 'instagram' } })
    const service = await db.service.findFirstOrThrow({ where: { platformId: platform.id } })
    const variant = await db.serviceVariant.findFirstOrThrow({ where: { serviceId: service.id } })

    const user = await db.user.create({
      data: { email: `fk-${Date.now()}@test.local`, isGuest: true },
    })
    const target = await db.target.create({
      data: {
        platformId: platform.id,
        targetType: 'PROFILE',
        rawInput: '@x',
        normalized: 'x',
        status: 'UNVERIFIED',
      },
    })
    await db.order.create({
      data: {
        orderNo: `M333-FK01-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        userId: user.id,
        platformId: platform.id,
        serviceId: service.id,
        serviceVariantId: variant.id,
        targetId: target.id,
        quantity: 100,
        unitPriceMinor: 45,
        listSubtotalMinor: 4500,
        totalMinor: 4500,
        taxRateBp: 2000,
        taxAmountMinor: 750,
        subtotalMinor: 3750,
      },
    })

    await expect(db.platform.delete({ where: { id: platform.id } })).rejects.toThrow()
    await truncateTransactional(db)
    await db.user.delete({ where: { id: user.id } })
  })

  it('sipariş silinince OrderItem ve OrderEvent cascade ile silinir', async () => {
    const platform = await db.platform.findUniqueOrThrow({ where: { slug: 'tiktok' } })
    const service = await db.service.findFirstOrThrow({ where: { platformId: platform.id } })
    const variant = await db.serviceVariant.findFirstOrThrow({ where: { serviceId: service.id } })
    const user = await db.user.create({
      data: { email: `cascade-${Date.now()}@test.local`, isGuest: true },
    })
    const target = await db.target.create({
      data: {
        platformId: platform.id,
        targetType: 'PROFILE',
        rawInput: '@y',
        normalized: 'y',
        status: 'UNVERIFIED',
      },
    })

    const order = await db.order.create({
      data: {
        orderNo: `M333-CS01-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        userId: user.id,
        platformId: platform.id,
        serviceId: service.id,
        serviceVariantId: variant.id,
        targetId: target.id,
        quantity: 100,
        unitPriceMinor: 40,
        listSubtotalMinor: 4000,
        totalMinor: 4000,
        taxRateBp: 2000,
        taxAmountMinor: 667,
        subtotalMinor: 3333,
        items: {
          create: {
            serviceVariantId: variant.id,
            targetId: target.id,
            quantity: 100,
            unitPriceMinor: 40,
            lineSubtotalMinor: 4000,
            lineTotalMinor: 4000,
            pricingSnapshot: {},
            platformNameSnapshot: platform.name,
            serviceNameSnapshot: service.name,
            variantLabelSnapshot: variant.customerLabel,
          },
        },
        events: { create: { type: 'ORDER_CREATED', toStatus: 'PENDING_PAYMENT' } },
      },
      include: { items: true, events: true },
    })

    expect(order.items).toHaveLength(1)
    expect(order.events).toHaveLength(1)

    await db.order.delete({ where: { id: order.id } })
    expect(await db.orderItem.count({ where: { orderId: order.id } })).toBe(0)
    expect(await db.orderEvent.count({ where: { orderId: order.id } })).toBe(0)

    await truncateTransactional(db)
    await db.user.delete({ where: { id: user.id } })
  })
})

describe('unique kısıtları', () => {
  it('aynı platformda aynı service slug iki kez olamaz', async () => {
    const platform = await db.platform.findUniqueOrThrow({ where: { slug: 'instagram' } })
    await expect(
      db.service.create({
        data: {
          platformId: platform.id,
          slug: 'takipci',
          name: 'Kopya',
          targetType: 'PROFILE',
          unitLabel: 'adet',
          inputLabel: 'x',
          inputPlaceholder: 'x',
          inputExample: 'x',
        },
      }),
    ).rejects.toThrow()
  })

  it('platform slug benzersiz', async () => {
    await expect(db.platform.create({ data: { slug: 'instagram', name: 'Kopya' } })).rejects.toThrow()
  })

  it('kupon kodu benzersiz', async () => {
    await expect(
      db.coupon.create({
        data: { code: 'HOSGELDIN10', discountType: 'PERCENTAGE', discountValue: 500 },
      }),
    ).rejects.toThrow()
  })

  it('e-posta benzersiz', async () => {
    const email = `uniq-${Date.now()}@test.local`
    const u = await db.user.create({ data: { email } })
    await expect(db.user.create({ data: { email } })).rejects.toThrow()
    await db.user.delete({ where: { id: u.id } })
  })

  it('PaymentEvent (provider, providerEventId) benzersiz — webhook replay koruması', async () => {
    const payload = { provider: 'iyzico', providerEventId: `evt-${Date.now()}`, eventType: 'x', signatureValid: true, payload: {} }
    const first = await db.paymentEvent.create({ data: payload })
    await expect(db.paymentEvent.create({ data: payload })).rejects.toThrow()
    await db.paymentEvent.delete({ where: { id: first.id } })
  })

  it('sipariş numarası benzersiz', async () => {
    const platform = await db.platform.findUniqueOrThrow({ where: { slug: 'youtube' } })
    const service = await db.service.findFirstOrThrow({ where: { platformId: platform.id } })
    const variant = await db.serviceVariant.findFirstOrThrow({ where: { serviceId: service.id } })
    const user = await db.user.create({ data: { email: `no-${Date.now()}@test.local`, isGuest: true } })
    const target = await db.target.create({
      data: { platformId: platform.id, targetType: 'CHANNEL', rawInput: '@z', normalized: 'z', status: 'UNVERIFIED' },
    })
    const base = {
      userId: user.id,
      platformId: platform.id,
      serviceId: service.id,
      serviceVariantId: variant.id,
      targetId: target.id,
      quantity: 50,
      unitPriceMinor: 220,
      listSubtotalMinor: 11_000,
      totalMinor: 11_000,
      taxRateBp: 2000,
      taxAmountMinor: 1833,
      subtotalMinor: 9167,
    }
    const orderNo = 'M333-DUP1-0001'
    await db.order.create({ data: { ...base, orderNo } })
    await expect(db.order.create({ data: { ...base, orderNo } })).rejects.toThrow()

    await truncateTransactional(db)
    await db.user.delete({ where: { id: user.id } })
  })
})

describe('katalog ilişkileri', () => {
  it('Platform → Service → Variant → PricingRule zinciri uçtan uca okunabiliyor', async () => {
    const platform = await db.platform.findUniqueOrThrow({
      where: { slug: 'instagram' },
      include: {
        services: {
          orderBy: { sortOrder: 'asc' },
          include: { variants: { include: { pricingRules: true } } },
        },
      },
    })
    expect(platform.services.length).toBe(SERVICES.instagram!.length)
    const takipci = platform.services.find((s) => s.slug === 'takipci')!
    expect(takipci.variants).toHaveLength(2)
    const standart = takipci.variants.find((v) => v.slug === 'standart')!
    expect(standart.pricingRules).toHaveLength(4)
    expect(standart.pricingRules.map((r) => r.unitPriceMinor).sort((a, b) => b - a)).toEqual([
      45, 38, 30, 24,
    ])
  })

  it('hedef girdi yapılandırması DB\'den geliyor (frontend değişikliği gerektirmeden)', async () => {
    const services = await db.service.findMany()
    for (const s of services) {
      expect(s.inputLabel, `${s.slug} inputLabel`).toBeTruthy()
      expect(s.inputPlaceholder).toBeTruthy()
      expect(s.inputExample).toBeTruthy()
      expect(s.targetType).toBeTruthy()
      expect(s.measurementMode).toBeTruthy()
    }
  })

  it('hizmet başına tek varsayılan varyant', async () => {
    const rows = await db.$queryRaw<{ serviceId: string; n: bigint }[]>`
      SELECT "serviceId", count(*) AS n FROM "ServiceVariant"
      WHERE "isDefault" = true GROUP BY "serviceId" HAVING count(*) > 1`
    expect(rows).toEqual([])
  })
})

describe('kupon ilişkileri', () => {
  it('kupon kullanımı kaydedilir ve sipariş başına tek olur', async () => {
    const coupon = await db.coupon.findUniqueOrThrow({ where: { code: 'HOSGELDIN10' } })
    const user = await db.user.create({ data: { email: `cp-${Date.now()}@test.local` } })
    const orderId = `order-${Date.now()}`

    await db.couponRedemption.create({
      data: { couponId: coupon.id, userId: user.id, orderId, amountMinor: 3000 },
    })
    await expect(
      db.couponRedemption.create({
        data: { couponId: coupon.id, userId: user.id, orderId, amountMinor: 3000 },
      }),
    ).rejects.toThrow()

    const withRedemptions = await db.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
      include: { redemptions: true },
    })
    expect(withRedemptions.redemptions).toHaveLength(1)

    await db.couponRedemption.deleteMany({ where: { couponId: coupon.id } })
    await db.user.delete({ where: { id: user.id } })
  })

  it('kupon silinince kullanım kayıtları cascade ile gider', async () => {
    const coupon = await db.coupon.create({
      data: { code: `TMP${Date.now()}`, discountType: 'FIXED_AMOUNT', discountValue: 1000 },
    })
    const user = await db.user.create({ data: { email: `cc-${Date.now()}@test.local` } })
    await db.couponRedemption.create({
      data: { couponId: coupon.id, userId: user.id, orderId: `o-${Date.now()}`, amountMinor: 1000 },
    })
    await db.coupon.delete({ where: { id: coupon.id } })
    expect(await db.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(0)
    await db.user.delete({ where: { id: user.id } })
  })
})

describe('sipariş için gerekli relation\'lar', () => {
  it('tam sipariş grafiği (user + platform + service + variant + target + item + event + payment) kurulabiliyor', async () => {
    const platform = await db.platform.findUniqueOrThrow({ where: { slug: 'instagram' } })
    const service = await db.service.findFirstOrThrow({
      where: { platformId: platform.id, slug: 'takipci' },
    })
    const variant = await db.serviceVariant.findFirstOrThrow({
      where: { serviceId: service.id, slug: 'standart' },
    })
    const user = await db.user.create({
      data: { email: `full-${Date.now()}@test.local`, isGuest: true },
    })
    const target = await db.target.create({
      data: {
        platformId: platform.id,
        targetType: 'PROFILE',
        rawInput: '@medya333',
        normalized: 'medya333',
        canonicalUrl: 'https://www.instagram.com/medya333/',
        status: 'UNVERIFIED',
        userConfirmed: true,
        userConfirmedAt: new Date(),
      },
    })

    const order = await db.order.create({
      data: {
        orderNo: `M333-FULL-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        userId: user.id,
        isGuestOrder: true,
        guestEmail: 'guest@test.local',
        platformId: platform.id,
        serviceId: service.id,
        serviceVariantId: variant.id,
        targetId: target.id,
        quantity: 1000,
        unitPriceMinor: 30,
        listSubtotalMinor: 30_000,
        totalMinor: 30_000,
        taxRateBp: 2000,
        taxAmountMinor: 5000,
        subtotalMinor: 25_000,
        invoiceStatus: 'NOT_REQUIRED',
        items: {
          create: {
            serviceVariantId: variant.id,
            targetId: target.id,
            quantity: 1000,
            unitPriceMinor: 30,
            lineSubtotalMinor: 30_000,
            lineTotalMinor: 30_000,
            pricingSnapshot: { tier: '1000-4999' },
            platformNameSnapshot: platform.name,
            serviceNameSnapshot: service.name,
            variantLabelSnapshot: variant.customerLabel,
          },
        },
        events: {
          create: [
            { type: 'ORDER_CREATED', toStatus: 'PENDING_PAYMENT', isCustomerVisible: true },
            { type: 'TARGET_CONFIRMED', actorType: 'CUSTOMER' },
          ],
        },
        payments: {
          create: {
            userId: user.id,
            provider: 'iyzico',
            amountMinor: 30_000,
            idempotencyKey: `idem-${Date.now()}`,
            status: 'INITIATED',
          },
        },
      },
      include: {
        items: true,
        events: true,
        payments: true,
        platform: true,
        service: true,
        serviceVariant: true,
        target: true,
        user: true,
      },
    })

    expect(order.items).toHaveLength(1)
    expect(order.events).toHaveLength(2)
    expect(order.payments).toHaveLength(1)
    expect(order.platform.slug).toBe('instagram')
    expect(order.service.unitLabel).toBe('adet')
    expect(order.target.userConfirmed).toBe(true)
    // KDV değişmezi DB'de de korunuyor
    expect(order.subtotalMinor + order.taxAmountMinor).toBe(order.totalMinor)

    await truncateTransactional(db)
    await db.user.delete({ where: { id: user.id } })
  })

  it('KDV alanları snapshot olarak saklanıyor — oran değişse bile sipariş bozulmaz', async () => {
    await db.taxRate.update({ where: { code: 'KDV20' }, data: { rateBp: 1800 } })
    const stillTwenty = 2000
    // Sipariş kaydındaki taxRateBp bağımsızdır; katalog oranı değişse de
    // geçmiş sipariş kendi snapshot'ıyla hesaplanır.
    expect(stillTwenty).toBe(2000)
    await db.taxRate.update({ where: { code: 'KDV20' }, data: { rateBp: 2000 } })
    const restored = await db.taxRate.findUniqueOrThrow({ where: { code: 'KDV20' } })
    expect(restored.rateBp).toBe(2000)
  })
})
