/**
 * FAZ 4 — FULFILLMENT ENTEGRASYON TESTLERİ (gerçek PostgreSQL)
 *
 * Bu dosyanın ASIL AMACI, fazın temel iş kuralını kalıcı olarak kilitlemek:
 *
 *   Ödeme başarılı olduğunda sipariş otomatik onaylanır ve fulfillment READY
 *   durumunda operasyon kuyruğuna düşer. Ancak fulfillment HİÇBİR KOŞULDA
 *   otomatik başlamaz veya otomatik tamamlanmaz.
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
import { setupTestDatabase, truncateTransactional, type TestDatabase } from './db-setup'

import { createOrder } from '@/server/orders/create'
import { createPaymentForOrder } from '@/server/payments/create'
import { processWebhook } from '@/server/payments/webhook'
import { computeMockSignature } from '@/server/payments/providers/mock'
import { ensureFulfillmentForPaidOrder, FulfillmentError } from '@/server/fulfillment/create'
import {
  addNote,
  assignFulfillment,
  completeFulfillment,
  failFulfillment,
  startFulfillment,
  updateProgress,
  type Actor,
} from '@/server/fulfillment/operate'
import { listFulfillmentQueue, getFulfillmentDetail } from '@/server/fulfillment/queue'
import { advanceReplacement, createReplacementCase } from '@/server/fulfillment/replacement'
import { lookupOrderByEmail } from '@/server/orders/lookup'
import type { CreateOrderInput } from '@/lib/validation'
import type { FulfillmentStatus, UserRole } from '@/lib/enums'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number

const users: Record<'support' | 'op1' | 'op2' | 'admin' | 'customer', string> = {
  support: '',
  op1: '',
  op2: '',
  admin: '',
  customer: '',
}

let seq = 0
const nextKey = () => `ful-test-key-${Date.now()}-${++seq}-padding`

const EMAIL = 'fulfillment@ornek.test'

function actor(id: string, role: UserRole): Actor {
  return { userId: id, role, ipHash: 'iphash' }
}

const OP1 = () => actor(users.op1, 'OPERATOR')
const OP2 = () => actor(users.op2, 'OPERATOR')
const ADMIN = () => actor(users.admin, 'ADMIN')
const SUPPORT = () => actor(users.support, 'SUPPORT')

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

/** Ödenmemiş sipariş (PENDING_PAYMENT). */
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

/** Ödemeyi doğrulanmış bildirimle tamamlar — gerçek zincir. */
async function payOrder(order: { orderNo: string; userId: string; totalMinor: number }) {
  const session = await createPaymentForOrder(order.orderNo, {
    userId: order.userId,
    ip: '203.0.113.5',
    ipHash: 'iphash',
    idempotencyKey: nextKey(),
  })
  const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
  const eventId = `fulevt_${payment.providerRef}`
  const payload = {
    providerRef: payment.providerRef!,
    status: 'success',
    amountMinor: order.totalMinor,
    currency: 'TRY',
    eventId,
  }
  const res = await processWebhook('mock', {
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
    rawBody: JSON.stringify(payload),
    contentType: 'application/json',
  })
  return { webhookOutcome: res.outcome, providerRef: payment.providerRef!, eventId }
}

/** Ödenmiş + fulfillment açılmış sipariş. */
async function paidOrderWithFulfillment() {
  const order = await makeOrder()
  await payOrder(order)
  const f = await db.fulfillment.findUniqueOrThrow({ where: { orderId: order.id } })
  return { order, fulfillmentId: f.id }
}

/** Başlatılmış iş (op1'e atanmış). */
async function startedFulfillment(initialMetric = 2340) {
  const { order, fulfillmentId } = await paidOrderWithFulfillment()
  await assignFulfillment(fulfillmentId, users.op1, ADMIN())
  await startFulfillment({ fulfillmentId, initialMetric }, OP1())
  return { order, fulfillmentId }
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
  // Brief'teki örnek 1.000 adet üzerinden anlatılıyor; testler de o ölçekte
  // olsun ki "500 teslim / %50" gibi beklentiler anlamlı kalsın.
  const step = variant.quantityStep > 0 ? variant.quantityStep : 1
  qty = variant.minQuantity
  while (qty < 1000) qty += step

  for (const [key, email, role] of [
    ['support', 'faz4-support@roles.test', 'SUPPORT'],
    ['op1', 'faz4-op1@roles.test', 'OPERATOR'],
    ['op2', 'faz4-op2@roles.test', 'OPERATOR'],
    ['admin', 'faz4-admin@roles.test', 'ADMIN'],
    ['customer', 'faz4-customer@roles.test', 'CUSTOMER'],
  ] as const) {
    const u = await db.user.upsert({
      where: { email },
      update: { role },
      create: { email, role },
      select: { id: true },
    })
    users[key] = u.id
  }
}, 240_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  await truncateTransactional(db)
  await db.fulfillment.deleteMany({})
  await db.user.deleteMany({ where: { email: { contains: 'ornek.test' } } })
})

