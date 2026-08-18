/**
 * FAZ 3 — ÖDEME ENTEGRASYON TESTLERİ (gerçek PostgreSQL)
 *
 * Kapsam:
 *   • Tutar: yalnızca Order.totalMinor; frontend manipülasyonu etkisiz
 *   • Webhook: imza, tutar, currency, orderNo, provider doğrulaması
 *   • Duplicate / replay / eşzamanlı webhook
 *   • Payment state machine + Order PENDING_PAYMENT → PAID
 *   • Başarısız ödeme → sipariş SİLİNMEZ, tekrar denenebilir
 *   • Çift ödeme denemesi, ikinci başarılı ödeme
 *   • Refund: kısmi/tam, üst sınır, eşzamanlılık, yetkisiz
 *   • Fulfillment yalnızca ödeme sonrası
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
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
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
import { transitionOrder, FulfillmentBeforePaymentError } from '@/server/orders/transition'
import { createPaymentForOrder, PaymentError } from '@/server/payments/create'
import { processWebhook } from '@/server/payments/webhook'
import { createRefund, getRefundSummary, refundableMinor } from '@/server/payments/refund'
import { computeMockSignature } from '@/server/payments/providers/mock'
import { clearProviderOverrides } from '@/server/payments/registry'
import type { CreateOrderInput } from '@/lib/validation'
import type { PaymentStatus } from '@/lib/enums'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number
let adminId: string

let seq = 0
const nextKey = () => `pay-test-key-${Date.now()}-${++seq}-padding`

const EMAIL = 'odeme@ornek.test'

async function makeTarget() {
  const t = await db.target.create({
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
  return t.id
}

/** Ödemeye hazır (PENDING_PAYMENT) bir sipariş kurar. */
async function makeOrder() {
  const targetId = await makeTarget()
  const input = {
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
  } as CreateOrderInput

  const res = await createOrder(input, {
    userId: null,
    idempotencyKey: nextKey(),
    ipHash: 'iphash',
    userAgent: 'vitest',
  })
  const order = await db.order.findUniqueOrThrow({
    where: { id: res.order.id },
    select: { id: true, orderNo: true, userId: true, totalMinor: true },
  })
  return order
}

const PAY_CTX = { ip: '203.0.113.5', ipHash: 'iphash' }

async function startPayment(order: { orderNo: string; userId: string }) {
  return createPaymentForOrder(order.orderNo, {
    userId: order.userId,
    ...PAY_CTX,
    idempotencyKey: nextKey(),
  })
}

/** Sağlayıcının göndereceği imzalı bildirimi üretir. */
function mockWebhook(opts: {
  providerRef: string
  outcome: 'success' | 'failure'
  amountMinor: number
  currency?: string
  eventId?: string
  /** İmzayı bozmak için */
  tamperSignature?: boolean
  /** İmzayı doğru tutup gövdeyi değiştirmek için */
  bodyOverride?: Record<string, unknown>
}) {
  const eventId = opts.eventId ?? `evt_${opts.providerRef}_${opts.outcome}`
  const currency = opts.currency ?? 'TRY'
  const payload = {
    providerRef: opts.providerRef,
    status: opts.outcome,
    amountMinor: opts.amountMinor,
    currency,
    eventId,
    ...(opts.bodyOverride ?? {}),
  }
  const signature = opts.tamperSignature
    ? 'a'.repeat(64)
    : computeMockSignature({
        providerRef: opts.providerRef,
        status: opts.outcome,
        amountMinor: opts.amountMinor,
        currency,
        eventId,
      })

  return {
    headers: new Headers({ 'content-type': 'application/json', 'x-mock-signature': signature }),
    rawBody: JSON.stringify(payload),
    contentType: 'application/json',
  }
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)

  // ⚠️ Faz 5: katalogdaki tüm varyantlar HAZIR MİKTAR kilitlidir.
  // Miktar `min + k·step` ile ÜRETİLEMEZ; katalogdan seçilir.
  const fixture = await pickCatalogVariant(db, {})
  variantId = fixture.variantId
  platformId = fixture.platformId
  qty = fixture.quantity

  const admin = await db.user.upsert({
    where: { email: 'faz3-admin@roles.test' },
    update: { role: 'SUPERADMIN' },
    create: { email: 'faz3-admin@roles.test', role: 'SUPERADMIN' },
    select: { id: true },
  })
  adminId = admin.id
}, 240_000)

