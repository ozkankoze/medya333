import { NextResponse, type NextRequest } from 'next/server'
import { CACHE_TAGS, CATALOG_REVALIDATE_SECONDS } from '@/server/cache'
import { getCatalog } from '@/server/catalog'
import { apiError, handleUnexpected } from '@/server/http'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

/**
 * GET /api/v1/catalog/snapshot
 *
 * Tüm katalog TEK ÇAĞRIDA: platform → hizmet → varyant → fiyat kademeleri →
 * hedef girdi yapılandırması. Sihirbaz tek sayfa olduğu için adım geçişlerinde
 * ek ağ isteği yapılmaz; izomorfik pricing engine tarayıcıda 0 ms'de hesaplar.
 *
 * ⚠️ YALNIZCA CUSTOMER-FACING ALANLAR. Bu cevapta ASLA bulunmaz:
 *   internalName · maliyet · fulfillment bilgisi · admin notları
 *   · kupon/iç fiyatlandırma · secret/config değerleri
 * (Sızıntı kontrolü: tests/integration/catalog-api.test.ts)
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const limit = await rateLimit('catalog.read.ip', rateLimitIdentifier(req.headers))
    if (!limit.ok) {
      return apiError('RATE_LIMITED', 'Çok fazla istek.', 429, { headers: rateLimitHeaders(limit) })
    }

    const snapshot = await getCatalog()
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': `public, s-maxage=${CATALOG_REVALIDATE_SECONDS}, stale-while-revalidate=600`,
        'x-cache-tag': CACHE_TAGS.catalog,
        ...rateLimitHeaders(limit),
      },
    })
  } catch (err) {
    return handleUnexpected('catalog.snapshot', err)
  }
}
