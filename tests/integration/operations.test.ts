/**
 * ⭐ FAZ 8 — OPERASYON ENTEGRASYON TESTLERİ (gerçek PostgreSQL)
 *
 * Bu dosyanın kilitlediği üç şey:
 *
 *   1. CURSOR SAYFALAMA — hiçbir kayıt iki sayfada görünmez, hiçbiri atlanmaz.
 *      Sayfalar arasında YENİ KAYIT EKLENSE BİLE bu geçerlidir; OFFSET
 *      sayfalamanın çöktüğü senaryo tam olarak budur.
 *   2. BİLDİRİM IDEMPOTENCY — aynı OrderEvent için ikinci e-posta gitmez.
 *   3. ARAMA / FİLTRE / YETKİ — arama sonuçları müşteri verisi sızdırmaz.
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
process.env.APP_BASE_URL = 'http://localhost:3000'
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
import {
  assignFulfillment,
  completeFulfillment,
  startFulfillment,
  updateProgress,
  type Actor,
} from '@/server/fulfillment/operate'
import {
  listFulfillmentQueue,
  listQueueFilterOptions,
  type QueueSort,
} from '@/server/fulfillment/queue'
import { notifyLatestOrderEvent, notifyOrderEvent } from '@/server/notifications'
import { MemoryMailProvider, setMailProvider } from '@/server/mail'
import { checkHealth } from '@/server/health'
import type { CreateOrderInput } from '@/lib/validation'
import type { UserRole } from '@/lib/enums'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number
let mail: MemoryMailProvider

const users: Record<'op1' | 'op2' | 'admin' | 'support', string> = {
  op1: '',
  op2: '',
  admin: '',
  support: '',
}

let seq = 0
const nextKey = () => `ops-test-key-${Date.now()}-${++seq}-padding`

function actor(id: string, role: UserRole): Actor {
  return { userId: id, role, ipHash: 'iphash' }
}
const ADMIN = () => actor(users.admin, 'ADMIN')
const OP1 = () => actor(users.op1, 'OPERATOR')

async function makeTarget(handle: string) {
  const t = await db.target.create({
    data: {
      platformId,
      targetType: 'PROFILE',
      rawInput: `@${handle}`,
      normalized: handle,
      canonicalUrl: `https://instagram.com/${handle}`,
      status: 'UNVERIFIED',
      verifyMethod: 'format_only',
      handle,
    },
    select: { id: true },
  })
  return t.id
}

async function makeOrder(opts: { email: string; handle: string }) {
  const targetId = await makeTarget(opts.handle)
  const res = await createOrder(
    {
      serviceVariantId: variantId,
      quantity: qty,
      targetId,
      targetConfirmed: true,
      customerFirstName: 'Ayşe',
      customerLastName: 'Yılmaz',
      guestEmail: opts.email,
      acceptedTerms: true,
      acceptedRefund: true,
      acceptedPrivacy: true,
    } as CreateOrderInput,
    { userId: null, idempotencyKey: nextKey(), ipHash: 'iphash', userAgent: 'vitest' },
  )
  return db.order.findUniqueOrThrow({
    where: { id: res.order.id },
    select: { id: true, orderNo: true, userId: true, totalMinor: true },
  })
}

async function payOrder(order: { orderNo: string; userId: string; totalMinor: number }) {
  const session = await createPaymentForOrder(order.orderNo, {
    userId: order.userId,
    ip: '203.0.113.5',
    ipHash: 'iphash',
    idempotencyKey: nextKey(),
  })
  const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })
  const eventId = `opsevt_${payment.providerRef}`
  const body = {
    providerRef: payment.providerRef!,
    status: 'success' as const,
    amountMinor: order.totalMinor,
    currency: 'TRY',
    eventId,
  }
  await processWebhook('mock', {
    headers: new Headers({
      'content-type': 'application/json',
      'x-mock-signature': computeMockSignature(body),
    }),
    rawBody: JSON.stringify(body),
    contentType: 'application/json',
  })
}

/** Ödenmiş sipariş + READY fulfillment. */
async function paidOrder(i: number) {
  const order = await makeOrder({
    email: `musteri${i}@ornek.test`,
    handle: `hedef${i}`,
  })
  await payOrder(order)
  const f = await db.fulfillment.findUniqueOrThrow({ where: { orderId: order.id } })
  return { order, fulfillmentId: f.id }
}

