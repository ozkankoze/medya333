/**
 * API ENTEGRASYON TESTLERİ — gerçek route handler'ları, GERÇEK PostgreSQL
 *
 * Kapsam:
 *   • Katalog API: yapı + İÇ ALAN SIZINTISI kontrolü
 *   • Pricing API: otorite fiyat, istemci fiyatına güvenmeme, unitLabel, appliedTier
 *   • Kupon API: aktiflik/tarih/limit/kapsam/minimum tutar
 *   • Güvenlik: rate limit, gövde boyutu, Zod, güvenli hata, admin yetkilendirme
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// --- Route'lar import EDİLMEDEN önce env hazırlanmalı ---
const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://medya333:medya333@127.0.0.1:5432/medya333_test?schema=public'
process.env.DATABASE_URL = TEST_DB
process.env.DEFAULT_TAX_RATE_BP = '2000'
process.env.IP_HASH_SALT = 'test-salt-test-salt-test'
process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.ORDER_TOKEN_SECRET = 'test-token-secret-test-token-secret-0123'
delete process.env.REDIS_URL // testlerde bellek-içi rate limit

/** Oturum mock'u — admin yetkilendirme testleri bunu değiştirir. */
const session: { user: null | { id: string; email: string; name: null; role: string; isGuest: boolean } } = {
  user: null,
}

vi.mock('@/server/auth', async () => {
  const { ROLE_LEVEL } = await import('@/lib/enums')
  // GERÇEK sınıf kullanılır; kopya sınıf `instanceof` kontrolünü kırar ve
  // 401/403 sessizce 500'e dönüşür.
  const { AuthError } = await import('@/server/auth/errors')
  return {
    AuthError,
    getSessionUser: async () => session.user,
    requireUser: async () => {
      if (!session.user) throw new AuthError('UNAUTHENTICATED', 'Giriş yapmalısınız.')
      return session.user
    },
    requireRole: async (min: string) => {
      if (!session.user) throw new AuthError('UNAUTHENTICATED', 'Giriş yapmalısınız.')
      const lvl = ROLE_LEVEL as Record<string, number>
      if ((lvl[session.user.role] ?? 0) < (lvl[min] ?? 0)) {
        throw new AuthError('FORBIDDEN', 'Bu işlem için yetkiniz yok.')
      }
      return session.user
    },
  }
})

import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import { setupTestDatabase, truncateTransactional, type TestDatabase } from './db-setup'

type Json = Record<string, any>

let ctx: TestDatabase
let db: PrismaClient
let catalog: Json

let catalogGET: (req: any) => Promise<Response>
let quotePOST: (req: any) => Promise<Response>
let couponPOST: (req: any) => Promise<Response>
let resolvePOST: (req: any) => Promise<Response>
let adminPlatformsPOST: (req: any) => Promise<Response>
let adminPlatformsGET: (req: any) => Promise<Response>
let adminValidateGET: (req: any) => Promise<Response>

let ipSeq = 0
function makeReq(url: string, body?: unknown, headers: Record<string, string> = {}) {
  ipSeq++
  const { NextRequest } = require('next/server')
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.${Math.floor(ipSeq / 60000)}.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)
  // Önceki başarısız koşumlardan kalan test kayıtlarını temizle
  await db.platform.deleteMany({ where: { slug: { in: ['spotify', 'hayalet'] } } })
  await db.coupon.deleteMany({ where: { code: { in: ['GECMIS', 'PASIF', 'DOLU', 'SADECETIKTOK'] } } })
  // Audit log FK'si gerçek kullanıcı ister — rol testleri için oluşturulur
  for (const [id, role] of [['u1', 'CUSTOMER'], ['u2', 'SUPPORT'], ['u3', 'ADMIN']] as const) {
    await db.user.upsert({
      where: { email: `${id}@roles.test` },
      update: { role },
      create: { id, email: `${id}@roles.test`, role },
    })
  }
  ;({ GET: catalogGET } = await import('@/app/api/v1/catalog/snapshot/route'))
  ;({ POST: quotePOST } = await import('@/app/api/v1/pricing/quote/route'))
  ;({ POST: couponPOST } = await import('@/app/api/v1/coupons/validate/route'))
  ;({ POST: resolvePOST } = await import('@/app/api/v1/targets/resolve/route'))
  ;({ POST: adminPlatformsPOST, GET: adminPlatformsGET } = await import(
    '@/app/api/v1/admin/platforms/route'
  ))
  ;({ GET: adminValidateGET } = await import('@/app/api/v1/admin/pricing/validate/route'))

  catalog = await (await catalogGET(makeReq('http://localhost/api/v1/catalog/snapshot'))).json()
}, 240_000)