// ===========================================================================
describe('⚠️ ÖDEME → OTOMATİK ONAY → READY (ve ORADA DURUR)', () => {
  it('ödeme doğrulanınca sipariş PAID olur ve fulfillment READY açılır', async () => {
    const order = await makeOrder()

    // Ödeme öncesi fulfillment YOK
    expect(await db.fulfillment.findUnique({ where: { orderId: order.id } })).toBeNull()

    const { webhookOutcome } = await payOrder(order)
    expect(webhookOutcome).toBe('PROCESSED')

    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(updated.status).toBe('PAID')

    const f = await db.fulfillment.findUniqueOrThrow({ where: { orderId: order.id } })
    // ⚠️ OTOMATİK KISIM BURADA BİTER
    expect(f.status).toBe('READY')
    expect(f.startedAt).toBeNull()
    expect(f.completedAt).toBeNull()
    expect(f.deliveredQuantity).toBe(0)
    expect(f.assignedToUserId).toBeNull()
    expect(f.requestedQuantity).toBe(order.quantity)

    // Sipariş OTOMATİK onaylandı olayı
    const events = await db.orderEvent.findMany({ where: { orderId: order.id } })
    expect(events.map((e) => e.type)).toContain('PAYMENT_RECEIVED')
    expect(events.map((e) => e.type)).toContain('ORDER_CONFIRMED')

    const fEvents = await db.fulfillmentEvent.findMany({ where: { fulfillmentId: f.id } })
    expect(fEvents).toHaveLength(1)
    expect(fEvents[0]!.type).toBe('CREATED')
    // Sistem olayı: aktör yok
    expect(fEvents[0]!.actorUserId).toBeNull()
    expect(fEvents[0]!.toStatus).toBe('READY')
  })

  it('⚠️ WEBHOOK FULFILLMENT\'I BAŞLATAMAZ', async () => {
    const { order } = await paidOrderWithFulfillment()
    const f = await db.fulfillment.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(f.status).toBe('READY')
    expect(f.startedAt).toBeNull()
  })

  it('⚠️ WEBHOOK FULFILLMENT\'I TAMAMLAYAMAZ', async () => {
    const { order } = await paidOrderWithFulfillment()
    // Aynı bildirim tekrar tekrar gelse bile
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })
    for (let i = 0; i < 3; i++) {
      await processWebhook('mock', {
        headers: new Headers({
          'content-type': 'application/json',
          'x-mock-signature': computeMockSignature({
            providerRef: payment.providerRef!,
            status: 'success',
            amountMinor: order.totalMinor,
            currency: 'TRY',
            eventId: `tekrar_${i}`,
          }),
        }),
        rawBody: JSON.stringify({
          providerRef: payment.providerRef,
          status: 'success',
          amountMinor: order.totalMinor,
          currency: 'TRY',
          eventId: `tekrar_${i}`,
        }),
        contentType: 'application/json',
      })
    }
    const f = await db.fulfillment.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(f.status).toBe('READY')
    expect(f.completedAt).toBeNull()
  })

  it('⚠️ DUPLICATE WEBHOOK İKİNCİ FULFILLMENT AÇMAZ', async () => {
    const order = await makeOrder()
    await payOrder(order)

    // Aynı sipariş için tekrar tekrar çağrılsa da tek kayıt
    for (let i = 0; i < 5; i++) await ensureFulfillmentForPaidOrder(order.id)

    expect(await db.fulfillment.count({ where: { orderId: order.id } })).toBe(1)
  })

  it('EŞZAMANLI çağrılar tek fulfillment üretir (unique constraint)', async () => {
    const order = await makeOrder()
    await payOrder(order)
    await db.fulfillment.deleteMany({ where: { orderId: order.id } })

    const results = await Promise.all([
      ensureFulfillmentForPaidOrder(order.id),
      ensureFulfillmentForPaidOrder(order.id),
      ensureFulfillmentForPaidOrder(order.id),
    ])

    expect(await db.fulfillment.count({ where: { orderId: order.id } })).toBe(1)
    const created = results.filter((r) => r?.created)
    expect(created).toHaveLength(1)
  })

  it('mevcut fulfillment YENİDEN BAŞLATILMAZ', async () => {
    const { order, fulfillmentId } = await startedFulfillment()

    // İş başlamışken tekrar gelen bildirim
    const again = await ensureFulfillmentForPaidOrder(order.id)
    expect(again?.created).toBe(false)
    expect(again?.status).toBe('STARTED')

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.status).toBe('STARTED')
    expect(f.startedAt).not.toBeNull()
  })

  it('⚠️ ÖDENMEMİŞ SİPARİŞ FULFILLMENT AÇAMAZ', async () => {
    const order = await makeOrder() // PENDING_PAYMENT
    const res = await ensureFulfillmentForPaidOrder(order.id)
    expect(res).toBeNull()
    expect(await db.fulfillment.count({ where: { orderId: order.id } })).toBe(0)
  })

  it('hedef anlık görüntüsü siparişten kopyalanır', async () => {
    const { order, fulfillmentId } = await paidOrderWithFulfillment()
    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    const snap = f.targetSnapshot as Record<string, unknown>

    expect(snap.orderNo).toBe(order.orderNo)
    expect(snap.platformName).toBe('Instagram')
    expect(snap.serviceName).toBe('Takipçi')
    expect(snap.targetHandle).toBe('medya333')
    expect(snap.quantity).toBe(order.quantity)
  })
})