/** Sayfa sayfa gezip TÜM kimlikleri toplar. */
async function pageThrough(
  sort: QueueSort,
  pageSize: number,
  onPage?: (pageIndex: number) => Promise<void>,
): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page++) {
    const res = await listFulfillmentQueue(
      { bucket: 'all', sort, pageSize, ...(cursor ? { cursor } : {}) },
      { userId: users.admin, role: 'ADMIN' },
    )
    seen.push(...res.items.map((i) => i.id))
    if (onPage) await onPage(page)
    if (!res.nextCursor) break
    cursor = res.nextCursor
  }
  return seen
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)

  const fixture = await pickCatalogVariant(db, { atLeast: 1000 })
  variantId = fixture.variantId
  platformId = fixture.platformId
  qty = fixture.quantity

  for (const [key, email, role] of [
    ['support', 'faz8-support@roles.test', 'SUPPORT'],
    ['op1', 'faz8-op1@roles.test', 'OPERATOR'],
    ['op2', 'faz8-op2@roles.test', 'OPERATOR'],
    ['admin', 'faz8-admin@roles.test', 'ADMIN'],
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
  setMailProvider(null)
  await ctx?.stop()
})

beforeEach(async () => {
  await truncateTransactional(db)
  await db.fulfillment.deleteMany({})
  await db.user.deleteMany({ where: { email: { contains: 'ornek.test' } } })
  mail = new MemoryMailProvider()
  setMailProvider(mail)
})