afterAll(async () => {
  await truncateTransactional(db).catch(() => undefined)
  await ctx?.stop()
})

function findVariant(platformSlug: string, serviceSlug: string, variantSlug?: string) {
  const p = catalog.platforms.find((x: Json) => x.slug === platformSlug)
  const s = p?.services.find((x: Json) => x.slug === serviceSlug)
  const v = variantSlug ? s?.variants.find((x: Json) => x.slug === variantSlug) : s?.variants[0]
  if (!p || !s || !v) throw new Error(`${platformSlug}/${serviceSlug} bulunamadı`)
  return { platform: p, service: s, variant: v }
}

// ---------------------------------------------------------------------------

describe('GET /api/v1/catalog/snapshot', () => {
  it('katalog zinciri eksiksiz: Platform → Service → Variant → PricingRule → target config', () => {
    // ⚠️ Faz 5.1: Instagram · YouTube · Facebook · TikTok aktiftir.
    expect(catalog.platforms.map((p: Json) => p.slug)).toEqual([
      'instagram',
      'tiktok',
      'youtube',
      'facebook',
    ])
    const { service, variant } = findVariant('instagram', 'takipci', 'turk')
    expect(service.targetType).toBe('PROFILE')
    expect(service.inputLabel).toBeTruthy()
    expect(service.inputPlaceholder).toBeTruthy()
    expect(service.inputExample).toBeTruthy()
    expect(service.unitLabel).toBe('takipçi')
    expect(variant.tiers).toHaveLength(8)
    expect(variant.minQuantity).toBe(500)
    expect(variant.presetOnly).toBe(true)
    expect(variant.presetQuantities).toEqual([500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000])
  })

  it('⚠️ demo katalog müşteriye GÖRÜNMEZ', () => {
    const raw = JSON.stringify(catalog)
    // Gerçek katalogda yer almayan platformlar ve Faz 0-4 demo hizmetleri
    for (const demo of ['telegram', 'profil-tanitimi', 'Premium', 'Standart', '"x"']) {
      expect(raw, `demo katalog kalıntısı: ${demo}`).not.toContain(demo)
    }
  })

  it('8 gerçek hizmet listelenir', () => {
    const names = catalog.platforms[0].services.map((s: Json) => s.name)
    expect(names).toEqual([
      'Takipçi',
      'Beğeni',
      'Görüntülenme',
      'Yorum',
      'Kaydetme',
      'Paylaşım',
      'Keşfet Paketi',
      'Aylık Türk Beğeni + Yorum Paketi',
    ])
  })

  it('katalogdaki toplam fiyat noktası sayısı 199', () => {
    const total = catalog.platforms.flatMap((p: Json) => p.services).flatMap((s: Json) => s.variants)
      .reduce((n: number, v: Json) => n + v.tiers.length, 0)
    expect(total).toBe(199)

    const instagram = catalog.platforms.find((p: Json) => p.slug === 'instagram')
    const igTotal = instagram.services
      .flatMap((s: Json) => s.variants)
      .reduce((n: number, v: Json) => n + v.tiers.length, 0)
    expect(igTotal).toBe(63)
  })

  it('KDV dahil bayrağı ve oranı', () => {
    expect(catalog.pricesTaxInclusive).toBe(true)
    expect(catalog.taxRateBp).toBe(2000)
    expect(catalog.currency).toBe('TRY')
  })

  it('🔒 İÇ ALAN SIZINTISI YOK', () => {
    const raw = JSON.stringify(catalog)
    for (const forbidden of [
      'internalName',
      'IG-Takipci', // internalName içeriği
      'adminNote',
      'adapterKey',
      'adapterConfig',
      'createdById',
      'passwordHash',
      'twoFactorSecret',
      'idempotencyKey',
      'IYZICO',
      'AUTH_SECRET',
      'DATABASE_URL',
      'coupon',
      'HOSGELDIN',
      'maxRedemptions',
      'discountValue',
      'estimatedCompleteMinutes', // fulfillment iç bilgisi değil ama SLA vaadi -> aşağıda ayrıca kontrol
    ]) {
      if (forbidden === 'estimatedCompleteMinutes') continue
      expect(raw, `"${forbidden}" public katalogda görünüyor`).not.toContain(forbidden)
    }
  })

  it('🔒 varyantta yalnızca müşteriye açık alanlar var', () => {
    const { variant } = findVariant('instagram', 'takipci', 'yabanci')
    const allowed = new Set([
      'id', 'slug', 'customerLabel', 'tagline', 'description', 'badge', 'isDefault',
      'packageItems', 'minQuantity', 'maxQuantity', 'quantityStep', 'presetQuantities',
      'presetOnly', 'estimatedStartMinutes', 'estimatedCompleteMinutes', 'refillDays', 'tiers',
    ])
    for (const key of Object.keys(variant)) {
      expect(allowed.has(key), `Beklenmeyen varyant alanı: ${key}`).toBe(true)
    }
  })

  it('rate limit başlıkları döner', async () => {
    const res = await catalogGET(makeReq('http://localhost/api/v1/catalog/snapshot'))
    expect(res.headers.get('X-RateLimit-Limit')).toBe('120')
  })
})