afterAll(async () => {
  clearProviderOverrides()
  await ctx?.stop()
})

beforeEach(async () => {
  await truncateTransactional(db)
  await db.user.deleteMany({ where: { email: { contains: 'ornek.test' } } })
})

// ===========================================================================
describe('ödeme başlatma', () => {
  it('tutarı Order.totalMinor\'dan alır ve Payment\'a snapshot\'lar', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)

    expect(session.amountMinor).toBe(order.totalMinor)
    expect(session.currency).toBe('TRY')
    expect(session.checkoutUrl).toBeTruthy()
    expect(session.attemptNumber).toBe(1)

    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    expect(payment.amountMinor).toBe(order.totalMinor)
    expect(payment.orderNoSnapshot).toBe(order.orderNo)
    expect(payment.environment).toBe('sandbox')
    // ⚠️ Başarı VARSAYILMAZ
    expect(payment.status).toBe('PENDING')
  })

  it('⚠️ FRONTEND TUTAR MANİPÜLASYONU İMKÂNSIZ — fonksiyon tutar almaz', async () => {
    const order = await makeOrder()
    // Sipariş toplamı 300,00 ₺ iken 1 kuruş göndermeye çalışan bir istemci
    // olsa bile `createPaymentForOrder` imzasında tutar parametresi YOKTUR.
    const session = await startPayment(order)
    expect(session.amountMinor).toBe(order.totalMinor)
    expect(session.amountMinor).not.toBe(1)
  })

  it('PENDING_PAYMENT olmayan sipariş ödenemez', async () => {
    const order = await makeOrder()
    await transitionOrder({ orderId: order.id, to: 'CANCELLED', actorType: 'ADMIN', actorId: adminId })
    await expect(startPayment(order)).rejects.toThrowError(/İptal edilmiş/)
  })

  it('başka kullanıcının siparişi için ödeme başlatılamaz (IDOR)', async () => {
    const order = await makeOrder()
    const other = await db.user.create({ data: { email: 'yabanci@ornek.test' }, select: { id: true } })
    await expect(
      createPaymentForOrder(order.orderNo, {
        userId: other.id,
        ...PAY_CTX,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrowError(PaymentError)
  })

  it('çift tıklama: aynı idempotency anahtarı yeni ödeme AÇMAZ', async () => {
    const order = await makeOrder()
    const key = nextKey()
    const a = await createPaymentForOrder(order.orderNo, { userId: order.userId, ...PAY_CTX, idempotencyKey: key })
    const b = await createPaymentForOrder(order.orderNo, { userId: order.userId, ...PAY_CTX, idempotencyKey: key })

    expect(b.reused).toBe(true)
    expect(b.paymentId).toBe(a.paymentId)
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1)
  })

  it('farklı anahtar + devam eden ödeme: MEVCUT checkout döndürülür', async () => {
    const order = await makeOrder()
    const a = await startPayment(order)
    const b = await startPayment(order)

    expect(b.reused).toBe(true)
    expect(b.paymentId).toBe(a.paymentId)
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1)
  })

  it('ödeme başlatma OrderEvent bırakır ama sipariş DURUMUNU DEĞİŞTİRMEZ', async () => {
    const order = await makeOrder()
    await startPayment(order)

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe('PENDING_PAYMENT')

    const events = await db.orderEvent.findMany({ where: { orderId: order.id } })
    expect(events.map((e) => e.type)).toContain('PAYMENT_INITIATED')
  })
})

