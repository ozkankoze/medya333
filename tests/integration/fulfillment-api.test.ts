/**
 * FAZ 4 — FULFILLMENT API TESTLERİ (gerçek route handler'ları)
 *
 * Faz 4 kuralı 30'daki güvenlik listesi burada uç seviyesinde doğrulanır:
 *   • customer fulfillment değiştiremiyor / göremiyor
 *   • support status değiştiremiyor
 *   • operator başkasının işini değiştiremiyor
 *   • admin tümünü yönetebiliyor
 *   • progress yüzdesi manipüle edilemiyor
 *   • delivered quantity aşımı engelleniyor
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
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
process.env.PAYMENT_PROVIDER = 'mock'
process.env.PAYMENT_ENVIRONMENT = 'sandbox'
delete process.env.REDIS_URL

const session: { user: null | { id: string; email: string; name: null; role: string; isGuest: boolean } } =
  { user: null }

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

import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import {
  pickCatalogVariant,
  setupTestDatabase,
  truncateTransactional,
  type TestDatabase,
} from './db-setup'
import { resetMemoryRateLimits } from '@/server/ratelimit'
import { createOrder } from '@/server/orders/create'
import { createPaymentForOrder } from '@/server/payments/create'
import { processWebhook } from '@/server/payments/webhook'
import { computeMockSignature } from '@/server/payments/providers/mock'
import type { CreateOrderInput } from '@/lib/validation'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number

const ids: Record<'support' | 'op1' | 'op2' | 'admin' | 'customer', string> = {
  support: '',
  op1: '',
  op2: '',
  admin: '',
  customer: '',
}

let listGET: (req: any) => Promise<Response>
let detailGET: (req: any, c: any) => Promise<Response>
let assignPOST: (req: any, c: any) => Promise<Response>
let startPOST: (req: any, c: any) => Promise<Response>
let progressPOST: (req: any, c: any) => Promise<Response>
let completePOST: (req: any, c: any) => Promise<Response>
let failPOST: (req: any, c: any) => Promise<Response>
let notePOST: (req: any, c: any) => Promise<Response>
let replacementPOST: (req: any, c: any) => Promise<Response>

let ipSeq = 0
function makeReq(url: string, body?: unknown) {
  ipSeq++
  const { NextRequest } = require('next/server')
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.44.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const c = (id: string) => ({ params: Promise.resolve({ id }) })

let seq = 0
const nextKey = () => `fapi-key-${Date.now()}-${++seq}-padding`

function asRole(role: keyof typeof ids, level: string) {
  session.user = {
    id: ids[role],
    email: `faz4api-${role}@roles.test`,
    name: null,
    role: level,
    isGuest: false,
  }
}

async function paidFulfillment() {
  const target = await db.target.create({
    data: {
      platformId,
      targetType: 'PROFILE',
      rawInput: '@medya333',
      normalized: 'medya333',
      canonicalUrl: 'https://instagram.com/medya333',
      status: 'UNVERIFIED',
      verifyMethod: 'format_only',
      handle: 'medya333',
    },
    select: { id: true },
  })

  const res = await createOrder(
    {
      serviceVariantId: variantId,
      quantity: qty,
      targetId: target.id,
      targetConfirmed: true,
      customerFirstName: 'Mehmet',
      customerLastName: 'Demir',
      guestEmail: 'fapi@ornek.test',
      acceptedTerms: true,
      acceptedRefund: true,
      acceptedPrivacy: true,
    } as CreateOrderInput,
    { userId: null, idempotencyKey: nextKey(), ipHash: 'iphash', userAgent: 'vitest' },
  )

  const order = await db.order.findUniqueOrThrow({
    where: { id: res.order.id },
    select: { id: true, orderNo: true, userId: true, totalMinor: true },
  })

  const pay = await createPaymentForOrder(order.orderNo, {
    userId: order.userId,
    ip: '203.0.113.5',
    ipHash: 'iphash',
    idempotencyKey: nextKey(),
  })
  const payment = await db.payment.findUniqueOrThrow({ where: { id: pay.paymentId } })
  const eventId = `fapi_${payment.providerRef}`
  await processWebhook('mock', {
    headers: new Headers({
      'content-type': 'application/json',
      'x-mock-signature': computeMockSignature({
        providerRef: payment.providerRef!,
        status: 'success',
        amountMinor: order.totalMinor,
        currency: 'TRY',
        eventId,
      }),
    }),
    rawBody: JSON.stringify({
      providerRef: payment.providerRef,
      status: 'success',
      amountMinor: order.totalMinor,
      currency: 'TRY',
      eventId,
    }),
    contentType: 'application/json',
  })

  const f = await db.fulfillment.findUniqueOrThrow({ where: { orderId: order.id } })
  return { order, fulfillmentId: f.id }
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)

  // ⚠️ Faz 5: katalogdaki tüm varyantlar HAZIR MİKTAR kilitlidir.
  // Miktar `min + k·step` ile ÜRETİLEMEZ; katalogdan seçilir.
  const fixture = await pickCatalogVariant(db, { atLeast: 1000 })
  variantId = fixture.variantId
  platformId = fixture.platformId
  qty = fixture.quantity

  for (const [key, role] of [
    ['support', 'SUPPORT'],
    ['op1', 'OPERATOR'],
    ['op2', 'OPERATOR'],
    ['admin', 'ADMIN'],
    ['customer', 'CUSTOMER'],
  ] as const) {
    const u = await db.user.upsert({
      where: { email: `faz4api-${key}@roles.test` },
      update: { role },
      create: { email: `faz4api-${key}@roles.test`, role },
      select: { id: true },
    })
    ids[key] = u.id
  }
  ;({ GET: listGET } = await import('@/app/api/v1/admin/fulfillments/route'))
  ;({ GET: detailGET } = await import('@/app/api/v1/admin/fulfillments/[id]/route'))
  ;({ POST: assignPOST } = await import('@/app/api/v1/admin/fulfillments/[id]/assign/route'))
  ;({ POST: startPOST } = await import('@/app/api/v1/admin/fulfillments/[id]/start/route'))
  ;({ POST: progressPOST } = await import('@/app/api/v1/admin/fulfillments/[id]/progress/route'))
  ;({ POST: completePOST } = await import('@/app/api/v1/admin/fulfillments/[id]/complete/route'))
  ;({ POST: failPOST } = await import('@/app/api/v1/admin/fulfillments/[id]/fail/route'))
  ;({ POST: notePOST } = await import('@/app/api/v1/admin/fulfillments/[id]/note/route'))
  ;({ POST: replacementPOST } = await import(
    '@/app/api/v1/admin/fulfillments/[id]/replacement/route'
  ))
}, 240_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  session.user = null
  resetMemoryRateLimits()
  await truncateTransactional(db)
  await db.fulfillment.deleteMany({})
  await db.user.deleteMany({ where: { email: { contains: 'ornek.test' } } })
})

// ===========================================================================
describe('⚠️ MÜŞTERİ fulfillment API\'sine ERİŞEMEZ', () => {
  it('oturumsuz 401', async () => {
    const res = await listGET(makeReq('http://localhost/api/v1/admin/fulfillments'))
    expect(res.status).toBe(401)
  })

  it('CUSTOMER kuyruk göremez', async () => {
    asRole('customer', 'CUSTOMER')
    const res = await listGET(makeReq('http://localhost/api/v1/admin/fulfillments'))
    expect(res.status).toBe(403)
  })

  it('⚠️ CUSTOMER fulfillment DEĞİŞTİREMEZ', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('customer', 'CUSTOMER')

    for (const [fn, body] of [
      [startPOST, {}],
      [progressPOST, { deliveredQuantity: 10 }],
      [completePOST, {}],
      [failPOST, { reason: 'test' }],
      [assignPOST, { userId: ids.customer }],
    ] as const) {
      const res = await fn(
        makeReq(`http://localhost/api/v1/admin/fulfillments/${fulfillmentId}/x`, body),
        c(fulfillmentId),
      )
      expect(res.status).toBe(403)
    }

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.status).toBe('READY')
  })
})

// ===========================================================================
describe('⚠️ SUPPORT okur, DEĞİŞTİREMEZ', () => {
  it('kuyruk ve detayı görebilir', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('support', 'SUPPORT')

    expect((await listGET(makeReq('http://localhost/api/v1/admin/fulfillments'))).status).toBe(200)
    expect(
      (await detailGET(makeReq(`http://localhost/api/v1/admin/fulfillments/${fulfillmentId}`), c(fulfillmentId)))
        .status,
    ).toBe(200)
  })

  it('⚠️ durum/ilerleme DEĞİŞTİREMEZ', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('support', 'SUPPORT')

    for (const [fn, body] of [
      [startPOST, {}],
      [progressPOST, { deliveredQuantity: 10 }],
      [completePOST, {}],
      [failPOST, { reason: 'test' }],
    ] as const) {
      const res = await fn(makeReq('http://localhost/x', body), c(fulfillmentId))
      expect(res.status).toBe(403)
    }

    expect((await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })).status).toBe(
      'READY',
    )
  })

  it('müşteriye görünür not EKLEYEBİLİR', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('support', 'SUPPORT')

    const res = await notePOST(
      makeReq('http://localhost/x', { note: 'Ekibimiz ilgileniyor.', customerVisible: true }),
      c(fulfillmentId),
    )
    expect(res.status).toBe(200)
  })

  it('iç not EKLEYEMEZ', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('support', 'SUPPORT')

    const res = await notePOST(
      makeReq('http://localhost/x', { note: 'iç', customerVisible: false }),
      c(fulfillmentId),
    )
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
describe('⚠️ OPERATOR atama sınırları', () => {
  it('başkasının işini DEĞİŞTİREMEZ', async () => {
    const { fulfillmentId } = await paidFulfillment()

    asRole('admin', 'ADMIN')
    await assignPOST(makeReq('http://localhost/x', { userId: ids.op1 }), c(fulfillmentId))

    asRole('op2', 'OPERATOR')
    const res = await startPOST(makeReq('http://localhost/x', { initialMetric: 100 }), c(fulfillmentId))
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FULFILLMENT_FORBIDDEN')
  })

  it('atanmamış işi kendine alıp başlatabilir', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('op1', 'OPERATOR')

    const assign = await assignPOST(makeReq('http://localhost/x', { userId: ids.op1 }), c(fulfillmentId))
    expect(assign.status).toBe(200)

    const start = await startPOST(makeReq('http://localhost/x', { initialMetric: 2340 }), c(fulfillmentId))
    expect(start.status).toBe(200)
    expect((await start.json()).status).toBe('STARTED')
  })

  it('başka operatöre atama YAPAMAZ', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('op1', 'OPERATOR')
    const res = await assignPOST(makeReq('http://localhost/x', { userId: ids.op2 }), c(fulfillmentId))
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
describe('ADMIN tüm işleri yönetir', () => {
  it('atama, başlatma, ilerleme, tamamlama zinciri', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('admin', 'ADMIN')

    await assignPOST(makeReq('http://localhost/x', { userId: ids.op1 }), c(fulfillmentId))
    await startPOST(makeReq('http://localhost/x', { initialMetric: 2340 }), c(fulfillmentId))

    const prog = await progressPOST(
      makeReq('http://localhost/x', { currentMetric: 2340 + qty }),
      c(fulfillmentId),
    )
    expect(prog.status).toBe(200)
    const pj = await prog.json()
    expect(pj.delivered).toBe(qty)
    expect(pj.percent).toBe(100)

    // ⚠️ HÂLÂ tamamlanmadı
    expect((await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })).status).not.toBe(
      'COMPLETED',
    )

    const done = await completePOST(makeReq('http://localhost/x', {}), c(fulfillmentId))
    expect(done.status).toBe(200)
    expect((await done.json()).status).toBe('COMPLETED')
  })
})

// ===========================================================================
describe('⚠️ İLERLEME MANİPÜLASYONU', () => {
  async function started() {
    const { fulfillmentId } = await paidFulfillment()
    asRole('admin', 'ADMIN')
    await assignPOST(makeReq('http://localhost/x', { userId: ids.op1 }), c(fulfillmentId))
    await startPOST(makeReq('http://localhost/x', { initialMetric: 2340 }), c(fulfillmentId))
    return fulfillmentId
  }

  it('⚠️ gövdedeki percent/remaining YOK SAYILIR', async () => {
    const fulfillmentId = await started()

    const res = await progressPOST(
      makeReq('http://localhost/x', {
        deliveredQuantity: 250,
        // Saldırgan bunları göndermeyi deneyebilir:
        percent: 100,
        remaining: 0,
        progress: 100,
      }),
      c(fulfillmentId),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.delivered).toBe(250)
    expect(j.percent).toBe(Math.round((250 / qty) * 100))
    expect(j.remaining).toBe(qty - 250)
    expect(j.percent).not.toBe(100)
  })

  it('⚠️ TESLİM AŞIMI engellenir', async () => {
    const fulfillmentId = await started()

    const res = await progressPOST(
      makeReq('http://localhost/x', { deliveredQuantity: qty * 10 }),
      c(fulfillmentId),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.delivered).toBe(qty)
    expect(j.remaining).toBe(0)

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.deliveredQuantity).toBe(qty)
  })

  it('negatif teslim reddedilir (şema)', async () => {
    const fulfillmentId = await started()
    const res = await progressPOST(
      makeReq('http://localhost/x', { deliveredQuantity: -100 }),
      c(fulfillmentId),
    )
    expect(res.status).toBe(400)
  })

  it('boş gövde reddedilir', async () => {
    const fulfillmentId = await started()
    const res = await progressPOST(makeReq('http://localhost/x', {}), c(fulfillmentId))
    expect(res.status).toBe(400)
  })

  it('⚠️ EŞZAMANLI ilerleme yarış yaratmaz', async () => {
    const fulfillmentId = await started()

    await Promise.all([
      progressPOST(makeReq('http://localhost/x', { currentMetric: 2500 }), c(fulfillmentId)),
      progressPOST(makeReq('http://localhost/x', { currentMetric: 2600 }), c(fulfillmentId)),
      progressPOST(makeReq('http://localhost/x', { currentMetric: 2700 }), c(fulfillmentId)),
    ])

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.deliveredQuantity).toBeLessThanOrEqual(f.requestedQuantity)
  })
})

// ===========================================================================
describe('kuyruk ucu', () => {
  it('⚠️ ödenmemiş sipariş kuyruğa DÜŞMEZ', async () => {
    // Ödenmemiş sipariş oluştur
    const target = await db.target.create({
      data: {
        platformId,
        targetType: 'PROFILE',
        rawInput: '@x',
        normalized: 'x',
        canonicalUrl: 'https://instagram.com/x',
        status: 'UNVERIFIED',
        verifyMethod: 'format_only',
        handle: 'x',
      },
      select: { id: true },
    })
    await createOrder(
      {
        serviceVariantId: variantId,
        quantity: qty,
        targetId: target.id,
        targetConfirmed: true,
        customerFirstName: 'A',
        customerLastName: 'B',
        guestEmail: 'odenmemis@ornek.test',
        acceptedTerms: true,
        acceptedRefund: true,
        acceptedPrivacy: true,
      } as CreateOrderInput,
      { userId: null, idempotencyKey: nextKey(), ipHash: 'h', userAgent: 'v' },
    )

    const { order } = await paidFulfillment()
    asRole('admin', 'ADMIN')

    const res = await listGET(makeReq('http://localhost/api/v1/admin/fulfillments?bucket=all'))
    const j = await res.json()
    expect(j.items).toHaveLength(1)
    expect(j.items[0].orderNo).toBe(order.orderNo)
    expect(j.counts.new).toBe(1)
  })

  it('kova filtresi ve sayılar', async () => {
    await paidFulfillment()
    asRole('admin', 'ADMIN')

    const res = await listGET(makeReq('http://localhost/api/v1/admin/fulfillments?bucket=new'))
    const j = await res.json()
    expect(j.bucket).toBe('new')
    expect(j.items).toHaveLength(1)
    expect(j.items[0].status).toBe('READY')
  })

  it('olmayan fulfillment 404', async () => {
    asRole('admin', 'ADMIN')
    const res = await detailGET(makeReq('http://localhost/x'), c('yokboyle'))
    expect(res.status).toBe(404)
  })
})

// ===========================================================================
describe('telafi ucu', () => {
  it('garanti yoksa telafi açılamaz', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('admin', 'ADMIN')
    // Seçilen varyantın refillDays'i olabilir; bu test AÇIKÇA garantisiz durumu sınar.
    await db.fulfillment.update({ where: { id: fulfillmentId }, data: { guaranteeDays: null } })
    await assignPOST(makeReq('http://localhost/x', { userId: ids.op1 }), c(fulfillmentId))
    await startPOST(makeReq('http://localhost/x', { initialMetric: 2340 }), c(fulfillmentId))
    await progressPOST(makeReq('http://localhost/x', { currentMetric: 2340 + qty }), c(fulfillmentId))
    await completePOST(makeReq('http://localhost/x', {}), c(fulfillmentId))

    const res = await replacementPOST(
      makeReq('http://localhost/x', { reason: 'düşüş', replacementQuantity: 10 }),
      c(fulfillmentId),
    )
    expect(res.status).toBe(409)
  })

  it('garanti varken telafi açılır ve onay ADMIN ister', async () => {
    const { fulfillmentId } = await paidFulfillment()
    asRole('admin', 'ADMIN')
    await assignPOST(makeReq('http://localhost/x', { userId: ids.op1 }), c(fulfillmentId))
    await db.fulfillment.update({ where: { id: fulfillmentId }, data: { guaranteeDays: 30 } })
    await startPOST(makeReq('http://localhost/x', { initialMetric: 2340 }), c(fulfillmentId))
    await progressPOST(makeReq('http://localhost/x', { currentMetric: 2340 + qty }), c(fulfillmentId))
    await completePOST(makeReq('http://localhost/x', {}), c(fulfillmentId))

    const create = await replacementPOST(
      makeReq('http://localhost/x', { reason: 'takipçi düşüşü', replacementQuantity: 100 }),
      c(fulfillmentId),
    )
    expect(create.status).toBe(200)
    const rc = await create.json()
    expect(rc.status).toBe('DROP_DETECTED')

    // OPERATOR incelemeye alabilir
    asRole('op1', 'OPERATOR')
    const review = await replacementPOST(
      makeReq('http://localhost/x', { replacementId: rc.id, status: 'REVIEW_REQUIRED' }),
      c(fulfillmentId),
    )
    expect(review.status).toBe(200)

    // ⚠️ ama ONAYLAYAMAZ
    const denied = await replacementPOST(
      makeReq('http://localhost/x', { replacementId: rc.id, status: 'APPROVED' }),
      c(fulfillmentId),
    )
    expect(denied.status).toBe(403)

    asRole('admin', 'ADMIN')
    const approved = await replacementPOST(
      makeReq('http://localhost/x', { replacementId: rc.id, status: 'APPROVED' }),
      c(fulfillmentId),
    )
    expect(approved.status).toBe(200)
  })
})