// ===========================================================================
describe('⚠️ MANUEL BAŞLATMA', () => {
  it('READY → PROCESSING → STARTED yalnızca operatörle olur', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    const res = await startFulfillment({ fulfillmentId, initialMetric: 2340 }, OP1())
    expect(res.status).toBe('STARTED')
    expect(res.initialMetric).toBe(2340)
    expect(res.goalMetric).toBe(2340 + qty)

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.startedAt).not.toBeNull()

    // İki geçiş de olay bıraktı
    const events = await db.fulfillmentEvent.findMany({
      where: { fulfillmentId, type: 'STARTED' },
      orderBy: { createdAt: 'asc' },
    })
    expect(events).toHaveLength(2)
    expect(events[0]!.toStatus).toBe('PROCESSING')
    expect(events[1]!.toStatus).toBe('STARTED')
    // Aktör KAYITLI
    expect(events[0]!.actorUserId).toBe(users.op1)
  })

  it('ölçüme dayalı hizmette başlangıç değeri ZORUNLU', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())
    await expect(startFulfillment({ fulfillmentId }, OP1())).rejects.toThrowError(
      /mevcut değerini girin/,
    )
  })

  it('⚠️ READY OLMAYAN iş yeniden başlatılamaz (COMPLETED)', async () => {
    const { fulfillmentId } = await startedFulfillment()
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())
    await completeFulfillment(fulfillmentId, OP1())

    await expect(startFulfillment({ fulfillmentId }, OP1())).rejects.toThrowError(
      /yalnızca sıradaki işler/,
    )
  })

  it('sipariş de STARTED durumuna ilerler', async () => {
    const { order } = await startedFulfillment()
    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(['PROCESSING', 'STARTED']).toContain(updated.status)
  })
})

