/**
 * KATALOG ENTEGRASYON TESTLERİ — FAZ 5
 *
 * Kapsam (brief §26):
 *   • platform / hizmet / varyant / fiyat CRUD
 *   • geçersiz fiyatlandırma
 *   • public katalog + snapshot
 *   • cache invalidation
 *   • iç alan sızıntısı
 *   • PASİF katalog SİPARİŞ EDİLEMEZ
 *   • hazır miktar kilidi (sunucu tarafı)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://medya333:medya333@127.0.0.1:5432/medya333_test?schema=public'
process.env.DATABASE_URL = TEST_DB
process.env.DEFAULT_TAX_RATE_BP = '2000'
process.env.IP_HASH_SALT = 'test-salt-test-salt-test'
process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.ORDER_TOKEN_SECRET = 'test-token-secret-test-token-secret-0123'
delete process.env.REDIS_URL

const session: {
  user: null | { id: string; email: string; name: null; role: string; isGuest: boolean }
} = { user: null }

vi.mock('@/server/auth', async () => {
  const { ROLE_LEVEL } = await import('@/lib/enums')
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

/** Katalog önbelleğinin gerçekten düşürüldüğünü görebilmek için casus. */
const revalidated: string[] = []
vi.mock('next/cache', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    revalidateTag: (tag: string) => {
      revalidated.push(tag)
    },
    // Snapshot testlerinde önbellek DEĞİL, taze DB okunmalı.
    unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  }
})

import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import { setupTestDatabase, truncateTransactional, type TestDatabase } from './db-setup'

type Json = Record<string, any>

let ctx: TestDatabase
let db: PrismaClient

let catalogGET: (req: any) => Promise<Response>
let quotePOST: (req: any) => Promise<Response>
let ordersPOST: (req: any) => Promise<Response>
let servicesPOST: (req: any) => Promise<Response>
let servicePATCH: (req: any, ctx: any) => Promise<Response>
let variantsPOST: (req: any) => Promise<Response>
let variantPATCH: (req: any, ctx: any) => Promise<Response>
let rulesPOST: (req: any) => Promise<Response>
let rulePATCH: (req: any, ctx: any) => Promise<Response>
let simulatePOST: (req: any) => Promise<Response>

