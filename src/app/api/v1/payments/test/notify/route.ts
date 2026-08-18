import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { env } from '@/env'
import { db } from '@/server/db'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { computeMockSignature } from '@/server/payments/providers/mock'
import { processWebhook } from '@/server/payments/webhook'

export const dynamic = 'force-dynamic'

const schema = z.object({
  providerRef: z.string().trim().min(8).max(120),
  outcome: z.enum(['success', 'failure']),
})

/**
 * POST /api/v1/payments/test/notify — MOCK sağlayıcı bildirimini tetikler
 *
 * ⚠️ GERÇEK PARA ORTAMINDA KAPALIDIR (404). Gerçek sağlayıcı yokken zincirin
 * tamamını çalıştırabilmek için var.
 *
 * ⚠️ Bu uç siparişi PAID YAPMAZ ve doğrulamayı ATLAMAZ. Yaptığı tek şey,
 * sağlayıcının göndereceği bildirimin AYNISINI — imzasıyla birlikte —
 * üretip normal webhook işleyicisine vermektir. İmza doğrulaması,
 * tutar kontrolü, durum makinesi ve tekrar koruması aynen çalışır.
 *
 * Tutar bildirime İSTEMCİDEN değil, veritabanındaki Payment kaydından
 * konur — böylece bu uç üzerinden tutar manipülasyonu mümkün olmaz.
 */
export async function POST(req: NextRequest) {
  if (env.PAYMENT_ENVIRONMENT === 'production') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Bulunamadı.' } }, { status: 404 })
  }

  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = schema.safeParse(body.data)
  if (!parsed.success) return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400)

  try {
    const payment = await db.payment.findUnique({
      where: { providerRef: parsed.data.providerRef },
      select: { provider: true, amountMinor: true, currency: true, providerTxnId: true },
    })
    if (!payment || payment.provider !== 'mock') {
      return apiError('PAYMENT_NOT_FOUND', 'Ödeme bulunamadı.', 404)
    }

    const eventId = `mockevt_${parsed.data.providerRef}_${parsed.data.outcome}`
    const payload = {
      providerRef: parsed.data.providerRef,
      status: parsed.data.outcome,
      // ⚠️ Tutar DB'den — istemci gövdesinden değil.
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      eventId,
      providerTxnId: payment.providerTxnId,
      ...(parsed.data.outcome === 'failure'
        ? { errorMessage: 'Test ortamında ödeme reddedildi.' }
        : {}),
    }
    const rawBody = JSON.stringify(payload)

    const signature = computeMockSignature({
      providerRef: parsed.data.providerRef,
      status: parsed.data.outcome,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      eventId,
    })

    // Normal webhook yolundan geçer — hiçbir adım atlanmaz.
    const result = await processWebhook('mock', {
      headers: new Headers({ 'content-type': 'application/json', 'x-mock-signature': signature }),
      rawBody,
      contentType: 'application/json',
    })

    return NextResponse.json(
      { outcome: result.outcome },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return handleUnexpected('payments.test.notify', err)
  }
}
