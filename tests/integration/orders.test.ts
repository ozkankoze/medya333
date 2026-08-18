/**
 * FAZ 2 — SİPARİŞ AKIŞI ENTEGRASYON TESTLERİ (gerçek PostgreSQL)
 *
 * Kapsam:
 *   • Sipariş oluşturma: sunucu fiyatı otoritedir, istemci fiyatına güvenilmez
 *   • Idempotency: aynı key + aynı gövde / aynı key + farklı gövde
 *   • PriceChangedError
 *   • ÖDEME ALINMADAN FULFILLMENT YOK (iki bağımsız kapı)
 *   • Misafir sorgusu: enumeration + brute force + sabit süreli karşılaştırma
 *   • Takip token'ı: DB'de yalnızca hash
 *   • IDOR: başka kullanıcının siparişi görülemez
 *   • Guest → hesap devri: yalnızca e-posta eşleşmesi YETMEZ
 *   • PII minimizasyonu: public görünümde ad/telefon/tam e-posta yok
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
delete process.env.REDIS_URL

import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import {
  pickCatalogVariant,
  setupTestDatabase,
  truncateTransactional,
  type TestDatabase,
} from './db-setup'

import { createOrder, IdempotencyConflictError, PriceChangedError } from '@/server/orders/create'
import {
  FulfillmentBeforePaymentError,
  transitionOrder,
} from '@/server/orders/transition'
import {
  getOrderForUser,
  lookupOrderByEmail,
  lookupOrderByToken,
  OrderAccessDeniedError,
} from '@/server/orders/lookup'
import { claimGuestOrders, ClaimError, issueClaimToken } from '@/server/orders/claim'
import { adminTransitionOrder, listOrdersForAdmin, AdminOrderError } from '@/server/orders/admin'
import { hashAccessToken, ORDER_NO_REGEX } from '@/server/orders/order-no'
import { InvalidTransitionError } from '@/lib/orders/transitions'
import type { CreateOrderInput } from '@/lib/validation'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let targetId: string
let adminId: string
/** Varyantın kurallarına UYAN miktar — seed değişse de test kırılmaz */
let qty: number

let keySeq = 0
const nextKey = () => `test-idem-key-${Date.now()}-${++keySeq}-padding`

const GUEST_EMAIL = 'misafir@ornek.test'

function baseInput(over: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    serviceVariantId: variantId,
    quantity: qty,
    targetId,
    targetConfirmed: true,
    customerFirstName: 'Ayşe',
    customerLastName: 'Yılmaz',
    guestEmail: GUEST_EMAIL,
    acceptedTerms: true,
    acceptedRefund: true,
    acceptedPrivacy: true,
    ...over,
  } as CreateOrderInput
}

const CTX = { userId: null, ipHash: 'iphash-test', userAgent: 'vitest' }

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
    where: { email: 'faz2-admin@roles.test' },
    update: { role: 'ADMIN' },
    create: { email: 'faz2-admin@roles.test', role: 'ADMIN' },
    select: { id: true },
  })
  adminId = admin.id
}, 240_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  await truncateTransactional(db)
  await db.user.deleteMany({ where: { email: { contains: 'ornek.test' } } })
  targetId = await makeTarget()
})

