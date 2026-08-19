/**
 * ⭐ ÜRETİM ZİNCİRİ DENETİMİ (Faz 7)
 *
 * Brief §4 ve §20'deki tam zinciri TEK testte, gerçek servislerle doğrular:
 *
 *   ORDER → PAYMENT → VERIFIED WEBHOOK → CAPTURED → PAID → ORDER_CONFIRMED
 *   → FULFILLMENT READY → (MANUEL) PROCESSING → STARTED → PARTIAL → COMPLETED
 *
 * Ayrıca üretimde en pahalı iki hata sınıfını kilitler:
 *   • ödeme alınmadan fulfillment oluşması
 *   • aynı webhook'un birden çok kez işlenmesi
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://medya333:medya333@127.0.0.1:5432/medya333_test?schema=public'
process.env.DATABASE_URL = TEST_DB
process.env.DEFAULT_TAX_RATE_BP = '2000'
process.env.IP_HASH_SALT = 'test-salt-test-salt-test'
process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.ORDER_TOKEN_SECRET = 'test-token-secret-test-token-secret-0123'
process.env.PAYMENT_PROVIDER = 'mock'
process.env.PAYMENT_ENVIRONMENT = 'sandbox'
delete process.env.REDIS_URL

import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import {
  pickCatalogVariant,
  setupTestDatabase,
  truncateTransactional,
  type TestDatabase,
} from './db-setup'
import { createOrder } from '@/server/orders/create'
import { createPaymentForOrder } from '@/server/payments/create'
import { processWebhook } from '@/server/payments/webhook'
import { computeMockSignature } from '@/server/payments/providers/mock'
import { ensureFulfillmentForPaidOrder } from '@/server/fulfillment/create'
import {
  assignFulfillment,
  completeFulfillment,
  startFulfillment,
  updateProgress,
} from '@/server/fulfillment/operate'
import { lookupOrderByEmail } from '@/server/orders/lookup'
import type { CreateOrderInput } from '@/lib/validation'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number
let operatorId: string
let adminId: string

let seq = 0
const nextKey = () => `prod-chain-${Date.now()}-${++seq}-padding`
const EMAIL = 'production@ornek.test'

const ADMIN = () => ({ userId: adminId, role: 'ADMIN' as const })
const OP = () => ({ userId: operatorId, role: 'OPERATOR' as const })

async function makeTarget() {
  const t = await db.target.create({
    data: {
      platformId,
      rawInput: '@medya333',
      normalized: 'medya333',
      targetType: 'PROFILE',
      status: 'UNVERIFIED',
      userConfirmed: true,
      canonicalUrl: 'https://www.instagram.com/medya333/',
    },
  })
  return t.id
}

async function makeOrder() {
  const targetId = await makeTarget()
  const res = await createOrder(
    {
      serviceVariantId: variantId,
      quantity: qty,
      targetId,
      targetConfirmed: true,
      customerFirstName: 'Ayşe',
      customerLastName: 'Yılmaz',
      guestEmail: EMAIL,
      acceptedTerms: true,
      acceptedRefund: true,
      acceptedPrivacy: true,
    } as CreateOrderInput,
    { userId: null, idempotencyKey: nextKey(), ipHash: 'iphash', userAgent: 'vitest' },
  )
  return db.order.findUniqueOrThrow({
    where: { id: res.order.id },
    select: { id: true, orderNo: true, userId: true, totalMinor: true, quantity: true },
  })
}

/** İmzalı bildirim gövdesi üretir — aynı `eventId` ile tekrar gönderilebilir. */
function signedWebhook(providerRef: string, amountMinor: number, eventId: string) {
  const payload = { providerRef, status: 'success', amountMinor, currency: 'TRY', eventId }
  return {
    headers: new Headers({
      'content-type': 'application/json',
      'x-mock-signature': computeMockSignature({
        providerRef,
        status: 'success',
        amountMinor,
        currency: 'TRY',
        eventId,
      }),
    }),
    rawBody: JSON.stringify(payload),
    contentType: 'application/json',
  }
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)

  const fixture = await pickCatalogVariant(db, { atLeast: 1000 })
  variantId = fixture.variantId
  platformId = fixture.platformId
  qty = fixture.quantity

  const op = await db.user.upsert({
    where: { email: 'faz7-op@roles.test' },
    update: { role: 'OPERATOR' },
    create: { email: 'faz7-op@roles.test', role: 'OPERATOR' },
  })
  const admin = await db.user.upsert({
    where: { email: 'faz7-admin@roles.test' },
    update: { role: 'ADMIN' },
    create: { email: 'faz7-admin@roles.test', role: 'ADMIN' },
  })
  operatorId = op.id
  adminId = admin.id
}, 240_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  await truncateTransactional(db)
})