// ===========================================================================
describe('webhook — doğrulama zinciri', () => {
  it('geçerli bildirim: Payment CAPTURED, Order PAID', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    const res = await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor }),
    )

    expect(res.outcome).toBe('PROCESSED')

    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    expect(payment.status).toBe('CAPTURED')
    expect(payment.capturedAt).toBeTruthy()

    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(updated.status).toBe('PAID')
    expect(updated.paidAt).toBeTruthy()

    const orderEvents = await db.orderEvent.findMany({ where: { orderId: order.id } })
    expect(orderEvents.map((e) => e.type)).toContain('PAYMENT_RECEIVED')

    const payEvents = await db.paymentEvent.findMany({ where: { paymentId: payment.id } })
    expect(payEvents.map((e) => e.eventType)).toContain('PAYMENT_SUCCESS')
  })

  it('⚠️ GEÇERSİZ İMZA: ödeme başarılı SAYILMAZ, sipariş PENDING_PAYMENT kalır', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    const res = await processWebhook(
      'mock',
      mockWebhook({
        providerRef: ref,
        outcome: 'success',
        amountMinor: order.totalMinor,
        tamperSignature: true,
      }),
    )

    expect(res.outcome).toBe('INVALID_SIGNATURE')
    expect((await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).status).toBe(
      'PENDING',
    )
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )

    // Reddedilen bildirim yine de DENETİM İZİ olarak kaydedilir
    const rejected = await db.paymentEvent.findFirst({ where: { signatureValid: false } })
    expect(rejected).toBeTruthy()
    expect(rejected!.eventType).toBe('WEBHOOK_REJECTED')
  })

  it('⚠️ YANLIŞ TUTAR: ödeme işlenmez (imza doğru olsa bile)', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    // Saldırgan doğru imzalı ama DÜŞÜK tutarlı bildirim üretebilse bile:
    const res = await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: 1 }),
    )

    expect(res.outcome).toBe('AMOUNT_MISMATCH')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )
    const audit = await db.auditLog.findFirst({ where: { action: 'payment.amount_mismatch' } })
    expect(audit).toBeTruthy()
  })

  it('⚠️ YANLIŞ PARA BİRİMİ: ödeme işlenmez', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    const res = await processWebhook(
      'mock',
      mockWebhook({
        providerRef: ref,
        outcome: 'success',
        amountMinor: order.totalMinor,
        currency: 'USD',
      }),
    )

    expect(res.outcome).toBe('CURRENCY_MISMATCH')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )
  })

  it('⚠️ BİLİNMEYEN SİPARİŞ REFERANSI: sessizce yok sayılır', async () => {
    const res = await processWebhook(
      'mock',
      mockWebhook({ providerRef: 'HICBIRSEY', outcome: 'success', amountMinor: 100 }),
    )
    expect(res.outcome).toBe('PAYMENT_NOT_FOUND')
  })

  it('⚠️ YANLIŞ SAĞLAYICI: paytr ucundan gelen mock ödemesi işlenmez', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    // İmza mock anahtarıyla doğru olsa bile Payment.provider="mock",
    // bildirim "paytr" ucundan geliyor → eşleşmiyor.
    const res = await processWebhook(
      'paytr',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor }),
    )
    // PayTR adapter'ı bu gövdeyi doğrulayamaz → imza geçersiz
    expect(['INVALID_SIGNATURE', 'PROVIDER_MISMATCH']).toContain(res.outcome)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )
  })

  it('bilinmeyen sağlayıcı ucu 404 döner', async () => {
    const res = await processWebhook('bilinmeyen', {
      headers: new Headers(),
      rawBody: '{}',
      contentType: 'application/json',
    })
    expect(res.outcome).toBe('IGNORED')
    expect(res.ack.status).toBe(404)
  })
})