let ipSeq = 0
function makeReq(url: string, body?: unknown, headers: Record<string, string> = {}) {
  ipSeq++
  const { NextRequest } = require('next/server')
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.9.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function patchReq(url: string, body: unknown) {
  const { NextRequest } = require('next/server')
  ipSeq++
  return new NextRequest(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.8.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}`,
    },
    body: JSON.stringify(body),
  })
}

const asAdmin = () => {
  session.user = { id: 'cat-admin', email: 'a@x.com', name: null, role: 'ADMIN', isGuest: false }
}
const asCustomer = () => {
  session.user = { id: 'cat-cust', email: 'c@x.com', name: null, role: 'CUSTOMER', isGuest: false }
}

async function snapshot(): Promise<Json> {
  return (await catalogGET(makeReq('http://localhost/api/v1/catalog/snapshot'))).json()
}

let instagramId: string

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)

  for (const [id, role] of [
    ['cat-admin', 'ADMIN'],
    ['cat-cust', 'CUSTOMER'],
  ] as const) {
    await db.user.upsert({
      where: { email: `${id}@catalog.test` },
      update: { role },
      create: { id, email: `${id}@catalog.test`, role },
    })
  }

  ;({ GET: catalogGET } = await import('@/app/api/v1/catalog/snapshot/route'))
  ;({ POST: quotePOST } = await import('@/app/api/v1/pricing/quote/route'))
  ;({ POST: ordersPOST } = await import('@/app/api/v1/orders/route'))
  ;({ POST: servicesPOST } = await import('@/app/api/v1/admin/services/route'))
  ;({ PATCH: servicePATCH } = await import('@/app/api/v1/admin/services/[id]/route'))
  ;({ POST: variantsPOST } = await import('@/app/api/v1/admin/variants/route'))
  ;({ PATCH: variantPATCH } = await import('@/app/api/v1/admin/variants/[id]/route'))
  ;({ POST: rulesPOST } = await import('@/app/api/v1/admin/pricing-rules/route'))
  ;({ PATCH: rulePATCH } = await import('@/app/api/v1/admin/pricing-rules/[id]/route'))
  ;({ POST: simulatePOST } = await import('@/app/api/v1/admin/pricing/simulate/route'))

  instagramId = (await db.platform.findUniqueOrThrow({ where: { slug: 'instagram' } })).id
}, 240_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  revalidated.length = 0
  session.user = null
  await db.service.deleteMany({ where: { slug: { startsWith: 'test-' } } })
})

// ===========================================================================
describe('public katalog', () => {
  it('yalnızca AKTİF katalog döner', async () => {
    const snap = await snapshot()
    expect(snap.platforms).toHaveLength(1)
    expect(snap.platforms[0].slug).toBe('instagram')
    expect(snap.platforms[0].services).toHaveLength(8)
  })

  it('63 fiyat noktası müşteriye ulaşır', async () => {
    const snap = await snapshot()
    const points = snap.platforms
      .flatMap((p: Json) => p.services)
      .flatMap((s: Json) => s.variants)
      .reduce((n: number, v: Json) => n + v.tiers.length, 0)
    expect(points).toBe(63)
  })

  it('sabit paket içeriği ve açıklaması müşteriye gelir', async () => {
    const snap = await snapshot()
    const kesfet = snap.platforms[0].services.find((s: Json) => s.slug === 'kesfet-paketi')
    expect(kesfet.variants[0].packageItems).toEqual([
      '500 - 1.500 Türk Beğeni',
      '10 - 35 Türk Yorum',
      '10.000 - 25.000 Görüntülenme',
      '250 - 500 Kaydetme',
      '50 - 150 Paylaşım',
    ])

    const takipci = snap.platforms[0].services.find((s: Json) => s.slug === 'takipci')
    const turk = takipci.variants.find((v: Json) => v.slug === 'turk')
    expect(turk.description).toContain('Takipçiler Türk')
    expect(turk.presetOnly).toBe(true)
  })

  it('🔒 İÇ ALANLAR SIZMAZ', async () => {
    const raw = JSON.stringify(await snapshot())
    for (const forbidden of [
      'internalName',
      'IG-Takipci',
      'adapterKey',
      'adapterConfig',
      'createdById',
      'adminNote',
      'isVisible',
      'sortOrder',
      'seoDescription',
    ]) {
      expect(raw, `"${forbidden}" public katalogda görünüyor`).not.toContain(forbidden)
    }
  })

  it('🔒 fiyat kademesinde iç alan yok', async () => {
    const snap = await snapshot()
    const tier = snap.platforms[0].services[0].variants[0].tiers[0]
    expect(Object.keys(tier).sort()).toEqual(
      [
        'id',
        'maxQuantity',
        'minQuantity',
        'mode',
        'packagePriceMinor',
        'priority',
        'setupFeeMinor',
        'unitPriceMinor',
      ].sort(),
    )
  })
})

// ===========================================================================
describe('admin katalog CRUD', () => {
  it('CUSTOMER hizmet oluşturamaz', async () => {
    asCustomer()
    const res = await servicesPOST(
      makeReq('http://localhost/api/v1/admin/services', {
        platformId: instagramId,
        name: 'Test Hizmet',
        slug: 'test-hizmet',
        targetType: 'PROFILE',
        inputLabel: 'Hedef',
        inputPlaceholder: '@ornek',
        inputExample: 'ornek',
      }),
    )
    expect(res.status).toBe(403)
  })

  it('ADMIN hizmet → varyant → fiyat zincirini kurabilir ve katalogda görünür', async () => {
    asAdmin()

    const svcRes = await servicesPOST(
      makeReq('http://localhost/api/v1/admin/services', {
        platformId: instagramId,
        name: 'Test Hizmet',
        slug: 'test-hizmet',
        targetType: 'PROFILE',
        unitLabel: 'adet',
        inputLabel: 'Hedef',
        inputPlaceholder: '@ornek',
        inputExample: 'ornek',
        sortOrder: 900,
      }),
    )
    expect(svcRes.status).toBe(200)
    const service = await svcRes.json()

    const varRes = await variantsPOST(
      makeReq('http://localhost/api/v1/admin/variants', {
        serviceId: service.id,
        slug: 'test-varyant',
        internalName: 'Test-Varyant',
        customerLabel: 'Test Varyant',
        minQuantity: 100,
        maxQuantity: 500,
        presetQuantities: [100, 500],
        presetOnly: true,
      }),
    )
    expect(varRes.status).toBe(200)
    const variant = await varRes.json()

    for (const [q, price] of [
      [100, 12_345],
      [500, 54_321],
    ] as const) {
      const ruleRes = await rulesPOST(
        makeReq('http://localhost/api/v1/admin/pricing-rules', {
          serviceVariantId: variant.id,
          mode: 'PACKAGE',
          minQuantity: q,
          maxQuantity: q,
          unitPriceMinor: 0,
          packagePriceMinor: price,
        }),
      )
      expect(ruleRes.status, await ruleRes.text()).toBe(200)
    }

    // Müşteri tarafında görünür ve fiyat BİREBİR aynıdır
    const snap = await snapshot()
    const inSnap = snap.platforms[0].services.find((s: Json) => s.slug === 'test-hizmet')
    expect(inSnap).toBeTruthy()

    session.user = null
    const quote = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', {
        serviceVariantId: variant.id,
        quantity: 500,
      }),
    )
    expect((await quote.json()).total).toBe(54_321)
  })

  it('yazma sonrası katalog önbelleği DÜŞÜRÜLÜR', async () => {
    asAdmin()
    revalidated.length = 0
    const res = await servicesPOST(
      makeReq('http://localhost/api/v1/admin/services', {
        platformId: instagramId,
        name: 'Test Cache',
        slug: 'test-cache',
        targetType: 'PROFILE',
        inputLabel: 'Hedef',
        inputPlaceholder: '@ornek',
        inputExample: 'ornek',
      }),
    )
    expect(res.status).toBe(200)
    expect(revalidated).toContain('catalog')
    expect(revalidated).toContain('pricing')
  })

  it('fiyat güncellemesi de önbelleği düşürür ve AuditLog\'a yazar', async () => {
    asAdmin()
    const rule = await db.pricingRule.findFirstOrThrow({
      where: { serviceVariant: { slug: 'turk', service: { slug: 'begeni' } }, minQuantity: 100 },
    })
    revalidated.length = 0

    const res = await rulePATCH(
      patchReq(`http://localhost/api/v1/admin/pricing-rules/${rule.id}`, {
        packagePriceMinor: 5_555,
      }),
      { params: Promise.resolve({ id: rule.id }) },
    )
    expect(res.status).toBe(200)
    expect(revalidated).toContain('pricing')

    const audit = await db.auditLog.findFirst({
      where: { action: 'pricing_rule.update', entityId: rule.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).toBe('cat-admin')
    // Eski ve yeni değer denetimde görünür
    expect((audit!.before as Json).packagePriceMinor).toBe(4_990)
    expect((audit!.after as Json).packagePriceMinor).toBe(5_555)

    // Gerçek fiyatı geri koy
    await db.pricingRule.update({ where: { id: rule.id }, data: { packagePriceMinor: 4_990 } })
  })
})