describe('POST /api/v1/pricing/quote', () => {
  it('istenen alanların tamamını döndürür', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', {
        serviceVariantId: variant.id,
        quantity: 1000,
      }),
    )
    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.quantity).toBe(1000)
    // ⚠️ 1.000 Türk takipçi = 1.349,90 ₺ (gerçek satış fiyatı, KDV dahil)
    expect(j.total).toBe(134_990)
    expect(j.pricingMode).toBe('PACKAGE')
    expect(j.packagePrice).toBe(134_990)
    expect(j.unitPrice).toBe(0) // sabit pakette birim fiyat YOKTUR
    expect(j.unitLabel).toBe('takipçi')
    expect(j.taxRate).toBe(2000)
    expect(j.currency).toBe('TRY')
    expect(j.appliedTier).toMatchObject({ mode: 'PACKAGE', minQuantity: 1000, maxQuantity: 1000 })
    expect(j.nextTier).toBeNull()
    // KDV DAHİL değişmezi
    expect(j.subtotal + j.taxAmount).toBe(j.total)
  })

  it('🔒 istemciden gelen fiyat alanları YOK SAYILIR', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', {
        serviceVariantId: variant.id,
        quantity: 1000,
        // Saldırgan girdisi:
        unitPrice: 1,
        subtotal: 1,
        tax: 0,
        taxAmount: 0,
        total: 1,
        totalMinor: 1,
      }),
    )
    const j = await res.json()
    expect(j.total).toBe(134_990) // istemcinin 1 kuruşu dikkate alınmadı
    expect(j.packagePrice).toBe(134_990)
  })

  it('unitLabel "ay" olan sabit pakette doğru döner', async () => {
    const { variant } = findVariant('instagram', 'aylik-begeni-yorum-paketi', 'paket-1')
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', { serviceVariantId: variant.id, quantity: 1 }),
    )
    const j = await res.json()
    expect(j.unitLabel).toBe('ay')
    expect(j.total).toBe(125_000) // 1.250,00 ₺
  })

  it('her hazır miktar KENDİ gerçek fiyatını döner', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'yabanci')
    // ⚠️ Brief'teki Yabancı Takipçi listesi — birebir.
    const cases: Array<[number, number]> = [
      [500, 32_490], [1000, 59_990], [2500, 134_990], [5000, 249_990], [10_000, 449_990],
      [25_000, 999_990], [50_000, 1_749_990], [100_000, 3_249_990], [250_000, 7_499_990],
      [1_000_000, 24_999_990],
    ]
    for (const [qty, total] of cases) {
      const res = await quotePOST(
        makeReq('http://localhost/api/v1/pricing/quote', { serviceVariantId: variant.id, quantity: qty }),
      )
      const j = await res.json()
      expect(j.total, `${qty} takipçi`).toBe(total)
    }
  })

  it('⚠️ hazır listede OLMAYAN miktar reddedilir (7.342)', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', { serviceVariantId: variant.id, quantity: 7342 }),
    )
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error.code).toBe('QUANTITY_NOT_ALLOWED')
    expect(j.error.message).toContain('hazır paket')
  })

  it('⚠️ hazır miktarın 1 fazlası bile reddedilir (501)', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', { serviceVariantId: variant.id, quantity: 501 }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('QUANTITY_NOT_ALLOWED')
  })

  it('⚠️ Türk takipçide 1.000.000 paketi YOKTUR', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', {
        serviceVariantId: variant.id,
        quantity: 1_000_000,
      }),
    )
    expect(res.status).toBe(400)
  })

  it('olmayan varyant 404', async () => {
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', {
        serviceVariantId: 'clyokyokyokyokyokyokyok01',
        quantity: 500,
      }),
    )
    expect(res.status).toBe(404)
  })

  it('🔒 çok büyük gövde 413 ile reddedilir', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', {
        serviceVariantId: variant.id,
        quantity: 500,
        junk: 'x'.repeat(100_000),
      }),
    )
    expect(res.status).toBe(413)
    expect((await res.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('🔒 hata cevabında stack/SQL/dosya yolu sızmaz', async () => {
    const res = await quotePOST(makeReq('http://localhost/api/v1/pricing/quote', { bad: true }))
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toMatch(/at .*\/src\/|node_modules|SELECT |prisma\./i)
  })

  it('🔒 rate limit uygulanır (30/dk/IP)', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const fixed = { 'x-forwarded-for': '198.51.100.44' }
    let limited = 0
    for (let i = 0; i < 33; i++) {
      const res = await quotePOST(
        makeReq('http://localhost/api/v1/pricing/quote', { serviceVariantId: variant.id, quantity: 500 }, fixed),
      )
      if (res.status === 429) limited++
    }
    expect(limited).toBeGreaterThan(0)
  })
})

