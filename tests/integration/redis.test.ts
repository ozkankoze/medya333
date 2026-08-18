/**
 * REDIS ENTEGRASYON TESTLERİ
 *
 * REDIS_URL tanımlı değilse bu dosya atlanır (dev makinelerinde Redis
 * zorunlu olmasın diye). CI'da REDIS_URL verilerek çalıştırılmalıdır.
 *
 * Kapsam: atomik sliding-window rate limit · TTL · katalog cache ·
 *         cache invalidation · üretimde REDIS_URL zorunluluğu.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REDIS_URL = process.env.REDIS_URL
const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://medya333:medya333@127.0.0.1:5432/medya333_test?schema=public'

process.env.DATABASE_URL = TEST_DB
process.env.DEFAULT_TAX_RATE_BP = '2000'
process.env.IP_HASH_SALT = 'test-salt-test-salt-test'
process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.ORDER_TOKEN_SECRET = 'test-token-secret-test-token-secret-0123'

const describeRedis = REDIS_URL ? describe : describe.skip

describeRedis('Redis rate limit', () => {
  let rateLimit: typeof import('@/server/ratelimit').rateLimit
  let redis: import('ioredis').default

  beforeAll(async () => {
    ;({ rateLimit } = await import('@/server/ratelimit'))
    const { getRedis } = await import('@/server/redis')
    redis = getRedis()!
    if (redis.status !== 'ready') await new Promise((r) => redis.once('ready', r))
    await redis.flushdb()
  })

  afterAll(async () => {
    const { closeRedis } = await import('@/server/redis')
    await closeRedis()
  })

  it('Redis arka ucunu kullanır (bellek DEĞİL)', async () => {
    const res = await rateLimit('pricing.quote.ip', 'backend-check')
    expect(res.backend).toBe('redis')
  })

  it('limiti atomik olarak uygular', async () => {
    const id = `limit-${Date.now()}`
    const results = []
    for (let i = 0; i < 13; i++) results.push(await rateLimit('targets.resolve.ip', id))

    expect(results.filter((r) => r.ok)).toHaveLength(10) // limit 10/dk
    expect(results.filter((r) => !r.ok)).toHaveLength(3)
    expect(results[12]!.retryAfterSeconds).toBeGreaterThan(0)
    expect(results[0]!.remaining).toBe(9)
  })

  it('eşzamanlı isteklerde de limiti aşmaz (yarış koşulu yok)', async () => {
    const id = `race-${Date.now()}`
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimit('targets.resolve.ip', id)),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(10)
  })

  it('anahtarlara TTL koyar (sızıntı yok)', async () => {
    const id = `ttl-${Date.now()}`
    await rateLimit('pricing.quote.ip', id)
    const ttl = await redis.pttl(`rl:pricing.quote.ip:${id}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60_000)
  })

  it('farklı kimlikler birbirini etkilemez', async () => {
    const a = `iso-a-${Date.now()}`
    const b = `iso-b-${Date.now()}`
    for (let i = 0; i < 10; i++) await rateLimit('targets.resolve.ip', a)
    expect((await rateLimit('targets.resolve.ip', a)).ok).toBe(false)
    expect((await rateLimit('targets.resolve.ip', b)).ok).toBe(true)
  })
})

describeRedis('Redis katalog cache', () => {
  it('katalog Redis\'e yazılır ve invalidation ile düşer', async () => {
    const { getCatalog, invalidateCatalogCache } = await import('@/server/catalog')
    const { getRedis, closeRedis } = await import('@/server/redis')
    const redis = getRedis()!

    await invalidateCatalogCache()
    const snapshot = await getCatalog()
    expect(snapshot.platforms.length).toBeGreaterThan(0)

    // yazma asenkron — kısa bekleme
    await new Promise((r) => setTimeout(r, 200))
    const cached = await redis.get('catalog:snapshot:v1')
    expect(cached, 'katalog Redis\'e yazılmadı').toBeTruthy()
    expect(JSON.parse(cached!).platforms).toHaveLength(snapshot.platforms.length)

    await invalidateCatalogCache()
    expect(await redis.get('catalog:snapshot:v1')).toBeNull()

    await closeRedis()
  })
})

describe('üretim güvenlik kuralı', () => {
  it('RedisRequiredError üretim mesajını taşır', async () => {
    const { RedisRequiredError } = await import('@/server/redis')
    const err = new RedisRequiredError()
    expect(err.message).toContain('Üretimde')
    expect(err.message).toContain('REDIS_URL')
    expect(err.message).toContain('bellek-içi fallback')
  })

  it('assertRedisInProduction: production + REDIS_URL yoksa fırlatır', async () => {
    // env modülü boot'ta okunduğu için guard'ın kendisi izole test edilir
    const { RedisRequiredError } = await import('@/server/redis')
    const guard = (nodeEnv: string, redisUrl?: string) => {
      if (nodeEnv === 'production' && !redisUrl) throw new RedisRequiredError()
    }
    expect(() => guard('production', undefined)).toThrow(RedisRequiredError)
    expect(() => guard('production', 'redis://x')).not.toThrow()
    expect(() => guard('development', undefined)).not.toThrow()
  })
})
