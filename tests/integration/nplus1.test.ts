/**
 * ⭐ N+1 SORGU ÖLÇÜMÜ (Faz 10)
 *
 * "Bu ekranda N+1 yok" bir iddiadır; burada ÖLÇÜLÜR.
 *
 * YÖNTEM: aynı işlem önce az kayıtla, sonra kat kat fazla kayıtla çalıştırılır.
 * Sorgu sayısı kayıt sayısıyla birlikte artıyorsa N+1 vardır. Sabit kalıyorsa
 * yoktur — ve bu, gelecekte birinin `include` yerine döngü içinde sorgu
 * yazmasına karşı kalıcı bir kilittir.
 *
 * ⚠️ Eşikler "1 sorgu" gibi keyfi sayılar DEĞİLDİR. Prisma bir ilişkili
 * `select` için birden fazla sorgu üretebilir; önemli olan sayının SABİT
 * kalmasıdır. Bu yüzden test mutlak sayı değil, BÜYÜME ölçer.
 *
 * ⚠️ Ölçüm `PRISMA_QUERY_METRICS=1` ile açılır (tests/env-setup.ts).
 *    Kapalıysa `readQueryCount()` null döner ve test AÇIKÇA HATA verir —
 *    sessizce "ölçtüm, sorun yok" demez.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@/generated/prisma/client'
import type { CreateOrderInput } from '@/lib/validation'
/**
 * ⚠️ `appDb` UYGULAMANIN kullandığı singleton'dır; `db` (aşağıda) testin
 * kurduğu ayrı istemcidir. Sayaç YALNIZCA `appDb` üzerinden geçen sorguları
 * görür — ölçüm bu yüzden uygulama fonksiyonları üzerinden yapılır.
 */
import { db as appDb, readQueryCount, resetQueryCount } from '@/server/db'
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
import { listFulfillmentQueue } from '@/server/fulfillment/queue'
import { buildCatalogSnapshot } from '@/server/catalog/snapshot'
import { lookupOrderByEmail } from '@/server/orders/lookup'
import { listOrdersForAdmin } from '@/server/orders/admin'

let ctx: TestDatabase
let db: PrismaClient
let variantId = ''
let platformId = ''
let qty = 0

const VIEWER = { userId: 'olcum-admin', role: 'ADMIN' as const }

let seq = 0
const nextKey = () => `nplus1-key-${Date.now()}-${++seq}-padding`

/** Ölçüm penceresi: bir işlemin ürettiği SQL sorgusu sayısı. */
async function countQueries(fn: () => Promise<unknown>): Promise<number> {
  resetQueryCount()
  await fn()
  // Sorgu olayları mikro-görev sonrasında yayılır; sayaç okunmadan beklenir.
  await new Promise((r) => setTimeout(r, 80))
  const n = readQueryCount()
  if (n === null) throw new Error('ÖLÇÜM KAPALI — PRISMA_QUERY_METRICS=1 gerekli')
  return n
}

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