// ---------------------------------------------------------------------------
describe('sipariş oluşturma', () => {
  it('siparişi PENDING_PAYMENT olarak oluşturur ve fiyatı SUNUCUDA hesaplar', async () => {
    const res = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })

    expect(res.reused).toBe(false)
    expect(res.order.status).toBe('PENDING_PAYMENT')
    expect(res.order.orderNo).toMatch(ORDER_NO_REGEX)
    expect(res.order.totalMinor).toBeGreaterThan(0)

    const order = await db.order.findUniqueOrThrow({
      where: { id: res.order.id },
      include: { items: true, events: true },
    })

    // KDV DAHİL mantığı: total = subtotal + tax
    expect(order.subtotalMinor + order.taxAmountMinor).toBe(order.totalMinor)
    expect(order.taxRateBp).toBe(2000)
    expect(order.items).toHaveLength(1)
    expect(order.items[0]!.status).toBe('PENDING_PAYMENT')

    // Sözleşme onayları sürümleriyle snapshot'lanmış
    expect(order.consentAcceptedAt).toBeTruthy()
    expect(order.consentTermsVersion).toBeTruthy()
    expect(order.consentRefundVersion).toBeTruthy()
    expect(order.consentPrivacyVersion).toBeTruthy()

    const types = order.events.map((e) => e.type)
    expect(types).toContain('ORDER_CREATED')
    expect(types).toContain('TARGET_CONFIRMED')
    expect(types).toContain('CUSTOMER_INFO_ADDED')
    expect(types).toContain('CONSENT_ACCEPTED')
    expect(types).toContain('PAYMENT_PENDING')
  })

  it('sipariş numarası sıralı DEĞİLDİR ve tahmin edilemez', async () => {
    const a = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    targetId = await makeTarget()
    const b = await createOrder(baseInput({ targetId }), { ...CTX, idempotencyKey: nextKey() })
    expect(a.order.orderNo).not.toBe(b.order.orderNo)
    // Ardışık sayı ilişkisi yok
    expect(a.order.orderNo.slice(5)).not.toBe(b.order.orderNo.slice(5))
  })

  it('takip token\'ı DB\'de HAM saklanmaz — yalnızca hash', async () => {
    const res = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const order = await db.order.findUniqueOrThrow({ where: { id: res.order.id } })
    expect(res.accessToken).toBeTruthy()
    expect(order.accessTokenHash).not.toBe(res.accessToken)
    expect(order.accessTokenHash).toBe(hashAccessToken(res.accessToken!))
  })

  it('istemci fiyatı farklıysa PriceChangedError fırlatır ve SİPARİŞ OLUŞMAZ', async () => {
    const before = await db.order.count()
    await expect(
      createOrder(baseInput({ clientTotalMinor: 1 }), { ...CTX, idempotencyKey: nextKey() }),
    ).rejects.toThrowError(PriceChangedError)
    expect(await db.order.count()).toBe(before)
  })

  it('PriceChangedError mesajı sözleşmede belirtilen metindir', async () => {
    await expect(
      createOrder(baseInput({ clientTotalMinor: 1 }), { ...CTX, idempotencyKey: nextKey() }),
    ).rejects.toThrowError('Fiyat güncellendi. Lütfen sipariş özetini kontrol edin.')
  })

  it('doğrulanamayan hedef onaylanmadıysa sipariş oluşmaz', async () => {
    await expect(
      createOrder(baseInput({ targetConfirmed: false }), { ...CTX, idempotencyKey: nextKey() }),
    ).rejects.toThrowError(/onaylamanız gerekir/)
  })
})

