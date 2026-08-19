import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health/live — LIVENESS (canlılık) probu
 *
 * ⚠️ NEDEN AYRI BİR UÇ? (Faz 9)
 *
 * `/api/health` bir READINESS (hazırlık) probudur: veritabanı ve Redis'e
 * bakar, biri yoksa 503 döner. Konteyner orkestratörüne **liveness** olarak
 * bu ucu vermek tehlikelidir: veritabanı kısa süre erişilemez olduğunda
 * orkestratör "süreç ölmüş" sanıp TÜM ÖRNEKLERİ yeniden başlatır. Veritabanı
 * geri geldiğinde ise elde ayakta örnek kalmamış olur — kısa bir kesinti,
 * kendini besleyen bir yeniden başlatma döngüsüne dönüşür.
 *
 * Liveness'ın cevapladığı tek soru: **"Node süreci hâlâ istek işleyebiliyor
 * mu?"** Bağımlılıklara BAKMAZ, veritabanına dokunmaz, Redis'e dokunmaz.
 *
 * Doğru kullanım:
 *   livenessProbe  → /api/health/live   (yanıt veriyorsa süreç sağlıklı)
 *   readinessProbe → /api/health        (503 ise trafiği bu örneğe verme)
 *
 * ⚠️ Hiçbir bilgi dönmez: sürüm, ortam, sır, bağlantı adresi yok.
 */
export function GET() {
  return new NextResponse('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