/** Ödenmiş sipariş — gerçek zincir (sipariş → ödeme → doğrulanmış webhook). */
async function makePaidOrder(index: number) {
  const email = `olcum${index}@ornek.test`
  const targetId = await makeTarget(`olcum_hesap_${index}`)

  const res = await createOrder(
    {
      serviceVariantId: variantId,
      quantity: qty,
      targetId,
      targetConfirmed: true,
      customerFirstName: 'Ölçüm',
      customerLastName: 'Testi',
      guestEmail: email,
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

  const session = await createPaymentForOrder(order.orderNo, {
    userId: order.userId,
    ip: '203.0.113.5',
    ipHash: 'iphash',
    idempotencyKey: nextKey(),
  })
  const payment = await db.payment.findUniqueOrThrow({ where: { id: session.paymentId } })

  const payload = {
    providerRef: payment.providerRef!,
    status: 'success',
    amountMinor: order.totalMinor,
    currency: 'TRY',
    eventId: `nplus1_${payment.providerRef}`,
  }
  await processWebhook('mock', {
    headers: new Headers({
      'content-type': 'application/json',
      'x-mock-signature': computeMockSignature(payload),
    }),
    rawBody: JSON.stringify(payload),
    contentType: 'application/json',
  })

  return { order, email }
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await truncateTransactional(db)
  await seedAll(db)

  const fixture = await pickCatalogVariant(db, { atLeast: 100 })
  variantId = fixture.variantId
  platformId = fixture.platformId
  qty = fixture.quantity
}, 240_000)

afterAll(async () => {
  await ctx?.stop()
})

// ===========================================================================
describe('ölçüm altyapısı', () => {
  it('⚠️ sorgu sayacı GERÇEKTEN çalışıyor — yoksa tüm bu dosya anlamsızdır', async () => {
    const one = await countQueries(() => appDb.platform.findMany())
    expect(one).toBeGreaterThan(0)

    // İki sorgu, tek sorgudan fazla saymalı: sayaç sabit değer döndürmüyor.
    const two = await countQueries(async () => {
      await appDb.platform.findMany()
      await appDb.service.findMany()
    })
    expect(two).toBeGreaterThan(one)
  })
})

// ===========================================================================
describe('⭐ operasyon kuyruğu — N+1 yok', () => {
  it('sorgu sayısı kayıt sayısıyla ARTMAZ (3 → 12 kayıt)', async () => {
    for (let i = 0; i < 3; i++) await makePaidOrder(i)
    const few = await countQueries(() => listFulfillmentQueue({}, VIEWER))

    for (let i = 3; i < 12; i++) await makePaidOrder(i)
    const many = await countQueries(() => listFulfillmentQueue({}, VIEWER))

    // ⚠️ Önce ölçümün gerçek olduğunu doğrula: 0 sorgu, "N+1 yok" demek değil,
    //    "hiçbir şey ölçülmedi" demektir.
    expect(few).toBeGreaterThan(0)

    // 4× kayıt. N+1 olsaydı sorgu sayısı da yaklaşık 4× artardı.
    expect(many, `3 kayıtta ${few} sorgu, 12 kayıtta ${many} sorgu`).toBe(few)
  })

  it('arama filtresi sabit sorgu sayısı üretir', async () => {
    const plain = await countQueries(() => listFulfillmentQueue({}, VIEWER))
    const searched = await countQueries(() => listFulfillmentQueue({ search: 'olcum' }, VIEWER))
    expect(plain).toBeGreaterThan(0)
    expect(searched).toBe(plain)
  })

  it('sayfa boyutu 10 → 100 arasında sorgu sayısı değişmez', async () => {
    const small = await countQueries(() => listFulfillmentQueue({ pageSize: 10 }, VIEWER))
    const large = await countQueries(() => listFulfillmentQueue({ pageSize: 100 }, VIEWER))
    expect(small).toBeGreaterThan(0)
    expect(large).toBe(small)
  })
})

// ===========================================================================
describe('⭐ katalog anlık görüntüsü — N+1 yok', () => {
  it('yüzlerce kayıt TEK HANELİ sayıda sorguyla okunur', async () => {
    const n = await countQueries(() => buildCatalogSnapshot(2000))

    const [platforms, services, variants, tiers] = await Promise.all([
      db.platform.count(),
      db.service.count(),
      db.serviceVariant.count(),
      db.pricingRule.count(),
    ])
    const entities = platforms + services + variants + tiers

    expect(entities).toBeGreaterThan(100)
    expect(n).toBeGreaterThan(0)
    expect(n, `${entities} kayıt için ${n} sorgu`).toBeLessThan(10)
  })

  it('ikinci çağrı aynı sorgu sayısını üretir (gizli birikim yok)', async () => {
    const first = await countQueries(() => buildCatalogSnapshot(2000))
    const second = await countQueries(() => buildCatalogSnapshot(2000))
    expect(second).toBe(first)
  })
})

// ===========================================================================
describe('⭐ sipariş takibi — N+1 yok', () => {
  it('farklı siparişler aynı sorgu sayısını üretir', async () => {
    const a = await makePaidOrder(100)
    const b = await makePaidOrder(101)

    const first = await countQueries(() => lookupOrderByEmail(a.order.orderNo, a.email))
    const second = await countQueries(() => lookupOrderByEmail(b.order.orderNo, b.email))
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(first)
  })
})

// ===========================================================================
describe('⭐ admin sipariş listesi — N+1 yok', () => {
  it('sayfa büyüdükçe sorgu sayısı sabit kalır', async () => {
    const small = await countQueries(() => listOrdersForAdmin({ pageSize: 5 }))
    const large = await countQueries(() => listOrdersForAdmin({ pageSize: 50 }))
    expect(small).toBeGreaterThan(0)
    expect(large).toBe(small)
  })
})