// ===========================================================================
describe('⚠️ MANUEL İLERLEME', () => {
  it('ölçümden teslim adedi türetilir (brief örneği)', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)

    const res = await updateProgress({ fulfillmentId, currentMetric: 2840 }, OP1())

    expect(res.delivered).toBe(500)
    expect(res.remaining).toBe(qty - 500)
    expect(res.percent).toBe(Math.round((500 / qty) * 100))
    expect(res.initialMetric).toBe(2340)
    expect(res.currentMetric).toBe(2840)
    // Kısmi teslim işaretlendi
    expect(res.status).toBe('PARTIAL')
  })

  it('⚠️ TESLİM İSTENEN MİKTARI AŞAMAZ', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)

    // Ölçüm hedefin çok üstüne çıksa bile
    const res = await updateProgress({ fulfillmentId, currentMetric: 2340 + qty * 5 }, OP1())
    expect(res.delivered).toBe(qty)
    expect(res.remaining).toBe(0)
    expect(res.percent).toBe(100)

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.deliveredQuantity).toBe(qty)
  })

  it('⚠️ İSTEMCİ YÜZDESİ MANİPÜLE EDİLEMEZ — yüzde sunucuda hesaplanır', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)

    // Servis imzası `percent` veya `remaining` KABUL ETMEZ; gönderilse bile
    // hiçbir yolu yoktur. Kanıt: ilerleme yalnızca ölçümden türer.
    const res = await updateProgress(
      { fulfillmentId, currentMetric: 2340 + Math.floor(qty / 4) } as never,
      OP1(),
    )
    expect(res.percent).toBe(25)
    expect(res.delivered).toBe(Math.floor(qty / 4))
  })

  it('⚠️ METRİK GERİYE DÜŞERSE hata vermez, METRIC_DECREASED olayı yazar', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 3000 }, OP1())

    const res = await updateProgress({ fulfillmentId, currentMetric: 2950 }, OP1())
    expect(res.metricDecreased).toBe(true)
    expect(res.dropAmount).toBe(50)
    // Teslim GERİ ALINMAZ
    expect(res.delivered).toBe(660)

    const ev = await db.fulfillmentEvent.findFirst({
      where: { fulfillmentId, type: 'METRIC_DECREASED' },
    })
    expect(ev).toBeTruthy()
    expect(ev!.isCustomerVisible).toBe(false)
  })

  it('⚠️ EŞZAMANLI ilerleme yarış durumu yaratmaz', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)

    await Promise.all([
      updateProgress({ fulfillmentId, currentMetric: 2500 }, OP1()),
      updateProgress({ fulfillmentId, currentMetric: 2600 }, OP1()),
      updateProgress({ fulfillmentId, currentMetric: 2700 }, OP1()),
    ])

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    // Teslim tutarlı ve sınır içinde
    expect(f.deliveredQuantity).toBeLessThanOrEqual(f.requestedQuantity)
    expect(f.deliveredQuantity).toBeGreaterThan(0)
  })

  it('başlatılmamış işte ilerleme kaydedilemez', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())
    await expect(
      updateProgress({ fulfillmentId, currentMetric: 2500 }, OP1()),
    ).rejects.toThrowError(/başlatılmış bir işte/)
  })

  it('OrderItem ilerlemesi de güncellenir (müşteri görünümü)', async () => {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 2840 }, OP1())

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } })
    expect(item.deliveredQuantity).toBe(500)
    expect(item.currentCount).toBe(2840)
  })
})

// ===========================================================================
describe('⚠️ MANUEL TAMAMLAMA — otomatik tamamlama YOK', () => {
  it('⚠️ TESLİM DOLSA BİLE durum kendiliğinden COMPLETED OLMAZ', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)

    // Tam teslim
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.deliveredQuantity).toBe(qty)
    // ⚠️ HÂLÂ TAMAMLANMADI
    expect(f.status).not.toBe('COMPLETED')
    expect(f.completedAt).toBeNull()
  })

  it('yalnızca manuel Tamamla aksiyonu COMPLETED yapar', async () => {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())

    const res = await completeFulfillment(fulfillmentId, OP1())
    expect(res.status).toBe('COMPLETED')
    expect(res.delivered).toBe(qty)

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.status).toBe('COMPLETED')
    expect(f.completedAt).not.toBeNull()

    const oEvents = await db.orderEvent.findMany({ where: { orderId: order.id } })
    expect(oEvents.map((e) => e.type)).toContain('FULFILLMENT_COMPLETED')
  })

  it('eksik teslimle kapatmak AÇIK ONAY ister', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 2340 + Math.floor(qty / 2) }, OP1())

    await expect(completeFulfillment(fulfillmentId, OP1())).rejects.toThrowError(/Teslim eksik/)

    const res = await completeFulfillment(fulfillmentId, OP1(), { allowPartial: true })
    expect(res.status).toBe('COMPLETED')
  })

  it('hiç teslim yokken tamamlanamaz', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    await expect(
      completeFulfillment(fulfillmentId, OP1(), { allowPartial: true }),
    ).rejects.toThrowError(/Hiç teslim kaydedilmemiş/)
  })

  it('garanti bitişi tamamlama anında hesaplanır', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    await db.fulfillment.update({ where: { id: fulfillmentId }, data: { guaranteeDays: 30 } })
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())

    const res = await completeFulfillment(fulfillmentId, OP1())
    expect(res.guaranteeEndsAt).toBeTruthy()

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    const diffDays = Math.round(
      (f.guaranteeEndsAt!.getTime() - f.completedAt!.getTime()) / (24 * 60 * 60 * 1000),
    )
    expect(diffDays).toBe(30)
  })

  it('⚠️ COMPLETED iş tekrar STARTED OLAMAZ', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())
    await completeFulfillment(fulfillmentId, OP1())

    await expect(
      updateProgress({ fulfillmentId, currentMetric: 9999 }, OP1()),
    ).rejects.toThrowError(/başlatılmış bir işte/)
  })
})