// ===========================================================================
describe('⭐ uçtan uca üretim zinciri', () => {
  it('sipariş → ödeme → doğrulanmış webhook → PAID → READY → manuel tamamlama', async () => {
    // --- 1. Sipariş: ödeme beklenir, fulfillment YOK -------------------------
    const order = await makeOrder()
    expect(order.totalMinor).toBeGreaterThan(0)

    const created = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(created.status).toBe('PENDING_PAYMENT')
    expect(await db.fulfillment.findUnique({ where: { orderId: order.id } })).toBeNull()

    // --- 2. Ödeme başlatma ---------------------------------------------------
    const session = await createPaymentForOrder(order.orderNo, {
      userId: order.userId,
      ip: '203.0.113.5',
      ipHash: 'iphash',
      idempotencyKey: nextKey(),
    })
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    expect(payment.status).toBe('PENDING')
    // ⚠️ Tutarın tek kaynağı Order.totalMinor
    expect(payment.amountMinor).toBe(order.totalMinor)
    // ⚠️ Ödeme BAŞLATMAK fulfillment açmaz
    expect(await db.fulfillment.findUnique({ where: { orderId: order.id } })).toBeNull()

    // --- 3. Doğrulanmış webhook ---------------------------------------------
    const res = await processWebhook(
      'mock',
      signedWebhook(payment.providerRef!, order.totalMinor, `evt-${payment.providerRef}`),
    )
    expect(res.outcome).toBe('PROCESSED')

    // --- 4. CAPTURED → PAID → ORDER_CONFIRMED → READY ------------------------
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'CAPTURED',
    )
    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(paid.status).toBe('PAID')
    expect(
      await db.orderEvent.count({ where: { orderId: order.id, type: 'ORDER_CONFIRMED' } }),
    ).toBe(1)

    const fulfillment = await db.fulfillment.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(fulfillment.status).toBe('READY')
    expect(fulfillment.deliveredQuantity).toBe(0)
    // ⚠️ Otomasyon BURADA biter — sistem işi başlatmadı
    expect(fulfillment.startedAt).toBeNull()

    // Açılış olayı SİSTEM tarafından yapıldı (actorUserId null)
    const createdEvent = await db.fulfillmentEvent.findFirstOrThrow({
      where: { fulfillmentId: fulfillment.id, type: 'CREATED' },
    })
    expect(createdEvent.actorUserId).toBeNull()

    // --- 5. MANUEL operasyon -------------------------------------------------
    await assignFulfillment(fulfillment.id, operatorId, ADMIN())
    await startFulfillment({ fulfillmentId: fulfillment.id, initialMetric: 2340 }, OP())
    expect((await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillment.id } })).status).toBe(
      'STARTED',
    )

    // Kısmi teslim
    await updateProgress({ fulfillmentId: fulfillment.id, currentMetric: 2340 + qty / 2 }, OP())
    const partial = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillment.id } })
    expect(partial.status).toBe('PARTIAL')
    expect(partial.deliveredQuantity).toBe(qty / 2)

    // ⚠️ %100 teslim OTOMATİK TAMAMLAMAZ
    await updateProgress({ fulfillmentId: fulfillment.id, currentMetric: 2340 + qty }, OP())
    const full = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillment.id } })
    expect(full.deliveredQuantity).toBe(qty)
    expect(full.status).not.toBe('COMPLETED')

    // İnsan tamamlar
    await completeFulfillment(fulfillment.id, OP())
    const done = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillment.id } })
    expect(done.status).toBe('COMPLETED')
    expect(done.completedAt).not.toBeNull()

    // --- 6. Müşteri görünümü: güvenli dil + garanti --------------------------
    const view = await lookupOrderByEmail(order.orderNo, EMAIL)
    expect(view.fulfillment?.label).toBe('Tamamlandı')
    expect(view.fulfillment?.percent).toBe(100)
    expect(view.fulfillment?.guaranteeDays).toBe(365)
    expect(view.fulfillment?.guaranteeEndsAt).toBeTruthy()

    // ⚠️ İç bilgi SIZMAZ
    const raw = JSON.stringify(view)
    for (const leak of [operatorId, adminId, 'READY', 'PROCESSING', 'mock', 'iphash']) {
      expect(raw, `müşteri görünümünde sızıntı: ${leak}`).not.toContain(leak)
    }
  })
})