// ===========================================================================
describe('⭐ CURSOR SAYFALAMA', () => {
  it('sayfalar bölünür; hiçbir kayıt tekrar etmez ve atlanmaz', async () => {
    for (let i = 0; i < 11; i++) await paidOrder(i)

    const ids = await pageThrough('newest', 4)

    expect(ids).toHaveLength(11)
    expect(new Set(ids).size).toBe(11)

    const all = await db.fulfillment.findMany({ select: { id: true } })
    expect(new Set(ids)).toEqual(new Set(all.map((f) => f.id)))
  })

  it('⚠️ sayfalar arasında YENİ KAYIT eklense bile tekrar/atlama olmaz', async () => {
    // OFFSET sayfalamada bu senaryo kesin olarak bozulur: yeni kayıt en üste
    // girer, her şey bir sıra kayar, bir kayıt iki kez görünür.
    for (let i = 0; i < 8; i++) await paidOrder(i)

    const before = await db.fulfillment.findMany({ select: { id: true } })
    const beforeIds = new Set(before.map((f) => f.id))

    let inserted = 0
    const ids = await pageThrough('newest', 3, async (page) => {
      if (page === 0 && inserted === 0) {
        // İlk sayfa okunduktan SONRA iki yeni iş düşüyor.
        await paidOrder(100)
        await paidOrder(101)
        inserted = 2
      }
    })

    // Tekrar YOK
    expect(new Set(ids).size).toBe(ids.length)
    // Başlangıçtaki 8 kaydın TAMAMI görüldü — hiçbiri atlanmadı
    for (const id of beforeIds) {
      expect(ids, 'sayfalama sırasında kayıt atlandı').toContain(id)
    }
  })

  it('geri gitmek aynı sayfayı verir (ileri → geri → ileri)', async () => {
    for (let i = 0; i < 9; i++) await paidOrder(i)

    const viewer = { userId: users.admin, role: 'ADMIN' as const }
    const p1 = await listFulfillmentQueue({ bucket: 'all', pageSize: 3 }, viewer)
    const p2 = await listFulfillmentQueue(
      { bucket: 'all', pageSize: 3, cursor: p1.nextCursor! },
      viewer,
    )
    const back = await listFulfillmentQueue(
      { bucket: 'all', pageSize: 3, cursor: p2.prevCursor!, direction: 'backward' },
      viewer,
    )

    expect(p1.items.map((i) => i.id)).toEqual(back.items.map((i) => i.id))
    // İki sayfa kesişmiyor
    const overlap = p1.items.filter((a) => p2.items.some((b) => b.id === a.id))
    expect(overlap).toEqual([])
  })

  it('son sayfada nextCursor null olur', async () => {
    for (let i = 0; i < 5; i++) await paidOrder(i)
    const res = await listFulfillmentQueue(
      { bucket: 'all', pageSize: 50 },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(res.items).toHaveLength(5)
    expect(res.nextCursor).toBeNull()
    expect(res.prevCursor).toBeNull()
  })

  it('⚠️ EN YENİ SİPARİŞ İLK SAYFADA — varsayılan sıralama newest', async () => {
    for (let i = 0; i < 60; i++) await paidOrder(i)
    const { fulfillmentId } = await paidOrder(999)

    const res = await listFulfillmentQueue(
      { bucket: 'all' },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(res.pageSize).toBe(50)
    expect(res.items[0]!.id).toBe(fulfillmentId)
  })

  it('oldest sıralaması en eskiyi başa alır', async () => {
    const first = await paidOrder(1)
    for (let i = 2; i < 5; i++) await paidOrder(i)

    const res = await listFulfillmentQueue(
      { bucket: 'all', sort: 'oldest' },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(res.items[0]!.id).toBe(first.fulfillmentId)
  })

  it('durum önceliği sıralamasında READY başta gelir', async () => {
    const a = await paidOrder(1)
    const b = await paidOrder(2)
    await assignFulfillment(b.fulfillmentId, users.op1, ADMIN())
    await startFulfillment({ fulfillmentId: b.fulfillmentId, initialMetric: 100 }, OP1())

    const res = await listFulfillmentQueue(
      { bucket: 'all', sort: 'priority' },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(res.items[0]!.id).toBe(a.fulfillmentId)
    expect(res.items[0]!.status).toBe('READY')
  })
})

// ===========================================================================
describe('⭐ ARAMA VE FİLTRE', () => {
  it('sipariş numarasıyla bulunur', async () => {
    const target = await paidOrder(1)
    for (let i = 2; i < 6; i++) await paidOrder(i)

    const res = await listFulfillmentQueue(
      { bucket: 'all', search: target.order.orderNo },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(res.items).toHaveLength(1)
    expect(res.items[0]!.id).toBe(target.fulfillmentId)
  })

  it('müşteri e-postasıyla bulunur', async () => {
    const target = await paidOrder(7)
    for (let i = 20; i < 23; i++) await paidOrder(i)

    const res = await listFulfillmentQueue(
      { bucket: 'all', search: 'musteri7@ornek.test' },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(res.items.map((i) => i.id)).toEqual([target.fulfillmentId])
  })

  it('hedefle bulunur (@ ile de, @ olmadan da)', async () => {
    const target = await paidOrder(42)
    for (let i = 50; i < 53; i++) await paidOrder(i)

    for (const q of ['hedef42', '@hedef42', 'HEDEF42']) {
      const res = await listFulfillmentQueue(
        { bucket: 'all', search: q },
        { userId: users.admin, role: 'ADMIN' },
      )
      expect(res.items.map((i) => i.id), `arama: ${q}`).toEqual([target.fulfillmentId])
    }
  })

  it('eşleşme yoksa boş döner (hata değil)', async () => {
    await paidOrder(1)
    const res = await listFulfillmentQueue(
      { bucket: 'all', search: 'M333-YOKBOYLE' },
      { userId: users.admin, role: 'ADMIN' },
    )
    expect(res.items).toEqual([])
    expect(res.nextCursor).toBeNull()
  })

  it('operatöre göre filtreler; "unassigned" atanmamışları getirir', async () => {
    const assigned = await paidOrder(1)
    const free = await paidOrder(2)
    await assignFulfillment(assigned.fulfillmentId, users.op1, ADMIN())

    const viewer = { userId: users.admin, role: 'ADMIN' as const }
    const mine = await listFulfillmentQueue(
      { bucket: 'all', assignedToUserId: users.op1 },
      viewer,
    )
    expect(mine.items.map((i) => i.id)).toEqual([assigned.fulfillmentId])

    const none = await listFulfillmentQueue(
      { bucket: 'all', assignedToUserId: 'unassigned' },
      viewer,
    )
    expect(none.items.map((i) => i.id)).toEqual([free.fulfillmentId])
  })

  it('platform ve hizmet filtreleri çalışır, uyumsuz filtre boş döner', async () => {
    await paidOrder(1)
    const viewer = { userId: users.admin, role: 'ADMIN' as const }

    const ig = await listFulfillmentQueue({ bucket: 'all', platformSlug: 'instagram' }, viewer)
    expect(ig.items.length).toBe(1)

    const tt = await listFulfillmentQueue({ bucket: 'all', platformSlug: 'tiktok' }, viewer)
    expect(tt.items).toEqual([])
  })

  it('tarih aralığı filtreler', async () => {
    await paidOrder(1)
    const viewer = { userId: users.admin, role: 'ADMIN' as const }

    const today = new Date().toISOString().slice(0, 10)
    const inRange = await listFulfillmentQueue(
      { bucket: 'all', createdFrom: today, createdTo: today },
      viewer,
    )
    expect(inRange.items.length).toBe(1)

    const past = await listFulfillmentQueue(
      { bucket: 'all', createdFrom: '2000-01-01', createdTo: '2000-01-02' },
      viewer,
    )
    expect(past.items).toEqual([])
  })

  it('sekme sayaçları filtreden ETKİLENMEZ (iş kaybolmuş gibi görünmesin)', async () => {
    for (let i = 0; i < 4; i++) await paidOrder(i)
    const viewer = { userId: users.admin, role: 'ADMIN' as const }

    const all = await listFulfillmentQueue({ bucket: 'all' }, viewer)
    const filtered = await listFulfillmentQueue({ bucket: 'all', search: 'hedef0' }, viewer)

    expect(filtered.items).toHaveLength(1)
    expect(filtered.counts).toEqual(all.counts)
    // Filtrelenen toplam ise gerçekten daralır
    expect(filtered.filteredTotal).toBe(1)
    expect(all.filteredTotal).toBe(4)
  })

  it('⚠️ kuyruk satırı MÜŞTERİ PII\'si taşımaz', async () => {
    await paidOrder(1)
    const res = await listFulfillmentQueue(
      { bucket: 'all' },
      { userId: users.admin, role: 'ADMIN' },
    )
    const raw = JSON.stringify(res.items)
    // Hedef ve sipariş no operasyon için gerekli; e-posta, ad, telefon DEĞİL.
    expect(raw).not.toContain('musteri1@ornek.test')
    expect(raw).not.toContain('Ayşe')
    expect(raw).not.toContain('Yılmaz')
  })

  it('filtre seçenekleri katalogdan gelir ve fiyat sızdırmaz', async () => {
    const options = await listQueueFilterOptions()
    expect(options.length).toBeGreaterThan(0)
    const raw = JSON.stringify(options)
    for (const leak of ['unitPriceMinor', 'packagePriceMinor', 'pricingRules', 'cost']) {
      expect(raw, `filtre seçeneklerinde sızıntı: ${leak}`).not.toContain(leak)
    }
  })
})

// ===========================================================================
describe('⭐ BİLDİRİM IDEMPOTENCY', () => {
  it('sipariş oluşturmanın KENDİSİ bildirimi üretir (route\'a bağımlı değil)', async () => {
    const order = await makeOrder({ email: 'bildirim@ornek.test', handle: 'bildirim' })

    const rows = await db.notification.findMany({ where: { orderId: order.id } })
    expect(rows, 'createOrder bildirim üretmedi').toHaveLength(1)
    expect(rows[0]!.template).toBe('ORDER_CREATED')
  })

  it('⚠️ AYNI OLAY 5 KEZ tetiklense bile TEK bildirim oluşur', async () => {
    const order = await makeOrder({ email: 'tekrar@ornek.test', handle: 'tekrar' })
    const event = await db.orderEvent.findFirstOrThrow({
      where: { orderId: order.id, type: 'ORDER_CREATED' },
      select: { id: true },
    })

    // Sipariş oluşturulurken zaten bir bildirim üretildi; bu 5 tetikleme
    // ONUN ÜSTÜNE gelir ve hepsi DUPLICATE olmalıdır.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => notifyOrderEvent(event.id)),
    )

    const rows = await db.notification.findMany({ where: { orderEventId: event.id } })
    expect(rows, 'aynı olay için ikinci bildirim kaydı açıldı').toHaveLength(1)
    expect(results.every((r) => r.outcome === 'DUPLICATE')).toBe(true)
  })

  it('⚠️ eşzamanlı 10 tetikleme yarışında da TEK e-posta gider', async () => {
    const order = await makeOrder({ email: 'yaris@ornek.test', handle: 'yaris' })
    const event = await db.orderEvent.findFirstOrThrow({
      where: { orderId: order.id, type: 'ORDER_CREATED' },
      select: { id: true },
    })

    await Promise.all(Array.from({ length: 10 }, () => notifyOrderEvent(event.id)))

    const rows = await db.notification.findMany({ where: { orderEventId: event.id } })
    expect(rows).toHaveLength(1)
    expect(mail.outbox.filter((m) => m.template === 'ORDER_CREATED')).toHaveLength(1)
  })

  it('bildirim üretmeyen olay için kayıt AÇILMAZ', async () => {
    const order = await makeOrder({ email: 'sessiz@ornek.test', handle: 'sessiz' })

    // Sipariş oluşturulurken ORDER_CREATED bildirimi üretildi; başka hiçbir
    // olay (sözleşme onayı, hedef onayı, müşteri bilgisi) bildirim ÜRETMEZ.
    for (const type of ['CONSENT_ACCEPTED', 'TARGET_CONFIRMED', 'CUSTOMER_INFO_ADDED'] as const) {
      const res = await notifyLatestOrderEvent(order.id, type)
      expect(res.outcome, `${type} bildirim üretti`).toBe('NOT_APPLICABLE')
    }

    const templates = await db.notification.findMany({
      where: { orderId: order.id },
      select: { template: true },
    })
    expect(templates.map((t) => t.template)).toEqual(['ORDER_CREATED'])
  })

  it('⚠️ bildirim kaydında HAM e-posta ve HAM token BULUNMAZ', async () => {
    const order = await makeOrder({ email: 'gizli@ornek.test', handle: 'gizli' })

    const row = await db.notification.findFirstOrThrow({ where: { orderId: order.id } })
    const raw = JSON.stringify(row)
    expect(raw).not.toContain('gizli@ornek.test')
    expect(row.recipientMasked).toBe('gi***@ornek.test')

    // Gerçek takip token'ı sipariş oluşturmada üretildi; kaydın hiçbir
    // alanında token'a benzeyen uzun bir sır bulunmamalı.
    const tokenish = /[A-Za-z0-9_-]{32,}/.exec(raw.replace(/"id":"[^"]+"/g, ''))
    expect(tokenish, `token benzeri değer: ${tokenish?.[0]}`).toBeNull()
  })

  it('⚠️ teslim edemeyen sağlayıcı SENT değil FAILED yazar', async () => {
    // MemoryMailProvider `ok:true` döner ama `canDeliver=false` — yani
    // "gönderildi" demek YALAN olur. Kayıt FAILED olmalıdır.
    const order = await makeOrder({ email: 'teslimsiz@ornek.test', handle: 'teslimsiz' })

    const row = await db.notification.findFirstOrThrow({ where: { orderId: order.id } })
    expect(row.status).toBe('FAILED')
    expect(row.sentAt).toBeNull()
    expect(row.provider).toBe('memory')
    expect(row.failureReason).toBeTruthy()
  })

  it('ödeme → başlatma → tamamlama zinciri BEKLENEN şablonları üretir', async () => {
    const { order, fulfillmentId } = await paidOrder(1)
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())
    await startFulfillment({ fulfillmentId, initialMetric: 500 }, OP1())
    await updateProgress({ fulfillmentId, currentMetric: 500 + qty }, OP1())
    await completeFulfillment(fulfillmentId, OP1())

    const templates = (
      await db.notification.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
        select: { template: true },
      })
    ).map((n) => n.template)

    expect(templates).toContain('ORDER_CREATED')
    expect(templates).toContain('PAYMENT_RECEIVED')
    expect(templates).toContain('ORDER_STARTED')
    expect(templates).toContain('ORDER_PROGRESS')
    expect(templates).toContain('ORDER_COMPLETED')
    // Her şablon EN FAZLA bir kez
    expect(new Set(templates).size).toBe(templates.length)
  })

  it('⚠️ ilerleme e-postası SADECE ilk teslimde gider (spam yok)', async () => {
    const { order, fulfillmentId } = await paidOrder(1)
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())
    await startFulfillment({ fulfillmentId, initialMetric: 500 }, OP1())

    await updateProgress({ fulfillmentId, currentMetric: 600 }, OP1())
    await updateProgress({ fulfillmentId, currentMetric: 700 }, OP1())
    await updateProgress({ fulfillmentId, currentMetric: 800 }, OP1())

    const progress = await db.notification.count({
      where: { orderId: order.id, template: 'ORDER_PROGRESS' },
    })
    expect(progress).toBe(1)
  })

  it('⚠️ e-posta gövdesinde kart/sır/iç not GEÇMEZ', async () => {
    const { fulfillmentId } = await paidOrder(1)
    await assignFulfillment(fulfillmentId, users.op1, ADMIN())
    await startFulfillment({ fulfillmentId, initialMetric: 500 }, OP1())

    const raw = JSON.stringify(mail.outbox)
    for (const leak of [
      'cardNumber', 'cvv', 'AUTH_SECRET', 'ORDER_TOKEN_SECRET',
      'iphash', 'internalNote', 'READY', 'REVIEW_REQUIRED', 'mock',
    ]) {
      expect(raw, `e-postada sızıntı: ${leak}`).not.toContain(leak)
    }
  })
})

// ===========================================================================
describe('⭐ SAĞLIK KONTROLÜ', () => {
  it('veritabanı ayakta: durum healthy veya degraded, asla sır sızdırmaz', async () => {
    const result = await checkHealth()
    expect(['healthy', 'degraded', 'unavailable']).toContain(result.status)
    expect(result.checks.database.status).toBe('up')

    const raw = JSON.stringify(result)
    for (const leak of [
      'postgresql://', 'redis://', 'medya333:medya333',
      'AUTH_SECRET', 'IYZICO', 'PAYTR', 'password',
    ]) {
      expect(raw, `sağlık cevabında sızıntı: ${leak}`).not.toContain(leak)
    }
  })

  it('⚠️ ödeme sağlayıcısı sağlık kontrolünde ÇAĞRILMAZ', async () => {
    const result = await checkHealth()
    expect(Object.keys(result.checks).sort()).toEqual(['application', 'database', 'redis'])
  })
})