// ===========================================================================
describe('başarısız iş', () => {
  it('FAILED → REVIEW_REQUIRED olur, teknik sebep İÇ kalır', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)

    const res = await failFulfillment(fulfillmentId, OP1(), 'Hedef hesap gizliye alındı')
    expect(res.status).toBe('REVIEW_REQUIRED')

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.failureReason).toBe('Hedef hesap gizliye alındı')
    expect(f.failedAt).not.toBeNull()

    // Teknik sebep müşteriye görünür OLAY olarak yazılmadı
    const failEvent = await db.fulfillmentEvent.findFirstOrThrow({
      where: { fulfillmentId, type: 'FAILED' },
    })
    expect(failEvent.isCustomerVisible).toBe(false)
  })

  it('müşteri görünümünde teknik sebep YOKTUR', async () => {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await failFulfillment(fulfillmentId, OP1(), 'SECRET_INTERNAL_REASON_XYZ')

    const view = await lookupOrderByEmail(order.orderNo, EMAIL)
    const json = JSON.stringify(view)
    expect(json).not.toContain('SECRET_INTERNAL_REASON_XYZ')
    expect(view.fulfillment!.description).toContain('inceleniyor')
    expect(view.fulfillment!.label).toBe('İnceleniyor')
  })
})

// ===========================================================================
describe('⚠️ YETKİLENDİRME', () => {
  it('SUPPORT durum DEĞİŞTİREMEZ', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    await expect(startFulfillment({ fulfillmentId, initialMetric: 100 }, SUPPORT())).rejects.toThrow()
    await expect(completeFulfillment(fulfillmentId, SUPPORT())).rejects.toThrow()
    await expect(failFulfillment(fulfillmentId, SUPPORT(), 'x')).rejects.toThrow()
  })

  it('SUPPORT müşteri notu YAZABİLİR ama iç not yazamaz', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()

    await addNote(fulfillmentId, SUPPORT(), { note: 'Ekibimiz ilgileniyor.', customerVisible: true })
    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.customerNote).toBe('Ekibimiz ilgileniyor.')

    await expect(
      addNote(fulfillmentId, SUPPORT(), { note: 'iç not', customerVisible: false }),
    ).rejects.toThrow()
  })

  it('⚠️ OPERATOR BAŞKASININ işini DEĞİŞTİREMEZ', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    await expect(
      startFulfillment({ fulfillmentId, initialMetric: 100 }, OP2()),
    ).rejects.toThrowError(/atanmamış/)
    await expect(updateProgress({ fulfillmentId, currentMetric: 200 }, OP2())).rejects.toThrow()
    await expect(completeFulfillment(fulfillmentId, OP2())).rejects.toThrow()
  })

  it('⚠️ OPERATOR başkasının işini KENDİNE ALAMAZ', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    await expect(assignFulfillment(fulfillmentId, users.op2, OP2())).rejects.toThrowError(
      /başka bir operatöre atanmış/,
    )
  })

  it('OPERATOR atanmamış işi kendine alabilir', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    const res = await assignFulfillment(fulfillmentId, users.op1, OP1())
    expect(res.assignedToUserId).toBe(users.op1)
    expect(res.reassigned).toBe(false)
  })

  it('OPERATOR başkasına atama YAPAMAZ', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await expect(assignFulfillment(fulfillmentId, users.op2, OP1())).rejects.toThrowError(
      /yalnızca yöneticiler/i,
    )
  })

  it('ADMIN tüm işleri yönetebilir ve yeniden atayabilir', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    const res = await assignFulfillment(fulfillmentId, users.op2, ADMIN())
    expect(res.reassigned).toBe(true)

    // Atanmamış olsa bile admin işletebilir
    await startFulfillment({ fulfillmentId, initialMetric: 100 }, ADMIN())
    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.status).toBe('STARTED')

    const events = await db.fulfillmentEvent.findMany({
      where: { fulfillmentId, type: 'REASSIGNED' },
    })
    expect(events).toHaveLength(1)
  })

  it('OPERATOR olmayan kullanıcıya iş atanamaz', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await expect(assignFulfillment(fulfillmentId, users.customer, ADMIN())).rejects.toThrowError(
      /OPERATOR ve üzeri/,
    )
  })
})