describe('POST /api/v1/coupons/validate', () => {
  it('geçerli kupon indirimi SUNUCUDA hesaplanır', async () => {
    // 250 Türk Beğeni = 109,90 ₺ · %10 = 10,99 ₺ (tavanın altında)
    const { variant } = findVariant('instagram', 'begeni', 'turk')
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'HOSGELDIN10',
        serviceVariantId: variant.id,
        quantity: 250,
      }),
    )
    const j = await res.json()
    expect(j.valid).toBe(true)
    expect(j.totalBeforeCoupon).toBe(10_990)
    expect(j.discount).toBe(1099)
    expect(j.total).toBe(9891)
    expect(j.subtotal + j.taxAmount).toBe(j.total)
  })

  it('indirim tavanı uygulanır', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'HOSGELDIN10',
        serviceVariantId: variant.id,
        quantity: 100_000, // 74.999,90 ₺ · %10 = 7.499,99 ₺ ama tavan 150 ₺
      }),
    )
    const j = await res.json()
    expect(j.valid).toBe(true)
    expect(j.discount).toBe(15_000)
  })

  it('minimum sipariş tutarı altında indirim yok', async () => {
    const { variant } = findVariant('instagram', 'yorum', 'turk')
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'HOSGELDIN10',
        serviceVariantId: variant.id,
        quantity: 10, // 49,90 ₺ < 50 ₺ minimum sepet
      }),
    )
    const j = await res.json()
    expect(j.valid).toBe(false)
    expect(j.discount).toBe(0)
  })

  it('olmayan kupon valid:false döner (500 DEĞİL)', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'YOKBOYLEKUPON',
        serviceVariantId: variant.id,
        quantity: 1000,
      }),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.valid).toBe(false)
    expect(j.reason).toBeTruthy()
  })

  it('süresi dolmuş kupon reddedilir', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    await db.coupon.create({
      data: {
        code: 'GECMIS',
        discountType: 'PERCENTAGE',
        discountValue: 2000,
        validFrom: new Date('2020-01-01'),
        validUntil: new Date('2020-12-31'),
      },
    })
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'GECMIS',
        serviceVariantId: variant.id,
        quantity: 1000,
      }),
    )
    const j = await res.json()
    expect(j.valid).toBe(false)
    expect(j.reason).toContain('süresi')
    await db.coupon.delete({ where: { code: 'GECMIS' } })
  })

  it('pasif kupon reddedilir', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    await db.coupon.create({
      data: { code: 'PASIF', discountType: 'FIXED_AMOUNT', discountValue: 1000, isActive: false },
    })
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'PASIF',
        serviceVariantId: variant.id,
        quantity: 1000,
      }),
    )
    expect((await res.json()).valid).toBe(false)
    await db.coupon.delete({ where: { code: 'PASIF' } })
  })

  it('kullanım limiti dolmuş kupon reddedilir', async () => {
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    await db.coupon.create({
      data: {
        code: 'DOLU',
        discountType: 'FIXED_AMOUNT',
        discountValue: 1000,
        maxRedemptions: 1,
        redemptionCount: 1,
      },
    })
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'DOLU',
        serviceVariantId: variant.id,
        quantity: 1000,
      }),
    )
    const j = await res.json()
    expect(j.valid).toBe(false)
    expect(j.reason).toContain('kullanım hakkı')
    await db.coupon.delete({ where: { code: 'DOLU' } })
  })

  it('kapsam dışı platformda kupon reddedilir', async () => {
    // TikTok artık PASİF katalogdadır; kapsam kontrolü yine de kimliğe bakar.
    const tiktok = await db.platform.findUniqueOrThrow({ where: { slug: 'tiktok' } })
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    await db.coupon.create({
      data: {
        code: 'SADECETIKTOK',
        discountType: 'PERCENTAGE',
        discountValue: 1000,
        platformIds: [tiktok.id],
      },
    })
    const res = await couponPOST(
      makeReq('http://localhost/api/v1/coupons/validate', {
        code: 'SADECETIKTOK',
        serviceVariantId: variant.id,
        quantity: 1000,
      }),
    )
    const j = await res.json()
    expect(j.valid).toBe(false)
    expect(j.reason).toContain('geçerli değil')
    await db.coupon.delete({ where: { code: 'SADECETIKTOK' } })
  })
})