// ---------------------------------------------------------------------------
describe('idempotency', () => {
  it('aynı key + aynı gövde → AYNI sipariş, ikinci kayıt AÇILMAZ', async () => {
    const key = nextKey()
    const first = await createOrder(baseInput(), { ...CTX, idempotencyKey: key })
    const second = await createOrder(baseInput(), { ...CTX, idempotencyKey: key })

    expect(second.reused).toBe(true)
    expect(second.order.orderNo).toBe(first.order.orderNo)
    expect(await db.order.count()).toBe(1)
    // Tekrar çağrıda ham token DÖNMEZ
    expect(second.accessToken).toBeNull()
  })

  it('aynı key + FARKLI gövde → güvenli şekilde reddedilir', async () => {
    const key = nextKey()
    await createOrder(baseInput(), { ...CTX, idempotencyKey: key })
    await expect(
      createOrder(baseInput({ quantity: qty * 2 }), { ...CTX, idempotencyKey: key }),
    ).rejects.toThrowError(IdempotencyConflictError)
    expect(await db.order.count()).toBe(1)
  })

  it('farklı key → yeni sipariş', async () => {
    await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    targetId = await makeTarget()
    await createOrder(baseInput({ targetId }), { ...CTX, idempotencyKey: nextKey() })
    expect(await db.order.count()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
describe('ÖDEME ALINMADAN FULFILLMENT YOK', () => {
  async function pendingOrder() {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    return r.order.id
  }

  it('PENDING_PAYMENT → PROCESSING reddedilir', async () => {
    const id = await pendingOrder()
    await expect(
      transitionOrder({ orderId: id, to: 'PROCESSING', actorType: 'ADMIN', actorId: adminId }),
    ).rejects.toThrowError(FulfillmentBeforePaymentError)
    const after = await db.order.findUniqueOrThrow({ where: { id } })
    expect(after.status).toBe('PENDING_PAYMENT')
  })

  it('PENDING_PAYMENT → STARTED / COMPLETED de reddedilir', async () => {
    const id = await pendingOrder()
    for (const to of ['STARTED', 'IN_PROGRESS', 'PARTIAL', 'COMPLETED'] as const) {
      await expect(
        transitionOrder({ orderId: id, to, actorType: 'ADMIN', actorId: adminId }),
      ).rejects.toThrowError(FulfillmentBeforePaymentError)
    }
  })

  it('ADMIN YETKİSİ bu kuralı AŞAMAZ', async () => {
    const id = await pendingOrder()
    const order = await db.order.findUniqueOrThrow({ where: { id } })
    await expect(
      adminTransitionOrder({ orderNoOrId: order.orderNo, to: 'PROCESSING', actorId: adminId }),
    ).rejects.toThrowError(AdminOrderError)
  })

  it('PENDING_PAYMENT → CANCELLED SERBESTTİR', async () => {
    const id = await pendingOrder()
    const order = await db.order.findUniqueOrThrow({ where: { id } })
    const res = await adminTransitionOrder({
      orderNoOrId: order.orderNo,
      to: 'CANCELLED',
      actorId: adminId,
      reason: 'Müşteri talebi',
    })
    expect(res.to).toBe('CANCELLED')
  })

  it('ödeme alındıktan SONRA işleme alınabilir', async () => {
    const id = await pendingOrder()
    await transitionOrder({ orderId: id, to: 'PAID', actorType: 'WEBHOOK' })
    const processing = await transitionOrder({
      orderId: id,
      to: 'PROCESSING',
      actorType: 'ADMIN',
      actorId: adminId,
    })
    expect(processing.status).toBe('PROCESSING')
    expect(processing.paidAt).toBeTruthy()
    expect(processing.processingAt).toBeTruthy()
  })

  it('aynı duruma geçiş idempotent no-op\'tur (webhook çift tetiklenmesi)', async () => {
    const id = await pendingOrder()
    await transitionOrder({ orderId: id, to: 'PAID', actorType: 'WEBHOOK' })
    const eventsBefore = await db.orderEvent.count({ where: { orderId: id } })
    await transitionOrder({ orderId: id, to: 'PAID', actorType: 'WEBHOOK' })
    expect(await db.orderEvent.count({ where: { orderId: id } })).toBe(eventsBefore)
  })

  it('geçersiz geçiş InvalidTransitionError verir', async () => {
    const id = await pendingOrder()
    await expect(
      transitionOrder({ orderId: id, to: 'REFUNDED', actorType: 'ADMIN', actorId: adminId }),
    ).rejects.toThrowError(InvalidTransitionError)
  })

  it('admin AKTİF İŞ listesi ödeme bekleyen siparişleri İÇERMEZ', async () => {
    const pendingId = await pendingOrder()
    targetId = await makeTarget()
    const paid = await createOrder(baseInput({ targetId }), { ...CTX, idempotencyKey: nextKey() })
    await transitionOrder({ orderId: paid.order.id, to: 'PAID', actorType: 'WEBHOOK' })

    const active = await listOrdersForAdmin({ queue: 'active' })
    const activeIds = active.orders.map((o) => o.id)
    expect(activeIds).toContain(paid.order.id)
    expect(activeIds).not.toContain(pendingId)

    const awaiting = await listOrdersForAdmin({ queue: 'awaiting_payment' })
    expect(awaiting.orders.map((o) => o.id)).toContain(pendingId)
    expect(awaiting.orders.find((o) => o.id === pendingId)?.isFulfillable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('misafir sipariş erişimi', () => {
  it('orderNo + doğru e-posta ile görüntülenir', async () => {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const view = await lookupOrderByEmail(r.order.orderNo, GUEST_EMAIL)
    expect(view.orderNo).toBe(r.order.orderNo)
    expect(view.status).toBe('PENDING_PAYMENT')
  })

  it('e-posta büyük/küçük harf ve boşluk farkını tolere eder', async () => {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const view = await lookupOrderByEmail(r.order.orderNo, `  ${GUEST_EMAIL.toUpperCase()} `)
    expect(view.orderNo).toBe(r.order.orderNo)
  })

  it('YANLIŞ e-posta ile erişilemez', async () => {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    await expect(lookupOrderByEmail(r.order.orderNo, 'baskasi@ornek.test')).rejects.toThrowError(
      OrderAccessDeniedError,
    )
  })

  it('YOK OLAN sipariş ile YANLIŞ e-posta AYNI hatayı verir (enumeration engeli)', async () => {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })

    const wrongEmail = await lookupOrderByEmail(r.order.orderNo, 'yok@ornek.test').catch((e) => e)
    const noSuchOrder = await lookupOrderByEmail('M333-ZZZZZZZZ', GUEST_EMAIL).catch((e) => e)

    expect(wrongEmail).toBeInstanceOf(OrderAccessDeniedError)
    expect(noSuchOrder).toBeInstanceOf(OrderAccessDeniedError)
    // Mesaj ve kod BİREBİR aynı — cevaptan sipariş varlığı çıkarılamaz
    expect(wrongEmail.message).toBe(noSuchOrder.message)
    expect(wrongEmail.code).toBe(noSuchOrder.code)
  })

  it('takip token\'ı ile görüntülenir; yanlış token reddedilir', async () => {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const view = await lookupOrderByToken(r.order.orderNo, r.accessToken!)
    expect(view.orderNo).toBe(r.order.orderNo)

    await expect(lookupOrderByToken(r.order.orderNo, 'sahte-token')).rejects.toThrowError(
      OrderAccessDeniedError,
    )
  })

  it('süresi dolmuş token reddedilir', async () => {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    await db.order.update({
      where: { id: r.order.id },
      data: { accessExpiresAt: new Date(Date.now() - 1000) },
    })
    await expect(lookupOrderByToken(r.order.orderNo, r.accessToken!)).rejects.toThrowError(
      OrderAccessDeniedError,
    )
  })

  it('PII MİNİMİZASYONU: public görünümde ad, telefon ve tam e-posta YOKTUR', async () => {
    const r = await createOrder(baseInput({ guestPhone: '05551112233' }), {
      ...CTX,
      idempotencyKey: nextKey(),
    })
    const view = await lookupOrderByEmail(r.order.orderNo, GUEST_EMAIL)
    const json = JSON.stringify(view)

    expect(json).not.toContain('Ayşe')
    expect(json).not.toContain('Yılmaz')
    expect(json).not.toContain('05551112233')
    expect(json).not.toContain(GUEST_EMAIL)
    expect(json).not.toContain('iphash-test')
    // Maskeli e-posta doğru siparişte olduğunu teyit için vardır
    expect(view.maskedEmail).toMatch(/^mi.*@ornek\.test$/)
  })
})

// ---------------------------------------------------------------------------
describe('IDOR koruması', () => {
  it('başka kullanıcının siparişi oturum üzerinden görülemez', async () => {
    const r = await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const other = await db.user.create({
      data: { email: 'baska-kullanici@ornek.test' },
      select: { id: true },
    })

    await expect(getOrderForUser(r.order.orderNo, other.id)).rejects.toThrowError(
      OrderAccessDeniedError,
    )

    const owner = await db.order.findUniqueOrThrow({ where: { id: r.order.id } })
    const view = await getOrderForUser(r.order.orderNo, owner.userId)
    expect(view.orderNo).toBe(r.order.orderNo)
  })
})

// ---------------------------------------------------------------------------
describe('misafir siparişini hesaba bağlama', () => {
  it('YALNIZCA e-posta eşleşmesi YETMEZ — doğrulama veya token gerekir', async () => {
    await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const shadow = await db.user.findUniqueOrThrow({ where: { email: GUEST_EMAIL } })
    expect(shadow.isGuest).toBe(true)

    // Doğrulanmamış e-posta + token yok → reddedilir
    await expect(claimGuestOrders({ userId: shadow.id })).rejects.toThrowError(ClaimError)
  })

  it('doğrulanmış e-posta ile devralınır', async () => {
    await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const shadow = await db.user.findUniqueOrThrow({ where: { email: GUEST_EMAIL } })
    await db.user.update({ where: { id: shadow.id }, data: { emailVerified: new Date() } })

    const res = await claimGuestOrders({ userId: shadow.id })
    expect(res.method).toBe('verified_email')
    expect(res.claimedOrders).toBe(1)
    expect((await db.user.findUniqueOrThrow({ where: { id: shadow.id } })).isGuest).toBe(false)
  })

  it('geçerli claim token ile devralınır ve token TEK KULLANIMLIKTIR', async () => {
    await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const shadow = await db.user.findUniqueOrThrow({ where: { email: GUEST_EMAIL } })
    const token = await issueClaimToken(shadow.id, GUEST_EMAIL)

    const res = await claimGuestOrders({ userId: shadow.id, token })
    expect(res.method).toBe('claim_token')

    // İkinci kullanım reddedilir
    await expect(claimGuestOrders({ userId: shadow.id, token })).rejects.toThrowError(ClaimError)
  })

  it('BAŞKASININ token\'ı kabul edilmez', async () => {
    await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const shadow = await db.user.findUniqueOrThrow({ where: { email: GUEST_EMAIL } })
    const attacker = await db.user.create({
      data: { email: 'saldirgan@ornek.test' },
      select: { id: true },
    })
    const token = await issueClaimToken(shadow.id, GUEST_EMAIL)

    await expect(claimGuestOrders({ userId: attacker.id, token })).rejects.toThrowError(ClaimError)
  })

  it('süresi dolmuş token reddedilir', async () => {
    await createOrder(baseInput(), { ...CTX, idempotencyKey: nextKey() })
    const shadow = await db.user.findUniqueOrThrow({ where: { email: GUEST_EMAIL } })
    const token = await issueClaimToken(shadow.id, GUEST_EMAIL)
    await db.guestClaimToken.updateMany({
      where: { userId: shadow.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await expect(claimGuestOrders({ userId: shadow.id, token })).rejects.toThrowError(ClaimError)
  })
})

// ---------------------------------------------------------------------------
describe('denetim kaydı (audit)', () => {
  it('durum değişikliği audit\'e yazılır ve PII İÇERMEZ', async () => {
    const r = await createOrder(baseInput({ guestPhone: '05551112233' }), {
      ...CTX,
      idempotencyKey: nextKey(),
    })
    await adminTransitionOrder({
      orderNoOrId: r.order.orderNo,
      to: 'CANCELLED',
      actorId: adminId,
      reason: 'test',
    })

    const logs = await db.auditLog.findMany({ where: { entityId: r.order.id } })
    expect(logs.length).toBeGreaterThan(0)
    const json = JSON.stringify(logs)
    expect(json).not.toContain('Ayşe')
    expect(json).not.toContain('05551112233')
    expect(json).not.toContain(GUEST_EMAIL)
  })
})