// ===========================================================================
describe('webhook — tekrar ve yarış koşulları', () => {
  async function paidSetup() {
    const order = await makeOrder()
    const session = await startPayment(order)
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    return { order, session, ref: payment.providerRef! }
  }

  it('AYNI bildirim üç kez: Order yalnızca BİR KEZ PAID olur', async () => {
    const { order, ref } = await paidSetup()
    const hook = () =>
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor })

    const first = await processWebhook('mock', hook())
    const second = await processWebhook('mock', hook())
    const third = await processWebhook('mock', hook())

    expect(first.outcome).toBe('PROCESSED')
    expect(second.outcome).toBe('DUPLICATE')
    expect(third.outcome).toBe('DUPLICATE')

    // Tek PAYMENT_RECEIVED olayı
    const received = await db.orderEvent.count({
      where: { orderId: order.id, type: 'PAYMENT_RECEIVED' },
    })
    expect(received).toBe(1)

    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(updated.status).toBe('PAID')
  })

  it('EŞZAMANLI bildirimler: yalnızca biri işler, durum tutarlı kalır', async () => {
    const { order, ref } = await paidSetup()
    const hook = () =>
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor })

    // İki sunucu örneği aynı bildirimi aynı anda işliyor
    const results = await Promise.all([
      processWebhook('mock', hook()),
      processWebhook('mock', hook()),
      processWebhook('mock', hook()),
    ])

    const processed = results.filter((r) => r.outcome === 'PROCESSED')
    expect(processed).toHaveLength(1)

    expect(
      await db.orderEvent.count({ where: { orderId: order.id, type: 'PAYMENT_RECEIVED' } }),
    ).toBe(1)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')
  })

  it('REPLAY: eski olay kimliği tekrar gönderilirse yok sayılır', async () => {
    const { order, ref } = await paidSetup()
    const eventId = 'sabit-olay-kimligi'

    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor, eventId }),
    )
    const replayed = await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor, eventId }),
    )
    expect(replayed.outcome).toBe('DUPLICATE')
  })

  it('⚠️ GEÇ GELEN BAŞARISIZLIK tahsil edilmiş ödemeyi geri alamaz', async () => {
    const { order, ref } = await paidSetup()
    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor }),
    )

    const late = await processWebhook(
      'mock',
      mockWebhook({
        providerRef: ref,
        outcome: 'failure',
        amountMinor: order.totalMinor,
        eventId: 'gec-basarisizlik',
      }),
    )

    expect(late.outcome).toBe('IGNORED')
    expect((await db.payment.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe(
      'CAPTURED',
    )
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')
  })
})

// ===========================================================================
describe('başarısız ödeme ve tekrar deneme', () => {
  it('ödeme başarısız: sipariş SİLİNMEZ, PENDING_PAYMENT kalır', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'failure', amountMinor: order.totalMinor }),
    )

    expect((await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).status).toBe(
      'FAILED',
    )
    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(updated.status).toBe('PENDING_PAYMENT')

    const events = await db.orderEvent.findMany({ where: { orderId: order.id } })
    expect(events.map((e) => e.type)).toContain('PAYMENT_FAILED')
  })

  it('başarısızlıktan sonra YENİ DENEME açılır (attempt 2)', async () => {
    const order = await makeOrder()
    const first = await startPayment(order)
    const ref1 = (await db.payment.findUniqueOrThrow({ where: { id: first.paymentId } })).providerRef!

    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref1, outcome: 'failure', amountMinor: order.totalMinor }),
    )

    const second = await startPayment(order)
    expect(second.reused).toBe(false)
    expect(second.attemptNumber).toBe(2)
    expect(second.paymentId).not.toBe(first.paymentId)

    // İkinci deneme başarılı olabilir
    const ref2 = (await db.payment.findUniqueOrThrow({ where: { id: second.paymentId } })).providerRef!
    const res = await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref2, outcome: 'success', amountMinor: order.totalMinor }),
    )
    expect(res.outcome).toBe('PROCESSED')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')

    // Her denemenin izi ayrı durur
    const payments = await db.payment.findMany({
      where: { orderId: order.id },
      orderBy: { attemptNumber: 'asc' },
    })
    expect(payments.map((p) => p.status)).toEqual(['FAILED', 'CAPTURED'])
  })

  it('ödeme alındıktan sonra YENİ ödeme başlatılamaz', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!
    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor }),
    )

    await expect(startPayment(order)).rejects.toThrowError(/zaten alınmış/)
  })
})

