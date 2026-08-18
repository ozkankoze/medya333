import { NextResponse, type NextRequest } from 'next/server'
import { processWebhook } from '@/server/payments/webhook'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/payments/webhooks/[provider]
 *   → /api/v1/payments/webhooks/iyzico
 *   → /api/v1/payments/webhooks/paytr
 *
 * ⚠️ OTURUM/AUTH YOKTUR — sağlayıcı sunucusu çerez taşımaz. Kimlik doğrulama
 * imza/hash iledir; `processWebhook` bunu zorunlu tutar.
 *
 * ⚠️ CSRF KONTROLÜ DE YOKTUR ve olmamalıdır: bu uç tarayıcıdan değil,
 * sağlayıcının sunucusundan çağrılır ve Origin başlığı taşımaz.
 *
 * Cevap biçimini sağlayıcı belirler:
 *   • PayTR gövdenin TAM OLARAK "OK" olmasını bekler
 *   • iyzico 2xx yeterli sayar
 * Bu yüzden gövde `NormalizedWebhook.ack` üzerinden gelir.
 *
 * Rate limit UYGULANMAZ: sağlayıcı meşru olarak tekrar tekrar gönderir ve
 * kısıtlamak ödeme bildiriminin kaybolmasına yol açar. Tekrar koruması
 * PaymentEvent üzerindeki unique kısıtla sağlanır.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return new NextResponse('bad request', { status: 400 })
  }

  // Gövde sınırı: sağlayıcı bildirimi birkaç KB'dır.
  if (Buffer.byteLength(rawBody, 'utf8') > 64 * 1024) {
    return new NextResponse('payload too large', { status: 413 })
  }

  const result = await processWebhook(provider, {
    headers: req.headers,
    rawBody,
    contentType: req.headers.get('content-type'),
  })

  return new NextResponse(result.ack.body, {
    status: result.ack.status,
    headers: {
      'content-type': result.ack.contentType,
      'cache-control': 'no-store',
      // Teşhis için — sonucu sızdırmaz, yalnızca işleme kararını gösterir
      'x-webhook-outcome': result.outcome,
    },
  })
}

/** Sağlayıcılar bazen ucun ayakta olduğunu GET ile yoklar. */
export async function GET() {
  return new NextResponse('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
}
