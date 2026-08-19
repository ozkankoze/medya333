import 'server-only'

import { db } from '@/server/db'
import { getRedis, isRedisEnabled } from '@/server/redis'

/**
 * ⭐ SAĞLIK KONTROLÜ (Faz 8)
 *
 * ⚠️ ÖDEME SAĞLAYICISI BURADA ÇAĞRILMAZ. Sağlık ucu dakikada onlarca kez
 * yoklanır; her yoklamada sağlayıcıya istek atmak hem ücretlendirilebilir hem
 * de sağlayıcı tarafında rate limit yedirir. Ödemenin sağlığı, ödeme
 * denemesinin kendisinden ve webhook kayıtlarından izlenir.
 *
 * ⚠️ HİÇBİR SIR, BAĞLANTI ADRESİ VEYA SÜRÜM BİLGİSİ DÖNMEZ.
 * Sağlık ucu kimlik doğrulaması istemez (load balancer'ın erişmesi gerekir),
 * bu yüzden cevabı gören herkesin görmesinde sakınca olmayan tek şey
 * "çalışıyor / çalışmıyor" bilgisidir. Hata mesajları bile dışarı verilmez;
 * yalnızca hata TÜRÜ döner.
 *
 * DURUM SÖZLÜĞÜ
 *   healthy     → her şey çalışıyor
 *   degraded    → uygulama ayakta ama bir bağımlılık zayıf (ör. Redis yok)
 *   unavailable → veritabanı yok; istekler anlamlı şekilde karşılanamaz
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable'
export type CheckStatus = 'up' | 'down' | 'disabled'

export interface HealthCheck {
  status: CheckStatus
  /** Ölçülen gecikme (ms) — yalnızca `up` durumunda anlamlı */
  latencyMs?: number
  /** ⚠️ Kısa ve GENEL açıklama. Bağlantı adresi ve hata gövdesi yazılmaz. */
  detail?: string
}

export interface HealthReport {
  status: HealthStatus
  checks: {
    application: HealthCheck
    database: HealthCheck
    redis: HealthCheck
  }
}

const TIMEOUT_MS = 2_000

/** Bir kontrolün asılı kalıp sağlık ucunu kilitlemesini engeller. */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}:timeout`)), TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkDatabase(): Promise<HealthCheck> {
  const started = Date.now()
  try {
    // ⚠️ En ucuz sorgu. Tablo okumaz, kilit almaz.
    await withTimeout(db.$queryRaw`SELECT 1`, 'db')
    return { status: 'up', latencyMs: Date.now() - started }
  } catch (err) {
    // ⚠️ Hata GÖVDESİ dışarı verilmez — bağlantı dizesini içerebilir.
    return { status: 'down', detail: (err as Error).name }
  }
}

async function checkRedis(): Promise<HealthCheck> {
  if (!isRedisEnabled()) {
    /**
     * ⚠️ Bu, üretimde OLAMAZ: `production-guard` REDIS_URL yoksa boot'u
     * durdurur. Geliştirme ortamında ise bir arıza değil, bilinen bir durum.
     */
    return { status: 'disabled', detail: 'Redis yapılandırılmadı.' }
  }
  const started = Date.now()
  try {
    const redis = getRedis()
    if (!redis) return { status: 'disabled', detail: 'Redis istemcisi yok.' }
    await withTimeout(redis.ping(), 'redis')
    return { status: 'up', latencyMs: Date.now() - started }
  } catch (err) {
    return { status: 'down', detail: (err as Error).name }
  }
}

export async function checkHealth(): Promise<HealthReport> {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()])

  const application: HealthCheck = { status: 'up' }

  /**
   * Veritabanı olmadan hiçbir istek anlamlı sonuç veremez → `unavailable`.
   * Redis yoksa uygulama çalışır ama rate limit ve cache zayıflar → `degraded`.
   */
  const status: HealthStatus =
    database.status !== 'up' ? 'unavailable' : redis.status === 'down' ? 'degraded' : 'healthy'

  return { status, checks: { application, database, redis } }
}

/** Sağlık durumuna karşılık gelen HTTP kodu. */
export function healthHttpStatus(status: HealthStatus): number {
  // ⚠️ `degraded` 200 döner: load balancer örneği kuyruktan ÇIKARMAMALI,
  // ama izleme sistemi durumu cevaptan okuyup uyarı üretebilmeli.
  return status === 'unavailable' ? 503 : 200
}