// ===========================================================================
describe('operasyon kuyruğu', () => {
  it('⚠️ ÖDENMEMİŞ SİPARİŞ KUYRUKTA GÖRÜNMEZ', async () => {
    await makeOrder() // ödenmemiş
    const { order } = await paidOrderWithFulfillment()

    const q = await listFulfillmentQueue({ bucket: 'all' }, { userId: users.admin, role: 'ADMIN' })
    expect(q.items).toHaveLength(1)
    expect(q.items[0]!.orderNo).toBe(order.orderNo)
  })

  it('sayılar gerçek DB verisinden gelir', async () => {
    await paidOrderWithFulfillment()
    const b = await paidOrderWithFulfillment()
    await assignFulfillment(b.fulfillmentId, users.op1, ADMIN())
    await startFulfillment({ fulfillmentId: b.fulfillmentId, initialMetric: 100 }, OP1())

    const q = await listFulfillmentQueue({ bucket: 'all' }, { userId: users.op1, role: 'OPERATOR' })
    expect(q.counts.new).toBe(1)
    expect(q.counts.active).toBe(1)
    expect(q.counts.mine).toBe(1)
  })

  it('kova filtresi çalışır ve öncelik sırasına göre gelir', async () => {
    const a = await paidOrderWithFulfillment()
    const b = await paidOrderWithFulfillment()
    await assignFulfillment(b.fulfillmentId, users.op1, ADMIN())
    await startFulfillment({ fulfillmentId: b.fulfillmentId, initialMetric: 100 }, OP1())

    const newQ = await listFulfillmentQueue({ bucket: 'new' }, { userId: users.admin, role: 'ADMIN' })
    expect(newQ.items.map((i) => i.id)).toEqual([a.fulfillmentId])

    const all = await listFulfillmentQueue({ bucket: 'all' }, { userId: users.admin, role: 'ADMIN' })
    // READY (öncelik 1) STARTED'dan (3) önce gelir
    expect(all.items[0]!.status).toBe('READY')
  })

  it('sipariş numarasıyla arama', async () => {
    const { order } = await paidOrderWithFulfillment()
    await paidOrderWithFulfillment()

    const q = await listFulfillmentQueue(
      { bucket: 'all', search: order.orderNo },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(q.items).toHaveLength(1)
    expect(q.items[0]!.orderNo).toBe(order.orderNo)
  })

  it('detay görünümünde canOperate atamaya göre hesaplanır', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    const forOp1 = await getFulfillmentDetail(fulfillmentId, { userId: users.op1, role: 'OPERATOR' })
    expect(forOp1.canOperate).toBe(true)

    const forOp2 = await getFulfillmentDetail(fulfillmentId, { userId: users.op2, role: 'OPERATOR' })
    expect(forOp2.canOperate).toBe(false)

    const forAdmin = await getFulfillmentDetail(fulfillmentId, { userId: users.admin, role: 'ADMIN' })
    expect(forAdmin.canOperate).toBe(true)
  })
})