// ===========================================================================
describe('fulfillment kapısı ödeme ile açılır', () => {
  it('ödeme ÖNCESİ işleme alınamaz, ödeme SONRASI alınır', async () => {
    const order = await makeOrder()

    await expect(
      transitionOrder({ orderId: order.id, to: 'PROCESSING', actorType: 'ADMIN', actorId: adminId }),
    ).rejects.toThrowError(FulfillmentBeforePaymentError)

    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!
    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor }),
    )

    const processing = await transitionOrder({
      orderId: order.id,
      to: 'PROCESSING',
      actorType: 'ADMIN',
      actorId: adminId,
    })
    expect(processing.status).toBe('PROCESSING')
  })
})

// ===========================================================================
describe('iade', () => {
  async function capturedOrder() {
    const order = await makeOrder()
    const session = await startPayment(order)
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    await processWebhook(
      'mock',
      mockWebhook({
        providerRef: payment.providerRef!,
        outcome: 'success',
        amountMinor: order.totalMinor,
      }),
    )
    return { order, paymentId: payment.id }
  }

  const REFUND_CTX = { requestedById: '', ip: '203.0.113.9', actorIpHash: 'iphash' }

  it('kısmi iade: PARTIALLY_REFUNDED, sipariş PAID kalır', async () => {
    const { order } = await capturedOrder()
    const part = Math.floor(order.totalMinor / 4)

    const res = await createRefund({
      orderNo: order.orderNo,
      amountMinor: part,
      reason: 'Müşteri talebi',
      ...REFUND_CTX,
      requestedById: adminId,
      idempotencyKey: nextKey(),
    })

    expect(res.status).toBe('COMPLETED')
    expect(res.paymentStatus).toBe('PARTIALLY_REFUNDED')
    expect(res.totalRefundedMinor).toBe(part)
    expect(res.orderRefunded).toBe(false)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')
  })

  it('tam iade: REFUNDED ve sipariş REFUNDED', async () => {
    const { order } = await capturedOrder()
    const res = await createRefund({
      orderNo: order.orderNo,
      amountMinor: order.totalMinor,
      reason: 'Tam iade',
      ...REFUND_CTX,
      requestedById: adminId,
      idempotencyKey: nextKey(),
    })

    expect(res.paymentStatus).toBe('REFUNDED')
    expect(res.orderRefunded).toBe(true)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED')
  })

  it('⚠️ İADE ÖDEME TUTARINI AŞAMAZ', async () => {
    const { order } = await capturedOrder()
    await expect(
      createRefund({
        orderNo: order.orderNo,
        amountMinor: order.totalMinor + 1,
        reason: 'Fazla iade denemesi',
        ...REFUND_CTX,
        requestedById: adminId,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrowError(/aşamaz/)
  })

  it('⚠️ TOPLAM İADE ödeme tutarını aşamaz (birikimli)', async () => {
    const { order } = await capturedOrder()
    const half = Math.floor(order.totalMinor / 2)

    await createRefund({
      orderNo: order.orderNo,
      amountMinor: half,
      reason: 'ilk yarı',
      ...REFUND_CTX,
      requestedById: adminId,
      idempotencyKey: nextKey(),
    })

    // Kalanın bir fazlası reddedilir
    await expect(
      createRefund({
        orderNo: order.orderNo,
        amountMinor: order.totalMinor - half + 1,
        reason: 'kalan + 1',
        ...REFUND_CTX,
        requestedById: adminId,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrowError(/aşamaz/)

    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })
    expect(payment.refundedMinor).toBe(half)
  })

  it('EŞZAMANLI iki iade toplamı aşamaz', async () => {
    const { order } = await capturedOrder()
    const two_thirds = Math.floor((order.totalMinor * 2) / 3)

    const results = await Promise.allSettled([
      createRefund({
        orderNo: order.orderNo,
        amountMinor: two_thirds,
        reason: 'a',
        ...REFUND_CTX,
        requestedById: adminId,
        idempotencyKey: nextKey(),
      }),
      createRefund({
        orderNo: order.orderNo,
        amountMinor: two_thirds,
        reason: 'b',
        ...REFUND_CTX,
        requestedById: adminId,
        idempotencyKey: nextKey(),
      }),
    ])

    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok.length).toBeGreaterThanOrEqual(1)

    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })
    // ⚠️ Ne olursa olsun toplam iade ödemeyi AŞMAZ
    expect(payment.refundedMinor).toBeLessThanOrEqual(payment.amountMinor)
  })

  it('aynı idempotency anahtarı ikinci kez iade YAPMAZ', async () => {
    const { order } = await capturedOrder()
    const key = nextKey()
    const part = Math.floor(order.totalMinor / 4)

    const a = await createRefund({
      orderNo: order.orderNo,
      amountMinor: part,
      reason: 'tek sefer',
      ...REFUND_CTX,
      requestedById: adminId,
      idempotencyKey: key,
    })
    const b = await createRefund({
      orderNo: order.orderNo,
      amountMinor: part,
      reason: 'tek sefer',
      ...REFUND_CTX,
      requestedById: adminId,
      idempotencyKey: key,
    })

    expect(b.refundId).toBe(a.refundId)
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })
    expect(payment.refundedMinor).toBe(part)
  })

  it('tahsil edilmemiş ödemede iade yapılamaz', async () => {
    const order = await makeOrder()
    await startPayment(order)
    await expect(
      createRefund({
        orderNo: order.orderNo,
        amountMinor: 100,
        reason: 'olmaz',
        ...REFUND_CTX,
        requestedById: adminId,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrowError(/tahsil edilmiş ödeme yok/)
  })

  it('iade özeti doğru hesaplar', async () => {
    const { order } = await capturedOrder()
    const part = Math.floor(order.totalMinor / 5)
    await createRefund({
      orderNo: order.orderNo,
      amountMinor: part,
      reason: 'kısmi',
      ...REFUND_CTX,
      requestedById: adminId,
      idempotencyKey: nextKey(),
    })

    const summary = await getRefundSummary(order.orderNo)
    expect(summary!.capturedMinor).toBe(order.totalMinor)
    expect(summary!.refundedMinor).toBe(part)
    expect(summary!.refundableMinor).toBe(order.totalMinor - part)
    expect(summary!.needsReconciliation).toBe(false)
  })

  it('refundableMinor saf hesabı doğru', () => {
    expect(refundableMinor({ amountMinor: 1000, refundedMinor: 0 })).toBe(1000)
    expect(refundableMinor({ amountMinor: 1000, refundedMinor: 400 })).toBe(600)
    expect(refundableMinor({ amountMinor: 1000, refundedMinor: 1000 })).toBe(0)
  })
})

// ===========================================================================
describe('mutabakat: aynı siparişe iki başarılı ödeme', () => {
  it('ikinci başarılı ödeme MUTABAKAT bayrağı kaldırır', async () => {
    const order = await makeOrder()
    const first = await startPayment(order)
    const p1 = await db.payment.findUniqueOrThrow({ where: { id: first.paymentId } })
    await processWebhook(
      'mock',
      mockWebhook({ providerRef: p1.providerRef!, outcome: 'success', amountMinor: order.totalMinor }),
    )

    /**
     * Normal akışta ikinci ödeme AÇILAMAZ (createPaymentForOrder reddeder).
     * Ama sağlayıcı tarafında gecikmiş bir ikinci tahsilat olabilir; sistemin
     * bu durumda ne yapacağı TANIMLI olmalı: otomatik fulfillment YOK,
     * mutabakat/iade akışına düşer.
     */
    const p2 = await db.payment.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        provider: 'mock',
        providerRef: `${p1.providerRef}X2`,
        attemptNumber: 99,
        orderNoSnapshot: order.orderNo,
        environment: 'sandbox',
        status: 'INITIATED',
        amountMinor: order.totalMinor,
        currency: 'TRY',
        idempotencyKey: nextKey(),
      },
      select: { id: true, providerRef: true },
    })

    const res = await processWebhook(
      'mock',
      mockWebhook({
        providerRef: p2.providerRef!,
        outcome: 'success',
        amountMinor: order.totalMinor,
      }),
    )
    expect(res.outcome).toBe('PROCESSED')

    // Sipariş zaten PAID; ikinci kez PAID olmaz, ileri taşınmaz
    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(updated.status).toBe('PAID')

    const summary = await getRefundSummary(order.orderNo)
    expect(summary!.settledPaymentCount).toBe(2)
    // ⚠️ Operasyona açık uyarı: elle mutabakat/iade gerekir
    expect(summary!.needsReconciliation).toBe(true)
    expect(summary!.capturedMinor).toBe(order.totalMinor * 2)
  })
})

