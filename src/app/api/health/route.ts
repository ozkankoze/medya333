import { NextResponse } from 'next/server'
import { checkHealth, healthHttpStatus } from '@/server/health'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — üretim sağlık ucu
 *
 * ⚠️ KİMLİK DOĞRULAMA İSTEMEZ. Load balancer, konteyner orkestratörü ve
 * izleme sistemi buraya oturum açmadan erişir. Tam da bu yüzden cevap
 * BİLGİ SIZDIRMAMALIDIR: sürüm, bağlantı adresi, sağlayıcı adı, ortam
 * değişkeni ve hata gövdesi dönmez.
 *
 * ⚠️ RATE LIMIT UYGULANMAZ: sağlık yoklamasını kısmak, sağlıklı bir örneğin
 * "ölü" işaretlenmesine ve gereksiz yeniden başlatmalara yol açar. Uç zaten
 * iki ucuz ping'den ibarettir ve `no-store` ile işaretlidir.
 *
 * ⚠️ ÖDEME SAĞLAYICISI ÇAĞRILMAZ (bkz. server/health.ts).
 *
 * Kodlar:
 *   200 healthy   — her şey çalışıyor
 *   200 degraded  — uygulama ayakta, bir bağımlılık zayıf (örnek kuyrukta kalır)
 *   503 unavailable — veritabanı yok
 */
export async function GET() {
  const report = await checkHealth()
  return NextResponse.json(report, {
    status: healthHttpStatus(report.status),
    headers: { 'Cache-Control': 'no-store' },
  })
}