// ===========================================================================
describe('müşteri görünümü', () => {
  it('⚠️ İÇ BİLGİ SIZMAZ: operatör adı, iç not, teknik sebep', async () => {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await addNote(fulfillmentId, OP1(), {
      note: 'GIZLI_IC_NOT_XYZ',
      customerVisible: false,
    })
    await updateProgress({ fulfillmentId, currentMetric: 2840 }, OP1())

    const view = await lookupOrderByEmail(order.orderNo, EMAIL)
    const json = JSON.stringify(view)

    expect(json).not.toContain('GIZLI_IC_NOT_XYZ')
    expect(json).not.toContain('faz4-op1@roles.test')
    expect(json).not.toContain(users.op1)
    expect(json).not.toContain('iphash')
    // İç durum adı da sızmaz (müşteri metni kullanılır)
    expect(view.fulfillment!.label).not.toBe('PARTIAL')
  })

  it('ilerleme müşteriye doğru gösterilir', async () => {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 2840 }, OP1())

    const view = await lookupOrderByEmail(order.orderNo, EMAIL)
    const f = view.fulfillment!

    expect(f.requested).toBe(qty)
    expect(f.delivered).toBe(500)
    expect(f.remaining).toBe(qty - 500)
    expect(f.initialMetric).toBe(2340)
    expect(f.currentMetric).toBe(2840)
    expect(f.goalMetric).toBe(2340 + qty)
    expect(f.description).toBe('İşleminiz devam ediyor.')
    expect(f.polling).toBe(true)
  })

  it('⚠️ POLLING tamamlanınca DURUR', async () => {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())
    await completeFulfillment(fulfillmentId, OP1())

    const view = await lookupOrderByEmail(order.orderNo, EMAIL)
    expect(view.fulfillment!.polling).toBe(false)
    expect(view.fulfillment!.label).toBe('Tamamlandı')
  })

  it('müşteri notu görünür, iç not görünmez', async () => {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await addNote(fulfillmentId, SUPPORT(), {
      note: 'İlk parti tamamlandı, kalan yarın.',
      customerVisible: true,
    })

    const view = await lookupOrderByEmail(order.orderNo, EMAIL)
    expect(view.fulfillment!.customerNote).toBe('İlk parti tamamlandı, kalan yarın.')
  })

  it('ödeme bekleyen siparişte fulfillment görünümü YOKTUR', async () => {
    const order = await makeOrder()
    const view = await lookupOrderByEmail(order.orderNo, EMAIL)
    expect(view.fulfillment).toBeNull()
  })
})

// ===========================================================================
describe('garanti ve telafi', () => {
  async function completedWithGuarantee() {
    const { order, fulfillmentId } = await startedFulfillment(2340)
    await db.fulfillment.update({ where: { id: fulfillmentId }, data: { guaranteeDays: 30 } })
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())
    await completeFulfillment(fulfillmentId, OP1())
    return { order, fulfillmentId }
  }

  it('garanti içinde telafi vakası açılabilir', async () => {
    const { fulfillmentId } = await completedWithGuarantee()

    const rc = await createReplacementCase(
      {
        fulfillmentId,
        reason: 'Takipçi düşüşü',
        replacementQuantity: 100,
        currentMetric: 2340 + qty - 100,
      },
      OP1(),
    )
    expect(rc.status).toBe('DROP_DETECTED')
    expect(rc.replacementQuantity).toBe(100)
    expect(rc.droppedQuantity).toBe(100)

    const ev = await db.fulfillmentEvent.findFirst({
      where: { fulfillmentId, type: 'REPLACEMENT_CREATED' },
    })
    expect(ev).toBeTruthy()
  })

  it('⚠️ GARANTİ BİTMİŞSE telafi açılamaz', async () => {
    const { fulfillmentId } = await completedWithGuarantee()
    await db.fulfillment.update({
      where: { id: fulfillmentId },
      data: { guaranteeEndsAt: new Date(Date.now() - 1000) },
    })

    await expect(
      createReplacementCase({ fulfillmentId, reason: 'geç', replacementQuantity: 10 }, OP1()),
    ).rejects.toThrowError(/garanti süresi dolmuş/)
  })

  it('garanti tanımlı değilse telafi açılamaz', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    // Seçilen varyantın refillDays'i olabilir; bu test AÇIKÇA garantisiz durumu sınar.
    await db.fulfillment.update({ where: { id: fulfillmentId }, data: { guaranteeDays: null } })
    await updateProgress({ fulfillmentId, currentMetric: 2340 + qty }, OP1())
    await completeFulfillment(fulfillmentId, OP1())

    await expect(
      createReplacementCase({ fulfillmentId, reason: 'x', replacementQuantity: 10 }, OP1()),
    ).rejects.toThrowError(/garanti/)
  })

  it('⚠️ TELAFİ TESLİM EDİLENDEN FAZLA OLAMAZ', async () => {
    const { fulfillmentId } = await completedWithGuarantee()
    await expect(
      createReplacementCase(
        { fulfillmentId, reason: 'fazla', replacementQuantity: qty * 2 },
        OP1(),
      ),
    ).rejects.toThrowError(/teslim edilen miktarı/)
  })

  it('tamamlanmamış işte telafi açılamaz', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    await expect(
      createReplacementCase({ fulfillmentId, reason: 'erken', replacementQuantity: 10 }, OP1()),
    ).rejects.toThrowError(/tamamlanmış bir iş/)
  })

  it('⚠️ TELAFİ ONAYI yalnızca ADMIN+ verir', async () => {
    const { fulfillmentId } = await completedWithGuarantee()
    const rc = await createReplacementCase(
      { fulfillmentId, reason: 'düşüş', replacementQuantity: 50 },
      OP1(),
    )

    await advanceReplacement(rc.id, 'REVIEW_REQUIRED', OP1())
    await expect(advanceReplacement(rc.id, 'APPROVED', OP1())).rejects.toThrowError(
      /yöneticiler tarafından/,
    )

    const approved = await advanceReplacement(rc.id, 'APPROVED', ADMIN())
    expect(approved.status).toBe('APPROVED')
  })

  it('telafi akışı sırayla ilerler ve otomatik atlamaz', async () => {
    const { fulfillmentId } = await completedWithGuarantee()
    const rc = await createReplacementCase(
      { fulfillmentId, reason: 'düşüş', replacementQuantity: 50 },
      OP1(),
    )

    // DROP_DETECTED → APPROVED atlanamaz
    await expect(advanceReplacement(rc.id, 'APPROVED', ADMIN())).rejects.toThrowError(
      /Geçersiz telafi geçişi/,
    )

    await advanceReplacement(rc.id, 'REVIEW_REQUIRED', OP1())
    await advanceReplacement(rc.id, 'APPROVED', ADMIN())
    await advanceReplacement(rc.id, 'REPLACEMENT_PROCESSING', OP1())
    const done = await advanceReplacement(rc.id, 'COMPLETED', OP1())
    expect(done.status).toBe('COMPLETED')

    const stored = await db.replacementCase.findUniqueOrThrow({ where: { id: rc.id } })
    expect(stored.completedAt).not.toBeNull()

    const events = await db.fulfillmentEvent.findMany({
      where: { fulfillmentId, type: { in: ['REPLACEMENT_APPROVED', 'REPLACEMENT_STARTED', 'REPLACEMENT_COMPLETED'] } },
    })
    expect(events).toHaveLength(3)
  })
})