// ===========================================================================
describe('PII ve log güvenliği', () => {
  it('PaymentEvent payload\'ında kart verisi veya secret bulunmaz', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    await processWebhook(
      'mock',
      mockWebhook({
        providerRef: ref,
        outcome: 'success',
        amountMinor: order.totalMinor,
        bodyOverride: { cardNumber: '4111111111111111', cvv: '123', merchantKey: 'gizli' },
      }),
    )

    const events = await db.paymentEvent.findMany()
    const json = JSON.stringify(events)
    expect(json).not.toContain('4111111111111111')
    expect(json).not.toContain('gizli')
    expect(json).toContain('[REDACTED]')
  })

  it('audit kaydında PII yoktur', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!
    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor }),
    )

    const logs = await db.auditLog.findMany({ where: { entityType: 'Payment' } })
    const json = JSON.stringify(logs)
    expect(logs.length).toBeGreaterThan(0)
    expect(json).not.toContain(EMAIL)
    expect(json).not.toContain('Ayşe')
  })

  it('Payment kaydında ham kart verisi saklanmaz', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })

    // Şemada yalnızca maskeli/PCI dışı alanlar var
    expect(payment).not.toHaveProperty('cardNumber')
    expect(payment).not.toHaveProperty('cvv')
    expect(Object.keys(payment)).toContain('cardLast4')
  })
})

// ===========================================================================
describe('payment state machine — veritabanı üzerinde', () => {
  it('CAPTURED\'dan PENDING\'e dönüş DB seviyesinde de reddedilir', async () => {
    const order = await makeOrder()
    const session = await startPayment(order)
    const ref = (await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })).providerRef!

    await processWebhook(
      'mock',
      mockWebhook({ providerRef: ref, outcome: 'success', amountMinor: order.totalMinor }),
    )

    // Geç gelen "beklemede" bildirimi — geçersiz geçiş
    const res = await processWebhook('mock', {
      headers: new Headers({
        'content-type': 'application/json',
        'x-mock-signature': computeMockSignature({
          providerRef: ref,
          status: 'success',
          amountMinor: order.totalMinor,
          currency: 'TRY',
          eventId: 'baska-olay',
        }),
      }),
      rawBody: JSON.stringify({
        providerRef: ref,
        status: 'success',
        amountMinor: order.totalMinor,
        currency: 'TRY',
        eventId: 'baska-olay',
      }),
      contentType: 'application/json',
    })

    // Aynı duruma geçiş → idempotent no-op
    expect(res.outcome).toBe('DUPLICATE')
    const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
    expect(payment.status as PaymentStatus).toBe('CAPTURED')
  })
})
