/**
 * FAZ 2 — SİPARİŞ API GÜVENLİK TESTLERİ (gerçek route handler'ları)
 *
 * Kapsam:
 *   • Idempotency-Key zorunluluğu ve davranışı
 *   • CSRF (Origin doğrulaması)
 *   • Gövde boyutu sınırı
 *   • Zod doğrulama + zorunlu onaylar
 *   • Rate limit (IP + sipariş numarası başına brute-force)
 *   • Sipariş numarası TEK BAŞINA erişim sağlamaz
 *   • send-link cevabı her durumda AYNI (oracle yok)
 *   • Admin: SUPPORT okur, OPERATOR durum değiştirir, ödeme öncesi işleme YOK
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
    checkPasswordStrength: (p: string) =>
      p.length >= 10 ? { ok: true } : { ok: false, reason: 'Şifre en az 10 karakter olmalıdır.' },
    hashPassword: async (p: string) => `hashed:${p}`,
  }
})

import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import { setupTestDatabase, truncateTransactional, type TestDatabase } from './db-setup'
import { resetMemoryRateLimits } from '@/server/ratelimit'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number

let ordersPOST: (req: any) => Promise<Response>
let lookupPOST: (req: any) => Promise<Response>
let detailGET: (req: any, c: any) => Promise<Response>
let sendLinkPOST: (req: any, c: any) => Promise<Response>
let adminOrdersGET: (req: any) => Promise<Response>
let adminStatusPOST: (req: any, c: any) => Promise<Response>

let ipSeq = 0
function ip() {
  ipSeq++
  return `10.${Math.floor(ipSeq / 60000) % 250}.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}`
}

function makeReq(url: string, body?: unknown, headers: Record<string, string> = {}) {
  const { NextRequest } = require('next/server')
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip(),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

let keySeq = 0
const key = () => `api-idem-key-${Date.now()}-${++keySeq}-padded`

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

function orderBody(targetId: string, over: Record<string, unknown> = {}) {
  return {
    serviceVariantId: variantId,
    quantity: qty,
    targetId,
    targetConfirmed: true,
    customerFirstName: 'Mehmet',
    customerLastName: 'Demir',
    guestEmail: 'api-misafir@ornek.test',
    acceptedTerms: true,
    acceptedRefund: true,
    acceptedPrivacy: true,
    ...over,
  }
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
    ['faz2-support@roles.test', 'SUPPORT'],
    ['faz2-operator@roles.test', 'OPERATOR'],
    ['faz2-customer@roles.test', 'CUSTOMER'],
  ] as const) {
    await db.user.upsert({
      where: { email },
      update: { role },
      create: { email, role },
    })
  }
  ;({ POST: ordersPOST } = await import('@/app/api/v1/orders/route'))
  ;({ POST: lookupPOST } = await import('@/app/api/v1/orders/lookup/route'))
  ;({ GET: detailGET } = await import('@/app/api/v1/orders/[orderNo]/route'))
  ;({ POST: sendLinkPOST } = await import('@/app/api/v1/orders/[orderNo]/send-link/route'))
  ;({ GET: adminOrdersGET } = await import('@/app/api/v1/admin/orders/route'))
  ;({ POST: adminStatusPOST } = await import('@/app/api/v1/admin/orders/[orderNo]/status/route'))
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

async function createViaApi(over: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const targetId = await makeTarget()
  const res = await ordersPOST(
    makeReq('http://localhost/api/v1/orders', orderBody(targetId, over), {
      'idempotency-key': key(),
      ...headers,
    }),
  )
  return { res, json: await res.json() }
}

// ---------------------------------------------------------------------------
describe('POST /api/v1/orders', () => {
  it('201 döner, sipariş numarası ve ödeme bekleyen durum verir', async () => {
    const { res, json } = await createViaApi()
    expect(res.status).toBe(201)
    expect(json.orderNo).toMatch(/^M333-[0-9A-HJKMNP-TV-Z]{8}$/)
    expect(json.status).toBe('PENDING_PAYMENT')
    expect(json.trackingToken).toBeTruthy()
  })

  it('cevapta iç kimlik (id) ve fiyat detayları SIZMAZ', async () => {
    const { json } = await createViaApi()
    expect(json.id).toBeUndefined()
    expect(json.userId).toBeUndefined()
    expect(json.accessTokenHash).toBeUndefined()
  })

  it('Idempotency-Key başlığı YOKSA 400', async () => {
    const targetId = await makeTarget()
    const res = await ordersPOST(
      makeReq('http://localhost/api/v1/orders', orderBody(targetId)),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('çok kısa / geçersiz Idempotency-Key reddedilir', async () => {
    const targetId = await makeTarget()
    const res = await ordersPOST(
      makeReq('http://localhost/api/v1/orders', orderBody(targetId), { 'idempotency-key': 'kisa' }),
    )
    expect(res.status).toBe(400)
  })

  it('aynı key ile ikinci istek YENİ SİPARİŞ AÇMAZ (200 + reused)', async () => {
    const targetId = await makeTarget()
    const k = key()
    const body = orderBody(targetId)
    const first = await ordersPOST(
      makeReq('http://localhost/api/v1/orders', body, { 'idempotency-key': k }),
    )
    const second = await ordersPOST(
      makeReq('http://localhost/api/v1/orders', body, { 'idempotency-key': k }),
    )
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    const a = await first.json()
    const b = await second.json()
    expect(b.orderNo).toBe(a.orderNo)
    expect(b.reused).toBe(true)
    expect(b.trackingToken).toBeNull()
    expect(await db.order.count()).toBe(1)
  })

  it('aynı key + farklı gövde → 409', async () => {
    const targetId = await makeTarget()
    const k = key()
    await ordersPOST(
      makeReq('http://localhost/api/v1/orders', orderBody(targetId), { 'idempotency-key': k }),
    )
    const res = await ordersPOST(
      makeReq('http://localhost/api/v1/orders', orderBody(targetId, { quantity: qty * 2 }), {
        'idempotency-key': k,
      }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('istemci fiyatı uyuşmuyorsa 409 PRICE_CHANGED', async () => {
    const { res, json } = await createViaApi({ clientTotalMinor: 1 })
    expect(res.status).toBe(409)
    expect(json.error.code).toBe('PRICE_CHANGED')
    expect(json.error.message).toBe('Fiyat güncellendi. Lütfen sipariş özetini kontrol edin.')
  })

  it('ONAY EKSİKSE sipariş oluşmaz', async () => {
    for (const missing of ['acceptedTerms', 'acceptedRefund', 'acceptedPrivacy']) {
      const { res, json } = await createViaApi({ [missing]: false })
      expect(res.status, missing).toBe(400)
      expect(json.error.details[missing], missing).toBeTruthy()
    }
    expect(await db.order.count()).toBe(0)
  })

  it('İSTEMCİ FİYAT ALANLARI şemaya girmez (unitPrice/subtotal/total yok sayılır)', async () => {
    const { res, json } = await createViaApi({
      unitPriceMinor: 1,
      subtotalMinor: 1,
      totalMinor: 1,
      taxAmountMinor: 0,
    })
    expect(res.status).toBe(201)
    const order = await db.order.findUniqueOrThrow({ where: { orderNo: json.orderNo } })
    expect(order.totalMinor).toBeGreaterThan(1)
    expect(order.unitPriceMinor).toBeGreaterThan(1)
  })

  it('CSRF: yabancı Origin reddedilir', async () => {
    const targetId = await makeTarget()
    const res = await ordersPOST(
      makeReq('http://localhost/api/v1/orders', orderBody(targetId), {
        'idempotency-key': key(),
        origin: 'https://kotu-site.example',
      }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('CSRF_BLOCKED')
  })

  it('CSRF: kendi Origin\'imiz kabul edilir', async () => {
    const targetId = await makeTarget()
    const res = await ordersPOST(
      makeReq('http://localhost/api/v1/orders', orderBody(targetId), {
        'idempotency-key': key(),
        origin: 'http://localhost:3000',
      }),
    )
    expect(res.status).toBe(201)
  })

  it('büyük gövde 413 ile reddedilir', async () => {
    const targetId = await makeTarget()
    const res = await ordersPOST(
      makeReq(
        'http://localhost/api/v1/orders',
        orderBody(targetId, { customerNote: 'x'.repeat(80_000) }),
        { 'idempotency-key': key() },
      ),
    )
    expect(res.status).toBe(413)
  })

  it('IP başına rate limit uygulanır', async () => {
    const fixedIp = { 'x-forwarded-for': '203.0.113.99' }
    let limited = false
    for (let i = 0; i < 8; i++) {
      const targetId = await makeTarget()
      const res = await ordersPOST(
        makeReq('http://localhost/api/v1/orders', orderBody(targetId), {
          'idempotency-key': key(),
          ...fixedIp,
        }),
      )
      if (res.status === 429) {
        limited = true
        expect(res.headers.get('Retry-After')).toBeTruthy()
        break
      }
    }
    expect(limited).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('POST /api/v1/orders/lookup', () => {
  it('doğru orderNo + e-posta ile sipariş döner', async () => {
    const { json: created } = await createViaApi()
    const res = await lookupPOST(
      makeReq('http://localhost/api/v1/orders/lookup', {
        orderNo: created.orderNo,
        email: 'api-misafir@ornek.test',
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).orderNo).toBe(created.orderNo)
  })

  it('yanlış e-posta ve olmayan sipariş AYNI cevabı verir', async () => {
    const { json: created } = await createViaApi()

    const wrong = await lookupPOST(
      makeReq('http://localhost/api/v1/orders/lookup', {
        orderNo: created.orderNo,
        email: 'yanlis@ornek.test',
      }),
    )
    const missing = await lookupPOST(
      makeReq('http://localhost/api/v1/orders/lookup', {
        orderNo: 'M333-ZZZZZZZZ',
        email: 'api-misafir@ornek.test',
      }),
    )

    expect(wrong.status).toBe(missing.status)
    expect(await wrong.json()).toEqual(await missing.json())
  })

  it('AYNI sipariş numarasına brute force IP değişse bile durdurulur', async () => {
    const { json: created } = await createViaApi()

    let blocked = false
    for (let i = 0; i < 10; i++) {
      const res = await lookupPOST(
        makeReq('http://localhost/api/v1/orders/lookup', {
          orderNo: created.orderNo,
          email: `deneme${i}@ornek.test`,
        }),
      )
      if (res.status === 429) {
        blocked = true
        break
      }
    }
    expect(blocked).toBe(true)
  })

  it('geçersiz sipariş numarası biçimi 400', async () => {
    const res = await lookupPOST(
      makeReq('http://localhost/api/v1/orders/lookup', {
        orderNo: 'ABC-123',
        email: 'a@b.test',
      }),
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
describe('GET /api/v1/orders/[orderNo]', () => {
  it('SİPARİŞ NUMARASI TEK BAŞINA YETMEZ → 404', async () => {
    const { json: created } = await createViaApi()
    const res = await detailGET(makeReq(`http://localhost/api/v1/orders/${created.orderNo}`), {
      params: Promise.resolve({ orderNo: created.orderNo }),
    })
    expect(res.status).toBe(404)
  })

  it('takip token\'ı ile erişilir', async () => {
    const { json: created } = await createViaApi()
    const res = await detailGET(
      makeReq(
        `http://localhost/api/v1/orders/${created.orderNo}?t=${encodeURIComponent(created.trackingToken)}`,
      ),
      { params: Promise.resolve({ orderNo: created.orderNo }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).orderNo).toBe(created.orderNo)
  })

  it('BAŞKA kullanıcının oturumu ile 404 (IDOR)', async () => {
    const { json: created } = await createViaApi()
    const other = await db.user.create({
      data: { email: 'digeri@ornek.test' },
      select: { id: true, email: true },
    })
    session.user = { id: other.id, email: other.email, name: null, role: 'CUSTOMER', isGuest: false }

    const res = await detailGET(makeReq(`http://localhost/api/v1/orders/${created.orderNo}`), {
      params: Promise.resolve({ orderNo: created.orderNo }),
    })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
describe('POST /api/v1/orders/[orderNo]/send-link', () => {
  it('sipariş olmasa da AYNI cevabı verir (oracle yok)', async () => {
    const real = await createViaApi()
    const ok = await sendLinkPOST(
      makeReq(`http://localhost/api/v1/orders/${real.json.orderNo}/send-link`, {
        email: 'api-misafir@ornek.test',
      }),
      { params: Promise.resolve({ orderNo: real.json.orderNo }) },
    )
    const fake = await sendLinkPOST(
      makeReq('http://localhost/api/v1/orders/M333-ZZZZZZZZ/send-link', {
        email: 'api-misafir@ornek.test',
      }),
      { params: Promise.resolve({ orderNo: 'M333-ZZZZZZZZ' }) },
    )
    expect(ok.status).toBe(fake.status)
    expect((await ok.json()).sent).toBe(true)
    expect((await fake.json()).sent).toBe(true)
  })

  it('takip token\'ı cevapta DÖNMEZ', async () => {
    const real = await createViaApi()
    const res = await sendLinkPOST(
      makeReq(`http://localhost/api/v1/orders/${real.json.orderNo}/send-link`, {
        email: 'api-misafir@ornek.test',
      }),
      { params: Promise.resolve({ orderNo: real.json.orderNo }) },
    )
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain('token')
  })
})

// ---------------------------------------------------------------------------
describe('admin sipariş uçları', () => {
  async function asRole(role: string) {
    const user = await db.user.findFirstOrThrow({ where: { role: role as never } })
    session.user = { id: user.id, email: user.email, name: null, role, isGuest: false }
  }

  it('oturumsuz erişim 401', async () => {
    const res = await adminOrdersGET(makeReq('http://localhost/api/v1/admin/orders'))
    expect(res.status).toBe(401)
  })

  it('CUSTOMER rolü 403 alır', async () => {
    await asRole('CUSTOMER')
    const res = await adminOrdersGET(makeReq('http://localhost/api/v1/admin/orders'))
    expect(res.status).toBe(403)
  })

  it('SUPPORT listeyi görür ama durum DEĞİŞTİREMEZ', async () => {
    const { json: created } = await createViaApi()
    await asRole('SUPPORT')

    const list = await adminOrdersGET(makeReq('http://localhost/api/v1/admin/orders?queue=all'))
    expect(list.status).toBe(200)

    const change = await adminStatusPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${created.orderNo}/status`, {
        status: 'CANCELLED',
      }),
      { params: Promise.resolve({ orderNo: created.orderNo }) },
    )
    expect(change.status).toBe(403)
  })

  it('OPERATOR ödeme bekleyen siparişi İPTAL edebilir', async () => {
    const { json: created } = await createViaApi()
    await asRole('OPERATOR')
    const res = await adminStatusPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${created.orderNo}/status`, {
        status: 'CANCELLED',
        reason: 'Müşteri talebi',
      }),
      { params: Promise.resolve({ orderNo: created.orderNo }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).to).toBe('CANCELLED')
  })

  it('OPERATOR ödeme alınmadan İŞLEME ALAMAZ → 409', async () => {
    const { json: created } = await createViaApi()
    await asRole('OPERATOR')
    const res = await adminStatusPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${created.orderNo}/status`, {
        status: 'PROCESSING',
      }),
      { params: Promise.resolve({ orderNo: created.orderNo }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('FULFILLMENT_BEFORE_PAYMENT')
  })

  it('varsayılan kuyruk ödeme bekleyenleri İÇERMEZ', async () => {
    await createViaApi()
    await asRole('SUPPORT')
    const res = await adminOrdersGET(makeReq('http://localhost/api/v1/admin/orders'))
    const json = await res.json()
    expect(json.queue).toBe('active')
    expect(json.orders).toHaveLength(0)
    expect(json.queueCounts.awaiting_payment).toBe(1)
  })

  it('geçersiz durum değeri 400', async () => {
    const { json: created } = await createViaApi()
    await asRole('OPERATOR')
    const res = await adminStatusPOST(
      makeReq(`http://localhost/api/v1/admin/orders/${created.orderNo}/status`, {
        status: 'HACKED',
      }),
      { params: Promise.resolve({ orderNo: created.orderNo }) },
    )
    expect(res.status).toBe(400)
  })
})