describe('POST /api/v1/targets/resolve (gerçek DB)', () => {
  it('Instagram fallback akışı UNVERIFIED + Target kaydı', async () => {
    const { platform, service } = findVariant('instagram', 'takipci')
    const res = await resolvePOST(
      makeReq('http://localhost/api/v1/targets/resolve', {
        platformSlug: platform.slug,
        serviceId: service.id,
        input: '@medya333',
      }),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.status).toBe('UNVERIFIED')
    expect(j.requiresConfirmation).toBe(true)
    expect(j.targetId).toBeTruthy()

    const saved = await db.target.findUniqueOrThrow({ where: { id: j.targetId } })
    expect(saved.normalized).toBe('medya333')
    expect(saved.canonicalUrl).toBe('https://www.instagram.com/medya333/')
  })

  it('yanlış platform bağlantısı INVALID', async () => {
    const { platform, service } = findVariant('instagram', 'takipci')
    const res = await resolvePOST(
      makeReq('http://localhost/api/v1/targets/resolve', {
        platformSlug: platform.slug,
        serviceId: service.id,
        input: 'https://tiktok.com/@medya333',
      }),
    )
    const j = await res.json()
    expect(j.status).toBe('INVALID')
    expect(j.message).toContain('Instagram')
  })
})

describe('🔒 Admin CRUD yetkilendirme', () => {
  it('oturum yoksa 401', async () => {
    session.user = null
    const res = await adminPlatformsGET(makeReq('http://localhost/api/v1/admin/platforms'))
    expect(res.status).toBe(401)
  })

  it('CUSTOMER rolü 403', async () => {
    session.user = { id: 'u1', email: 'c@x.com', name: null, role: 'CUSTOMER', isGuest: false }
    const res = await adminPlatformsGET(makeReq('http://localhost/api/v1/admin/platforms'))
    expect(res.status).toBe(403)
  })

  it('SUPPORT okuyabilir ama platform OLUŞTURAMAZ', async () => {
    session.user = { id: 'u2', email: 's@x.com', name: null, role: 'SUPPORT', isGuest: false }
    expect((await adminPlatformsGET(makeReq('http://localhost/api/v1/admin/platforms'))).status).toBe(200)

    const create = await adminPlatformsPOST(
      makeReq('http://localhost/api/v1/admin/platforms', {
        name: 'Spotify',
        slug: 'spotify',
        adapterKey: 'generic',
      }),
    )
    expect(create.status).toBe(403)
  })

  it('ADMIN platform oluşturabilir; katalog anında güncellenir', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
    const res = await adminPlatformsPOST(
      makeReq('http://localhost/api/v1/admin/platforms', {
        name: 'Spotify',
        slug: 'spotify',
        adapterKey: 'generic',
        brandColor: '#1DB954',
        sortOrder: 70,
      }),
    )
    expect(res.status).toBe(200)
    const created = await res.json()
    expect(created.slug).toBe('spotify')

    const inDb = await db.platform.findUniqueOrThrow({ where: { slug: 'spotify' } })
    expect(inDb.adapterKey).toBe('generic')

    // Denetim kaydı düştü mü?
    const audit = await db.auditLog.findFirst({
      where: { action: 'platform.create', entityId: created.id },
    })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).toBe('u3')

    await db.platform.delete({ where: { id: created.id } })
  })

  it('bilinmeyen adapter reddedilir', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
    const res = await adminPlatformsPOST(
      makeReq('http://localhost/api/v1/admin/platforms', {
        name: 'Hayalet',
        slug: 'hayalet',
        adapterKey: 'olmayan-adapter',
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('UNKNOWN_ADAPTER')
  })

  it('aynı slug ikinci kez 409', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
    const res = await adminPlatformsPOST(
      makeReq('http://localhost/api/v1/admin/platforms', {
        name: 'Instagram Kopya',
        slug: 'instagram',
      }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('SLUG_TAKEN')
  })

  it('geçersiz girdi 400 + alan bazlı detay', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
    const res = await adminPlatformsPOST(
      makeReq('http://localhost/api/v1/admin/platforms', { name: 'X', slug: 'GEÇERSİZ SLUG' }),
    )
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error.code).toBe('VALIDATION_ERROR')
    expect(j.error.details.slug).toBeTruthy()
  })
})