// ===========================================================================
describe('⭐ webhook dayanıklılığı', () => {
  it('AYNI webhook 10 kez gelirse 1 kez işlenir', async () => {
    const order = await makeOrder()
    const session = await createPaymentForOrder(order.orderNo, {
      userId: order.userId,
      ip: '203.0.113.5',
      ipHash: 'iphash',
      idempotencyKey: nextKey(),
    })
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    const eventId = `evt-repeat-${payment.providerRef}`

    const outcomes: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = await processWebhook(
        'mock',
        signedWebhook(payment.providerRef!, order.totalMinor, eventId),
      )
      outcomes.push(r.outcome)
    }

    expect(outcomes.filter((o) => o === 'PROCESSED')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'DUPLICATE')).toHaveLength(9)

    // Tek PaymentEvent, tek PAID olayı, tek fulfillment
    expect(
      await db.paymentEvent.count({ where: { paymentId: payment.id, providerEventId: eventId } }),
    ).toBe(1)
    expect(
      await db.orderEvent.count({ where: { orderId: order.id, type: 'PAYMENT_RECEIVED' } }),
    ).toBe(1)
    expect(await db.fulfillment.count({ where: { orderId: order.id } })).toBe(1)
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'CAPTURED',
    )
  })

  it('EŞZAMANLI 10 webhook: yine tek fulfillment, tek PAID', async () => {
    const order = await makeOrder()
    const session = await createPaymentForOrder(order.orderNo, {
      userId: order.userId,
      ip: '203.0.113.5',
      ipHash: 'iphash',
      idempotencyKey: nextKey(),
    })
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    const eventId = `evt-race-${payment.providerRef}`

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        processWebhook('mock', signedWebhook(payment.providerRef!, order.totalMinor, eventId)),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok.length).toBeGreaterThan(0)

    expect(await db.fulfillment.count({ where: { orderId: order.id } })).toBe(1)
    expect(
      await db.orderEvent.count({ where: { orderId: order.id, type: 'PAYMENT_RECEIVED' } }),
    ).toBe(1)
    expect(
      await db.paymentEvent.count({ where: { paymentId: payment.id, providerEventId: eventId } }),
    ).toBe(1)
  })

  it('⚠️ ÖDEME OLMADAN fulfillment açılamaz', async () => {
    const order = await makeOrder()
    // Doğrudan servis çağrısı bile ödenmemiş siparişte kayıt AÇMAZ
    const result = await ensureFulfillmentForPaidOrder(order.id)
    expect(result).toBeNull()
    expect(await db.fulfillment.count({ where: { orderId: order.id } })).toBe(0)
  })

  it('⚠️ İMZASIZ bildirim hiçbir şey değiştirmez', async () => {
    const order = await makeOrder()
    const session = await createPaymentForOrder(order.orderNo, {
      userId: order.userId,
      ip: '203.0.113.5',
      ipHash: 'iphash',
      idempotencyKey: nextKey(),
    })
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })

    const res = await processWebhook('mock', {
      headers: new Headers({ 'content-type': 'application/json' }),
      rawBody: JSON.stringify({
        providerRef: payment.providerRef,
        status: 'success',
        amountMinor: order.totalMinor,
        currency: 'TRY',
        eventId: 'forged',
      }),
      contentType: 'application/json',
    })

    expect(res.outcome).not.toBe('PROCESSED')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )
    expect(await db.fulfillment.count({ where: { orderId: order.id } })).toBe(0)
  })

  it('⚠️ TUTARI DEĞİŞTİRİLMİŞ bildirim reddedilir', async () => {
    const order = await makeOrder()
    const session = await createPaymentForOrder(order.orderNo, {
      userId: order.userId,
      ip: '203.0.113.5',
      ipHash: 'iphash',
      idempotencyKey: nextKey(),
    })
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })

    const res = await processWebhook(
      'mock',
      // İmza tutarlı ama tutar siparişten FARKLI
      signedWebhook(payment.providerRef!, 1, `evt-amount-${payment.providerRef}`),
    )
    expect(res.outcome).not.toBe('PROCESSED')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )
  })
})
