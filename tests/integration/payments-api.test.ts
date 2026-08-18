/**
 * FAZ 3 — ÖDEME API GÜVENLİK TESTLERİ (gerçek route handler'ları)
 *
 * Kapsam:
 *   • /payments/create: sahiplik, CSRF, idempotency, tutar manipülasyonu
 *   • /payments/webhooks/[provider]: auth YOK, imza VAR, ack biçimi
 *   • /payments/[orderNo]/status: yalnızca okur, sahiplik ister
 *   • admin refund: yetki, üst sınır, idempotency
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
import { setupTestDatabase, truncateTransactional, type TestDatabase } from './db-setup'
import { resetMemoryRateLimits } from '@/server/ratelimit'
import { createOrder } from '@/server/orders/create'
import { computeMockSignature } from '@/server/payments/providers/mock'
import { computeCallbackHash } from '@/server/payments/providers/paytr'
import type { CreateOrderInput } from '@/lib/validation'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number

let createPOST: (req: any) => Promise<Response>
let webhookPOST: (req: any, c: any) => Promise<Response>
let webhookGET: () => Promise<Response>
let statusGET: (req: any, c: any) => Promise<Response>
let refundPOST: (req: any, c: any) => Promise<Response>
let refundGET: (req: any, c: any) => Promise<Response>

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
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

let keySeq = 0
const key = () => `api-pay-key-${Date.now()}-${++keySeq}-padded`

async function makeOrder() {
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
      guestEmail: 'api-odeme@ornek.test',
      acceptedTerms: true,
      acceptedRefund: true,
      acceptedPrivacy: true,
    } as CreateOrderInput,
    { userId: null, idempotencyKey: key(), ipHash: 'iphash', userAgent: 'vitest' },
  )

  const order = await db.order.findUniqueOrThrow({
    where: { id: res.order.id },
    select: { id: true, orderNo: true, userId: true, totalMinor: true },
  })
  return { order, trackingToken: res.accessToken! }
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)

  const variant = await db.serviceVariant.findFirstOrThrow({
    where: {
      isActive: true,
      isVisible: true,
      minQuantity: { lte: 100 },
      maxQuantity: { gte: 1000 },
      service: { targetType: 'PROFILE', platform: { slug: 'instagram' } },
    },
    // ⚠️ Deterministik seçim: sırasız `findFirst` bazen garantili (Premium),
    // bazen garantisiz (Standart) varyantı getiriyordu ve garanti testleri
    // koşuma göre değişiyordu.
    orderBy: { slug: 'asc' },
    include: { service: true },
  })
  variantId = variant.id
  platformId = variant.service.platformId
  const step = variant.quantityStep > 0 ? variant.quantityStep : 1
  qty = variant.minQuantity
  while (qty < 100) qty += step

  for (const [email, role] of [
    ['faz3api-support@roles.test', 'SUPPORT'],
    ['faz3api-admin@roles.test', 'ADMIN'],
    ['faz3api-super@roles.test', 'SUPERADMIN'],
  ] as const) {
    await db.user.upsert({ where: { email }, update: { role }, create: { email, role } })
  }
  ;({ POST: createPOST } = await import('@/app/api/v1/payments/create/route'))
  ;({ POST: webhookPOST, GET: webhookGET } = await import(
    '@/app/api/v1/payments/webhooks/[provider]/route'
  ))
  ;({ GET: statusGET } = await import('@/app/api/v1/payments/[orderNo]/status/route'))
  ;({ POST: refundPOST, GET: refundGET } = await import(
    '@/app/api/v1/admin/orders/[orderNo]/refund/route'
  ))
}, 240_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  session.user = null
  resetMemoryRateLimits()
  await truncateTransactional(db)
  await db.user.deleteMany({ where: { email: { contains: 'ornek.test' } } })
})

function webhookCtx(provider: string) {
  return { params: Promise.resolve({ provider }) }
}

// ===========================================================================
describe('POST /api/v1/payments/create', () => {
  it('takip token\'ı ile misafir ödemeyi başlatabilir', async () => {
    const { order, trackingToken } = await makeOrder()
    const res = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        { orderNo: order.orderNo, trackingToken },
        { 'idempotency-key': key() },
      ),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.checkoutUrl).toBeTruthy()
    expect(json.amountMinor).toBe(order.totalMinor)
  })

  it('⚠️ gövdedeki amount YOK SAYILIR — tutar Order.totalMinor\'dan gelir', async () => {
    const { order, trackingToken } = await makeOrder()
    const res = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        {
          orderNo: order.orderNo,
          trackingToken,
          // Saldırgan bunları göndermeyi deneyebilir:
          amount: 1,
          amountMinor: 1,
          totalMinor: 1,
          price: '0.01',
        },
        { 'idempotency-key': key() },
      ),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.amountMinor).toBe(order.totalMinor)

    const payment = await db.payment.findUniqueOrThrow({ where: { id: json.paymentId } })
    expect(payment.amountMinor).toBe(order.totalMinor)
    expect(payment.amountMinor).not.toBe(1)
  })

  it('sahiplik kanıtı olmadan 404 (sipariş numarası tek başına yetmez)', async () => {
    const { order } = await makeOrder()
    const res = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        { orderNo: order.orderNo },
        { 'idempotency-key': key() },
      ),
    )
    expect(res.status).toBe(404)
    expect(await db.payment.count()).toBe(0)
  })

  it('yanlış takip token\'ı ile 404', async () => {
    const { order } = await makeOrder()
    const res = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        { orderNo: order.orderNo, trackingToken: 'x'.repeat(43) },
        { 'idempotency-key': key() },
      ),
    )
    expect(res.status).toBe(404)
  })

  it('Idempotency-Key olmadan 400', async () => {
    const { order, trackingToken } = await makeOrder()
    const res = await createPOST(
      makeReq('http://localhost/api/v1/payments/create', { orderNo: order.orderNo, trackingToken }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('CSRF: yabancı Origin reddedilir', async () => {
    const { order, trackingToken } = await makeOrder()
    const res = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        { orderNo: order.orderNo, trackingToken },
        { 'idempotency-key': key(), origin: 'https://kotu.example' },
      ),
    )
    expect(res.status).toBe(403)
  })

  it('bilinmeyen sağlayıcı 400', async () => {
    const { order, trackingToken } = await makeOrder()
    const res = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        { orderNo: order.orderNo, trackingToken, provider: 'stripe' },
        { 'idempotency-key': key() },
      ),
    )
    expect(res.status).toBe(400)
  })

  it('rate limit uygulanır', async () => {
    const fixed = { 'x-forwarded-for': '198.51.100.77' }
    let limited = false
    for (let i = 0; i < 14; i++) {
      const { order, trackingToken } = await makeOrder()
      const res = await createPOST(
        makeReq(
          'http://localhost/api/v1/payments/create',
          { orderNo: order.orderNo, trackingToken },
          { 'idempotency-key': key(), ...fixed },
        ),
      )
      if (res.status === 429) {
        limited = true
        break
      }
    }
    expect(limited).toBe(true)
  })
})

// ===========================================================================
describe('POST /api/v1/payments/webhooks/[provider]', () => {
  async function startedPayment() {
    const { order, trackingToken } = await makeOrder()
    const res = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        { orderNo: order.orderNo, trackingToken },
        { 'idempotency-key': key() },
      ),
    )
    const json = await res.json()
    const payment = await db.payment.findUniqueOrThrow({ where: { id: json.paymentId } })
    return { order, trackingToken, payment }
  }

  function signedMockBody(providerRef: string, amountMinor: number, outcome = 'success') {
    const eventId = `apievt_${providerRef}_${outcome}`
    const payload = { providerRef, status: outcome, amountMinor, currency: 'TRY', eventId }
    const signature = computeMockSignature({
      providerRef,
      status: outcome,
      amountMinor,
      currency: 'TRY',
      eventId,
    })
    return { body: JSON.stringify(payload), signature }
  }

  it('⚠️ OTURUM İSTEMEZ — imzalı bildirim oturumsuz işlenir', async () => {
    const { order, payment } = await startedPayment()
    const { body, signature } = signedMockBody(payment.providerRef!, order.totalMinor)

    session.user = null // açıkça oturumsuz
    const res = await webhookPOST(
      makeReq('http://localhost/api/v1/payments/webhooks/mock', body, {
        'x-mock-signature': signature,
      }),
      webhookCtx('mock'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('x-webhook-outcome')).toBe('PROCESSED')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')
  })

  it('⚠️ CSRF/Origin kontrolü UYGULANMAZ (sağlayıcı Origin göndermez)', async () => {
    const { order, payment } = await startedPayment()
    const { body, signature } = signedMockBody(payment.providerRef!, order.totalMinor)

    const res = await webhookPOST(
      makeReq('http://localhost/api/v1/payments/webhooks/mock', body, {
        'x-mock-signature': signature,
        origin: 'https://provider.example',
      }),
      webhookCtx('mock'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-webhook-outcome')).toBe('PROCESSED')
  })

  it('imzasız bildirim ödemeyi başarılı YAPMAZ', async () => {
    const { order, payment } = await startedPayment()
    const { body } = signedMockBody(payment.providerRef!, order.totalMinor)

    const res = await webhookPOST(
      makeReq('http://localhost/api/v1/payments/webhooks/mock', body),
      webhookCtx('mock'),
    )
    expect(res.headers.get('x-webhook-outcome')).toBe('INVALID_SIGNATURE')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )
  })

  it('PayTR ucu tam olarak "OK" gövdesi döner', async () => {
    // İmzasız (dolayısıyla reddedilen) bir bildirimde bile PayTR "OK" bekler.
    const rawBody = new URLSearchParams({
      merchant_oid: 'YOKBOYLE',
      status: 'success',
      total_amount: '100',
      hash: 'yanlis',
    }).toString()

    const res = await webhookPOST(
      makeReq('http://localhost/api/v1/payments/webhooks/paytr', rawBody, {
        'content-type': 'application/x-www-form-urlencoded',
      }),
      webhookCtx('paytr'),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
  })

  it('bilinmeyen sağlayıcı 404', async () => {
    const res = await webhookPOST(
      makeReq('http://localhost/api/v1/payments/webhooks/stripe', '{}'),
      webhookCtx('stripe'),
    )
    expect(res.status).toBe(404)
  })

  it('aşırı büyük gövde 413', async () => {
    const res = await webhookPOST(
      makeReq('http://localhost/api/v1/payments/webhooks/mock', 'x'.repeat(70_000)),
      webhookCtx('mock'),
    )
    expect(res.status).toBe(413)
  })

  it('GET ile sağlık yoklaması 200', async () => {
    const res = await webhookGET()
    expect(res.status).toBe(200)
  })

  it('PayTR bildirim hash sözleşmesi uçtan uca tutarlı', () => {
    // Uç, adapter'ın hesabını kullanır; burada sözleşmenin kendisi doğrulanır.
    const h = computeCallbackHash({
      merchantOid: 'OID',
      merchantSalt: 'salt',
      status: 'success',
      totalAmount: '100',
      merchantKey: 'key',
    })
    expect(h).toMatch(/^[A-Za-z0-9+/]+=*$/) // base64
  })
})

// ===========================================================================
describe('GET /api/v1/payments/[orderNo]/status', () => {
  it('takip token\'ı ile durum okunur', async () => {
    const { order, trackingToken } = await makeOrder()
    const res = await statusGET(
      makeReq(
        `http://localhost/api/v1/payments/${order.orderNo}/status?t=${encodeURIComponent(trackingToken)}`,
      ),
      { params: Promise.resolve({ orderNo: order.orderNo }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.paid).toBe(false)
    expect(json.orderStatus).toBe('PENDING_PAYMENT')
  })

  it('sahiplik kanıtı olmadan 404', async () => {
    const { order } = await makeOrder()
    const res = await statusGET(
      makeReq(`http://localhost/api/v1/payments/${order.orderNo}/status`),
      { params: Promise.resolve({ orderNo: order.orderNo }) },
    )
    expect(res.status).toBe(404)
  })

  it('⚠️ durum ucu HİÇBİR ŞEY YAZMAZ — yoklamak ödemeyi tamamlamaz', async () => {
    const { order, trackingToken } = await makeOrder()
    const before = await db.order.findUniqueOrThrow({ where: { id: order.id } })

    for (let i = 0; i < 5; i++) {
      await statusGET(
        makeReq(
          `http://localhost/api/v1/payments/${order.orderNo}/status?t=${encodeURIComponent(trackingToken)}`,
        ),
        { params: Promise.resolve({ orderNo: order.orderNo }) },
      )
    }

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe(before.status)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })
})

// ===========================================================================
describe('admin iade ucu', () => {
  async function paidOrder() {
    const { order, trackingToken } = await makeOrder()
    const created = await createPOST(
      makeReq(
        'http://localhost/api/v1/payments/create',
        { orderNo: order.orderNo, trackingToken },
        { 'idempotency-key': key() },
      ),
    )
    const json = await created.json()
    const payment = await db.payment.findUniqueOrThrow({ where: { id: json.paymentId } })

    const eventId = `refundsetup_${payment.providerRef}`
    const signature = computeMockSignature({
      providerRef: payment.providerRef!,
      status: 'success',
      amountMinor: order.totalMinor,
      currency: 'TRY',
      eventId,
    })
    await webhookPOST(
      makeReq(
        'http://localhost/api/v1/payments/webhooks/mock',
        JSON.stringify({
          providerRef: payment.providerRef,
          status: 'success',
          amountMinor: order.totalMinor,
          currency: 'TRY',
          eventId,
        }),
        { 'x-mock-signature': signature },
      ),
      webhookCtx('mock'),
    )
    return order
  }

  async function asRole(role: string) {
    const user = await db.user.findFirstOrThrow({ where: { role: role as never } })
    session.user = { id: user.id, email: user.email, name: null, role, isGuest: false }
  }

  const refundCtx = (orderNo: string) => ({ params: Promise.resolve({ orderNo }) })

  it('oturumsuz 401', async () => {
    const order = await paidOrder()
    const res = await refundPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${order.orderNo}/refund`, {
        amountMinor: 100,
        reason: 'test',
      }, { 'idempotency-key': key() }),
      refundCtx(order.orderNo),
    )
    expect(res.status).toBe(401)
  })

  it('⚠️ ADMIN yetkisi YETMEZ — iade SUPERADMIN gerektirir', async () => {
    const order = await paidOrder()
    await asRole('ADMIN')
    const res = await refundPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${order.orderNo}/refund`, {
        amountMinor: 100,
        reason: 'yetkisiz iade denemesi',
      }, { 'idempotency-key': key() }),
      refundCtx(order.orderNo),
    )
    expect(res.status).toBe(403)
    expect(await db.refund.count()).toBe(0)
  })

  it('SUPERADMIN kısmi iade yapabilir', async () => {
    const order = await paidOrder()
    await asRole('SUPERADMIN')
    const part = Math.floor(order.totalMinor / 4)

    const res = await refundPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${order.orderNo}/refund`, {
        amountMinor: part,
        reason: 'Müşteri talebi',
      }, { 'idempotency-key': key() }),
      refundCtx(order.orderNo),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('COMPLETED')
    expect(json.paymentStatus).toBe('PARTIALLY_REFUNDED')
  })

  it('⚠️ ödeme tutarını aşan iade reddedilir', async () => {
    const order = await paidOrder()
    await asRole('SUPERADMIN')

    const res = await refundPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${order.orderNo}/refund`, {
        amountMinor: order.totalMinor * 2,
        reason: 'fazla iade',
      }, { 'idempotency-key': key() }),
      refundCtx(order.orderNo),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('REFUND_EXCEEDS_PAYMENT')
  })

  it('negatif/sıfır iade reddedilir', async () => {
    const order = await paidOrder()
    await asRole('SUPERADMIN')
    for (const amountMinor of [0, -100]) {
      const res = await refundPOST(
        makeReq(`http://localhost/api/v1/admin/orders/${order.orderNo}/refund`, {
          amountMinor,
          reason: 'geçersiz',
        }, { 'idempotency-key': key() }),
        refundCtx(order.orderNo),
      )
      expect(res.status).toBe(400)
    }
  })

  it('Idempotency-Key olmadan iade yapılmaz', async () => {
    const order = await paidOrder()
    await asRole('SUPERADMIN')
    const res = await refundPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${order.orderNo}/refund`, {
        amountMinor: 100,
        reason: 'anahtarsız',
      }),
      refundCtx(order.orderNo),
    )
    expect(res.status).toBe(400)
    expect(await db.refund.count()).toBe(0)
  })

  it('SUPPORT iade özetini okuyabilir', async () => {
    const order = await paidOrder()
    await asRole('SUPPORT')
    const res = await refundGET(
      makeReq(`http://localhost/api/v1/admin/orders/${order.orderNo}/refund`),
      refundCtx(order.orderNo),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.capturedMinor).toBe(order.totalMinor)
    expect(json.refundableMinor).toBe(order.totalMinor)
  })
})