// ===========================================================================
describe('geçersiz fiyatlandırma reddedilir', () => {
  beforeEach(asAdmin)

  async function createRule(body: Json) {
    return rulesPOST(makeReq('http://localhost/api/v1/admin/pricing-rules', body))
  }

  it('PACKAGE kademesinde fiyat yoksa 400', async () => {
    const variant = await db.serviceVariant.findFirstOrThrow({ where: { slug: 'turk', service: { slug: 'yorum' } } })
    const res = await createRule({
      serviceVariantId: variant.id,
      mode: 'PACKAGE',
      minQuantity: 5,
      maxQuantity: 5,
      unitPriceMinor: 0,
    })
    expect(res.status).toBe(400)
  })

  it('PACKAGE kademesinde min ≠ max ise 400', async () => {
    const variant = await db.serviceVariant.findFirstOrThrow({ where: { slug: 'turk', service: { slug: 'yorum' } } })
    const res = await createRule({
      serviceVariantId: variant.id,
      mode: 'PACKAGE',
      minQuantity: 5,
      maxQuantity: 9,
      unitPriceMinor: 0,
      packagePriceMinor: 1000,
    })
    expect(res.status).toBe(400)
  })

  it('kademeli modda sıfır birim fiyat 400', async () => {
    const variant = await db.serviceVariant.findFirstOrThrow({ where: { slug: 'turk', service: { slug: 'yorum' } } })
    const res = await createRule({
      serviceVariantId: variant.id,
      mode: 'FLAT_TIER',
      minQuantity: 5,
      maxQuantity: 9,
      unitPriceMinor: 0,
    })
    expect(res.status).toBe(400)
  })

  it('aynı aralık ikinci kez 409 (DUPLICATE_TIER)', async () => {
    const variant = await db.serviceVariant.findFirstOrThrow({
      where: { slug: 'turk', service: { slug: 'yorum' } },
    })
    const res = await createRule({
      serviceVariantId: variant.id,
      mode: 'PACKAGE',
      minQuantity: 10,
      maxQuantity: 10,
      unitPriceMinor: 0,
      packagePriceMinor: 999,
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('DUPLICATE_TIER')
  })

  it('hazır miktar kilidi açıkken preset listesi boş olamaz', async () => {
    const service = await db.service.findFirstOrThrow({ where: { slug: 'yorum' } })
    const res = await variantsPOST(
      makeReq('http://localhost/api/v1/admin/variants', {
        serviceId: service.id,
        slug: 'test-bos-preset',
        internalName: 'Test',
        customerLabel: 'Test',
        minQuantity: 10,
        maxQuantity: 100,
        presetOnly: true,
        presetQuantities: [],
      }),
    )
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
describe('simülatör müşteri motoruyla AYNI sonucu verir', () => {
  it('hazır miktarlar gerçek fiyatı döner, listede olmayan miktar hata döner', async () => {
    asAdmin()
    const variant = await db.serviceVariant.findFirstOrThrow({
      where: { slug: 'turk', service: { slug: 'takipci' } },
    })
    const res = await simulatePOST(
      makeReq('http://localhost/api/v1/admin/pricing/simulate', {
        serviceVariantId: variant.id,
        quantities: [500, 1000, 7342],
      }),
    )
    const j = await res.json()
    expect(j.results[0]).toMatchObject({ quantity: 500, ok: true, total: 69_990 })
    expect(j.results[1]).toMatchObject({ quantity: 1000, ok: true, total: 134_990 })
    expect(j.results[2]).toMatchObject({ quantity: 7342, ok: false, code: 'QUANTITY_NOT_ALLOWED' })
  })
})

// ===========================================================================
describe('⚠️ PASİF katalog SİPARİŞ EDİLEMEZ', () => {
  it('pasifleştirilen hizmet public katalogdan düşer ve fiyatlandırılamaz', async () => {
    asAdmin()
    const service = await db.service.findFirstOrThrow({
      where: { slug: 'paylasim', platform: { slug: 'instagram' } },
      include: { variants: true },
    })
    const variantId = service.variants[0]!.id

    const off = await servicePATCH(
      patchReq(`http://localhost/api/v1/admin/services/${service.id}`, { isActive: false }),
      { params: Promise.resolve({ id: service.id }) },
    )
    expect(off.status).toBe(200)

    session.user = null
    const snap = await snapshot()
    expect(
      snap.platforms[0].services.find((s: Json) => s.slug === 'paylasim'),
      'pasif hizmet müşteriye görünüyor',
    ).toBeUndefined()

    const quote = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', { serviceVariantId: variantId, quantity: 100 }),
    )
    expect(quote.status).toBe(404)

    // Geri aç
    asAdmin()
    await servicePATCH(
      patchReq(`http://localhost/api/v1/admin/services/${service.id}`, { isActive: true }),
      { params: Promise.resolve({ id: service.id }) },
    )
    session.user = null
    const back = await snapshot()
    expect(back.platforms[0].services.find((s: Json) => s.slug === 'paylasim')).toBeTruthy()
  })

  it('pasif varyant sipariş edilemez ama GEÇMİŞ sipariş bozulmaz', async () => {
    asAdmin()
    const variant = await db.serviceVariant.findFirstOrThrow({
      where: { slug: 'standart', service: { slug: 'kaydetme' } },
    })

    // Geçmiş sipariş bu varyanta bağlı olsun
    const user = await db.user.create({ data: { email: `pasif-${Date.now()}@ornek.test` } })
    const service = await db.service.findFirstOrThrow({ where: { slug: 'kaydetme' } })
    const target = await db.target.create({
      data: {
        platformId: instagramId,
        rawInput: '@medya333',
        normalized: 'medya333',
        targetType: 'POST',
        status: 'UNVERIFIED',
        userConfirmed: true,
      },
    })
    const order = await db.order.create({
      data: {
        orderNo: `M333-PASIF${Date.now() % 1000}`,
        userId: user.id,
        platformId: instagramId,
        serviceId: service.id,
        serviceVariantId: variant.id,
        targetId: target.id,
        quantity: 100,
        pricingMode: 'PACKAGE',
        unitPriceMinor: 0,
        listSubtotalMinor: 5_000,
        totalMinor: 5_000,
        taxRateBp: 2000,
        taxAmountMinor: 833,
        subtotalMinor: 4_167,
        status: 'PENDING_PAYMENT',
      },
    })

    await variantPATCH(
      patchReq(`http://localhost/api/v1/admin/variants/${variant.id}`, { isActive: false }),
      { params: Promise.resolve({ id: variant.id }) },
    )

    session.user = null
    const quote = await quotePOST(
      makeReq('http://localhost/api/v1/pricing/quote', {
        serviceVariantId: variant.id,
        quantity: 100,
      }),
    )
    expect(quote.status).toBe(404)

    // Geçmiş sipariş yerinde ve okunabilir
    const stillThere = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { serviceVariant: true },
    })
    expect(stillThere.totalMinor).toBe(5_000)
    expect(stillThere.serviceVariant.isActive).toBe(false)

    asAdmin()
    await variantPATCH(
      patchReq(`http://localhost/api/v1/admin/variants/${variant.id}`, { isActive: true }),
      { params: Promise.resolve({ id: variant.id }) },
    )
    await db.order.delete({ where: { id: order.id } })
    await db.target.delete({ where: { id: target.id } })
    await db.user.delete({ where: { id: user.id } })
  })
})

// ===========================================================================
describe('sipariş anlık görüntüsü', () => {
  it('fiyat sonradan değişse bile eski sipariş değişmez', async () => {
    const variant = await db.serviceVariant.findFirstOrThrow({
      where: { slug: 'turk', service: { slug: 'begeni' } },
    })
    const rule = await db.pricingRule.findFirstOrThrow({
      where: { serviceVariantId: variant.id, minQuantity: 500 },
    })
    const originalPrice = rule.packagePriceMinor!

    const service = await db.service.findFirstOrThrow({ where: { slug: 'begeni' } })
    const user = await db.user.create({ data: { email: `snap-${Date.now()}@ornek.test` } })
    const target = await db.target.create({
      data: {
        platformId: instagramId,
        rawInput: 'https://instagram.com/p/abc/',
        normalized: 'abc',
        targetType: 'POST',
        status: 'UNVERIFIED',
        userConfirmed: true,
      },
    })

    const order = await db.order.create({
      data: {
        orderNo: `M333-SNAP${Date.now() % 1000}`,
        userId: user.id,
        platformId: instagramId,
        serviceId: service.id,
        serviceVariantId: variant.id,
        targetId: target.id,
        quantity: 500,
        pricingMode: 'PACKAGE',
        unitPriceMinor: 0,
        listSubtotalMinor: originalPrice,
        totalMinor: originalPrice,
        taxRateBp: 2000,
        taxAmountMinor: Math.round((originalPrice * 2000) / 12000),
        subtotalMinor: originalPrice - Math.round((originalPrice * 2000) / 12000),
        status: 'PENDING_PAYMENT',
        items: {
          create: {
            serviceVariantId: variant.id,
            targetId: target.id,
            quantity: 500,
            unitPriceMinor: 0,
            lineSubtotalMinor: originalPrice,
            lineTotalMinor: originalPrice,
            appliedPricingRuleId: rule.id,
            pricingSnapshot: { totalMinor: originalPrice, pricingMode: 'PACKAGE' },
            platformNameSnapshot: 'Instagram',
            serviceNameSnapshot: 'Beğeni',
            variantLabelSnapshot: 'Türk Beğeni',
          },
        },
      },
    })

    // Fiyat 2 katına çıksın
    await db.pricingRule.update({
      where: { id: rule.id },
      data: { packagePriceMinor: originalPrice * 2 },
    })

    const after = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    })
    expect(after.totalMinor).toBe(originalPrice)
    expect(after.items[0]!.lineTotalMinor).toBe(originalPrice)
    expect(after.items[0]!.variantLabelSnapshot).toBe('Türk Beğeni')

    await db.pricingRule.update({ where: { id: rule.id }, data: { packagePriceMinor: originalPrice } })
    await db.order.delete({ where: { id: order.id } })
    await db.target.delete({ where: { id: target.id } })
    await db.user.delete({ where: { id: user.id } })
  })
})