describe('Admin pricing validation', () => {
  it('sağlam katalogda hata yok', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
    const res = await adminValidateGET(makeReq('http://localhost/api/v1/admin/pricing/validate'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.summary.errors).toBe(0)
  })

  it('boşluk, çakışma, negatif fiyat ve duplicate tespit edilir', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }

    /**
     * ⚠️ GERÇEK KATALOG BOZULMAZ.
     * Doğrulayıcıyı sınamak için gerçek fiyatları bozmak yerine, yalnızca bu
     * teste ait GEÇİCİ bir varyant oluşturulur (klasik kademeli fiyatlandırma).
     */
    const service = await db.service.findFirstOrThrow({
      where: { slug: 'takipci', platform: { slug: 'instagram' } },
    })
    const temp = await db.serviceVariant.create({
      data: {
        serviceId: service.id,
        slug: 'gecici-dogrulama',
        internalName: 'Gecici-Dogrulama',
        customerLabel: 'Geçici',
        isVisible: false,
        minQuantity: 100,
        maxQuantity: 10_000,
        quantityStep: 1,
        pricingRules: {
          create: [
            { minQuantity: 100, maxQuantity: 999, unitPriceMinor: 45 },
            { minQuantity: 1000, maxQuantity: 5000, unitPriceMinor: 39 },
            { minQuantity: 1000, maxQuantity: 5000, unitPriceMinor: 37 },
          ],
        },
      },
    })

    const res = await adminValidateGET(
      makeReq(`http://localhost/api/v1/admin/pricing/validate?variantId=${temp.id}`),
    )
    const j = await res.json()
    const codes = j.results[0].issues.map((i: Json) => i.code)
    expect(codes).toContain('GAP') // 5001–10.000 tanımsız
    expect(codes).toContain('OVERLAP')
    expect(codes).toContain('DUPLICATE_TIER')
    expect(j.results[0].ok).toBe(false)
    // Mesajlar admin için anlaşılır olmalı
    for (const issue of j.results[0].issues) expect(issue.message.length).toBeGreaterThan(15)

    await db.serviceVariant.delete({ where: { id: temp.id } })
  })

  it('⚠️ hazır miktarlı varyantta ARALIK boşluğu hata sayılmaz', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
    const { variant } = findVariant('instagram', 'takipci', 'turk')
    const res = await adminValidateGET(
      makeReq(`http://localhost/api/v1/admin/pricing/validate?variantId=${variant.id}`),
    )
    const j = await res.json()
    // 501–999 arası "boşluk" değildir: o miktarlar zaten seçilemez.
    expect(j.results[0]?.issues ?? []).toEqual([])
  })

  it('⚠️ hazır miktarın fiyatı yoksa GAP raporlanır', async () => {
    session.user = { id: 'u3', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
    const { variant } = findVariant('instagram', 'begeni', 'turk')
    const rule = await db.pricingRule.findFirstOrThrow({
      where: { serviceVariantId: variant.id, minQuantity: 2500 },
    })
    await db.pricingRule.update({ where: { id: rule.id }, data: { isActive: false } })

    const res = await adminValidateGET(
      makeReq(`http://localhost/api/v1/admin/pricing/validate?variantId=${variant.id}`),
    )
    const j = await res.json()
    const gap = j.results[0].issues.find((i: Json) => i.code === 'GAP')
    expect(gap).toBeTruthy()
    expect(gap.range.from).toBe(2500)

    await db.pricingRule.update({ where: { id: rule.id }, data: { isActive: true } })
  })
})