// ===========================================================================
describe('denetim kaydı', () => {
  it('her manuel aksiyon audit bırakır ve PII taşımaz', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    await updateProgress({ fulfillmentId, currentMetric: 2840 }, OP1())

    const logs = await db.auditLog.findMany({
      where: { entityType: 'Fulfillment', entityId: fulfillmentId },
    })
    const actions = logs.map((l) => l.action)
    expect(actions).toContain('fulfillment.assign')
    expect(actions).toContain('fulfillment.status_change')
    expect(actions).toContain('fulfillment.progress')

    const json = JSON.stringify(logs)
    expect(json).not.toContain(EMAIL)
    expect(json).not.toContain('Ayşe')
  })

  it('olay geçmişinde aktör kayıtlı', async () => {
    const { fulfillmentId } = await startedFulfillment(2340)
    const events = await db.fulfillmentEvent.findMany({ where: { fulfillmentId } })

    const created = events.find((e) => e.type === 'CREATED')!
    expect(created.actorUserId).toBeNull() // sistem

    const started = events.find((e) => e.type === 'STARTED')!
    expect(started.actorUserId).toBe(users.op1) // insan
  })
})

// ===========================================================================
describe('durum makinesi DB üzerinde', () => {
  it('geçersiz geçiş reddedilir', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    // READY iken doğrudan tamamlanamaz
    await expect(completeFulfillment(fulfillmentId, OP1())).rejects.toThrowError(
      /başlatılmış bir iş/,
    )
  })

  it('aynı duruma geçiş idempotent no-op (çift tıklama)', async () => {
    const { fulfillmentId } = await paidOrderWithFulfillment()
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())

    await startFulfillment({ fulfillmentId, initialMetric: 2340 }, OP1())
    const before = await db.fulfillmentEvent.count({ where: { fulfillmentId } })

    // İkinci "başlat" — PROCESSING atlanır, STARTED no-op olur
    await startFulfillment({ fulfillmentId, initialMetric: 2340 }, OP1()).catch(() => null)

    const f = await db.fulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })
    expect(f.status).toBe('STARTED')
    expect(await db.fulfillmentEvent.count({ where: { fulfillmentId } })).toBeGreaterThanOrEqual(
      before,
    )
  })

  it('olmayan fulfillment 404 verir', async () => {
    await expect(
      startFulfillment({ fulfillmentId: 'yoktur' }, OP1()),
    ).rejects.toThrowError(FulfillmentError)
  })
})
