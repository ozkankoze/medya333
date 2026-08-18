import 'server-only'

import Redis from 'ioredis'
import { env } from '@/env'

/**
 * REDIS BAĞLANTISI
 *
 * Üretimde rate limit ve katalog cache buradan geçer.
 *
 * ÜRETİM KURALI: `REDIS_URL` yoksa uygulama AÇILMAZ (bkz. assertRedisInProduction).
 * Bellek-içi rate limit tek süreçlik olduğu için çok örnekli üretimde
 * koruma sağlamaz — sessizce buna düşmek güvenlik açığıdır.
 *
 * Geliştirme/test ortamında Redis yoksa kontrollü şekilde bellek-içi
 * uygulamaya düşülür ve konsola tek seferlik uyarı basılır.
 */

const globalForRedis = globalThis as unknown as {
  redis?: Redis | null
  redisWarned?: boolean
}

export class RedisRequiredError extends Error {
  constructor() {
    super(
      'REDIS_URL tanımlı değil. Üretimde rate limit ve cache için Redis zorunludur; ' +
        'bellek-içi fallback yalnızca development/test ortamında kullanılabilir.',
    )
    this.name = 'RedisRequiredError'
  }
}

/** Üretimde Redis yoksa boot'ta patlat. */
export function assertRedisInProduction(): void {
  if (env.NODE_ENV === 'production' && !env.REDIS_URL) throw new RedisRequiredError()
}

export function getRedis(): Redis | null {
  if (globalForRedis.redis !== undefined) return globalForRedis.redis

  if (!env.REDIS_URL) {
    assertRedisInProduction()
    if (!globalForRedis.redisWarned) {
      globalForRedis.redisWarned = true
      console.warn(
        '[redis] REDIS_URL yok — bellek-içi rate limit/cache kullanılıyor. ' +
          'Bu YALNIZCA development/test için kabul edilebilir.',
      )
    }
    globalForRedis.redis = null
    return null
  }

  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: 2_000,
    /**
     * Offline kuyruğu AÇIK: bağlantı kurulmadan gelen ilk istekler (boot anı,
     * kısa kopmalar) düşmez, kuyruğa alınır.
     * `commandTimeout` ile de kesinti anında sonsuza kadar beklenmez —
     * çağıran katman 1 sn içinde hata alır ve kendi yedeğine geçer.
     */
    enableOfflineQueue: true,
    commandTimeout: 1_000,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  })

  client.on('error', (err) => {
    // Bağlantı hatası uygulamayı düşürmez; çağıranlar null/hata durumunu ele alır.
    console.error('[redis] hata:', err.message)
  })

  globalForRedis.redis = client
  return client
}

export function isRedisEnabled(): boolean {
  return Boolean(env.REDIS_URL)
}

/** Testlerde bağlantıyı kapatmak için. */
export async function closeRedis(): Promise<void> {
  const client = globalForRedis.redis
  if (client) await client.quit().catch(() => undefined)
  globalForRedis.redis = undefined
}
