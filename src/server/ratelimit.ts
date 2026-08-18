import 'server-only'

import { createHash } from 'node:crypto'
import { env } from '@/env'
import { getRedis, isRedisEnabled, RedisRequiredError } from './redis'

/**
 * RATE LIMITING — sliding window
 *
 * ÜRETİM: Redis (atomik, çok örnekli dağıtımda doğru çalışır).
 * DEV/TEST: Redis yoksa bellek-içi fallback + uyarı.
 *
 * `src/server/redis.ts` üretimde REDIS_URL yoksa boot'ta hata fırlatır, bu
 * yüzden üretimde bellek-içi yola DÜŞÜLEMEZ.
 *
 * Arayüz Faz 0'dakiyle birebir aynı — çağıran kodun tek satırı değişmedi.
 */

export const RATE_LIMITS = {
  'targets.resolve.ip': { limit: 10, windowMs: 60_000 },
  'targets.resolve.user': { limit: 30, windowMs: 60_000 },
  'pricing.quote.ip': { limit: 30, windowMs: 60_000 },
  'coupons.validate.ip': { limit: 10, windowMs: 60_000 },
  'orders.create.ip': { limit: 5, windowMs: 60_000 },
  'orders.create.user': { limit: 20, windowMs: 3_600_000 },
  'orders.lookup.ip': { limit: 5, windowMs: 3_600_000 },
  /** Aynı sipariş numarasına yapılan denemeler — e-posta tahmini (brute force) engeli */
  'orders.lookup.orderNo': { limit: 5, windowMs: 3_600_000 },
  /** Takip linki yeniden gönderimi — e-posta bombardımanı engeli */
  'orders.sendlink.ip': { limit: 3, windowMs: 3_600_000 },
  'orders.sendlink.orderNo': { limit: 3, windowMs: 3_600_000 },
  'orders.claim.user': { limit: 5, windowMs: 3_600_000 },
  'orders.detail.ip': { limit: 60, windowMs: 60_000 },
  'payments.init.order': { limit: 5, windowMs: 60_000 },
  'auth.login.ip': { limit: 5, windowMs: 60_000 },
  'auth.register.ip': { limit: 3, windowMs: 3_600_000 },
  'media.proxy.ip': { limit: 60, windowMs: 60_000 },
  'admin.api.user': { limit: 100, windowMs: 60_000 },
  'catalog.read.ip': { limit: 120, windowMs: 60_000 },
} as const

export type RateLimitKey = keyof typeof RATE_LIMITS

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
  backend: 'redis' | 'memory'
}

// ---------------------------------------------------------------------------
// Redis: sorted-set sliding window, tek atomik Lua scriptiyle
// ---------------------------------------------------------------------------

const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = now + window
  if oldest[2] then resetAt = tonumber(oldest[2]) + window end
  return { 0, 0, resetAt }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return { 1, limit - count - 1, now + window }
`

let scriptLoaded = false

async function redisRateLimit(
  key: RateLimitKey,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    if (!scriptLoaded) {
      // ioredis defineCommand: script bir kez yüklenir, sonra EVALSHA kullanılır
      if (!(redis as unknown as Record<string, unknown>).slidingWindow) {
        redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA })
      }
      scriptLoaded = true
    }

    const now = Date.now()
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`
    const res = (await (
      redis as unknown as {
        slidingWindow: (k: string, ...a: (string | number)[]) => Promise<[number, number, number]>
      }
    ).slidingWindow(`rl:${key}:${identifier}`, now, windowMs, limit, member)) as [
      number,
      number,
      number,
    ]

    const [allowed, remaining, resetAt] = res
    return {
      ok: allowed === 1,
      limit,
      remaining: Number(remaining),
      resetAt: Number(resetAt),
      retryAfterSeconds: allowed === 1 ? 0 : Math.max(1, Math.ceil((Number(resetAt) - now) / 1000)),
      backend: 'redis',
    }
  } catch (err) {
    console.error('[ratelimit] Redis hatası, bellek-içi yedeğe düşülüyor:', (err as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Bellek-içi yedek (yalnızca dev/test)
// ---------------------------------------------------------------------------

const buckets = new Map<string, number[]>()
let lastSweep = 0

function memoryRateLimit(
  key: RateLimitKey,
  identifier: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  if (now - lastSweep > 60_000) {
    lastSweep = now
    for (const [k, hits] of buckets) {
      if (hits.length === 0 || now - hits[hits.length - 1]! > 3_600_000) buckets.delete(k)
    }
  }

  const bucketKey = `${key}:${identifier}`
  const hits = (buckets.get(bucketKey) ?? []).filter((t) => now - t < windowMs)

  if (hits.length >= limit) {
    const resetAt = hits[0]! + windowMs
    buckets.set(bucketKey, hits)
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      backend: 'memory',
    }
  }

  hits.push(now)
  buckets.set(bucketKey, hits)
  return {
    ok: true,
    limit,
    remaining: limit - hits.length,
    resetAt: now + windowMs,
    retryAfterSeconds: 0,
    backend: 'memory',
  }
}

// ---------------------------------------------------------------------------

export async function rateLimit(key: RateLimitKey, identifier: string): Promise<RateLimitResult> {
  const { limit, windowMs } = RATE_LIMITS[key]

  // Üretimde REDIS_URL yoksa burada patlar; çağıran katman bunu 503 +
  // anlaşılır mesaja çevirir (opak 500 yerine).
  if (!isRedisEnabled() && env.NODE_ENV === 'production') throw new RedisRequiredError()

  if (isRedisEnabled()) {
    const res = await redisRateLimit(key, identifier, limit, windowMs)
    if (res) return res
    // Redis erişilemiyorsa üretimde AÇILMAYA izin verme: fail-closed.
    if (env.NODE_ENV === 'production') {
      return {
        ok: false,
        limit,
        remaining: 0,
        resetAt: Date.now() + windowMs,
        retryAfterSeconds: 5,
        backend: 'redis',
      }
    }
  }

  return memoryRateLimit(key, identifier, limit, windowMs)
}

/** Testlerde sayaçları sıfırlamak için. */
export function resetMemoryRateLimits(): void {
  buckets.clear()
}

/** Rate limit sonucunu standart HTTP başlıklarına çevirir. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(Math.ceil(r.resetAt / 1000)),
  }
  if (!r.ok) headers['Retry-After'] = String(r.retryAfterSeconds)
  return headers
}

// ---------------------------------------------------------------------------
// İstemci kimliği — ham IP HİÇBİR YERDE saklanmaz (KVKK)
// ---------------------------------------------------------------------------

export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? 'unknown'
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`${env.IP_HASH_SALT}:${ip}`).digest('hex').slice(0, 32)
}

export function rateLimitIdentifier(headers: Headers): string {
  return hashIp(clientIpFrom(headers))
}
