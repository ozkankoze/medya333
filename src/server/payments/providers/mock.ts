import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'
import { appBaseUrl } from '../../base-url'
import { redactProviderPayload } from '../redact'
import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  type NormalizedWebhook,
  type PaymentEnvironment,
  type PaymentProvider,
  type PaymentStatusResult,
  type RawWebhookRequest,
  type RefundInput,
  type RefundResult,
} from '../types'

/**
 * MOCK SAĞLAYICI — gerçek merchant bilgisi olmadan uçtan uca doğrulama
 *
 * NEDEN VAR?
 * Faz 3 kuralı 24: gerçek credential yokken sahte secret üretmek, canlı uca
 * istek atmak veya "ödeme başarılı" varsaymak YASAK. Ama sipariş → ödeme →
 * bildirim → PAID zincirinin gerçekten çalıştığını da göstermek gerekiyor.
 *
 * Bu sağlayıcı o boşluğu doldurur:
 *   • Dışarıya HİÇBİR ağ isteği yapmaz.
 *   • Kendi bildirimini, gerçek sağlayıcılarla AYNI arayüz üzerinden üretir.
 *   • İmzayı gerçekten hesaplar ve gerçekten doğrular (kendi anahtarımızla) —
 *     yani webhook güvenlik yolu "test için atlanmış" değildir.
 *   • Ödemeyi kendiliğinden başarılı SAYMAZ; sonuç, imzalı bildirim gelene
 *     kadar PENDING kalır.
 *
 * ⚠️ ÜRETİMDE KULLANILAMAZ.
 *
 * Kapı `PAYMENT_ENVIRONMENT`'a bakar, NODE_ENV'e DEĞİL. Sebep: sandbox ve
 * staging dağıtımları da `next build` + `next start` ile, yani
 * NODE_ENV=production olarak çalışır. NODE_ENV'e bağlanınca mock bu
 * ortamlarda kullanılamıyordu; PAYMENT_ENVIRONMENT ise "gerçek para dönüyor
 * mu" sorusunun doğru cevabıdır.
 *
 * Ek olarak `registry.ts` boot'ta PAYMENT_ENVIRONMENT=production + mock
 * kombinasyonunu tamamen reddeder — yanlış yapılandırma sessizce
 * "her ödeme başarılı" davranışına dönüşemez.
 *
 * Anahtar: ORDER_TOKEN_SECRET'ten türetilir. Bu, uydurulmuş bir "merchant
 * secret" DEĞİL — kendi mock'umuzun kendi anahtarıdır ve gerçek bir sağlayıcı
 * kimliği taklit etmez.
 */

const MOCK_ACK = { status: 200, body: '{"status":"ok"}', contentType: 'application/json' } as const

function mockKey(): string {
  return createHmac('sha256', env.ORDER_TOKEN_SECRET).update('mock-payment-provider').digest('hex')
}

/** Bildirim imzası: providerRef + status + amountMinor + currency + eventId */
export function computeMockSignature(params: {
  providerRef: string
  status: string
  amountMinor: number
  currency: string
  eventId: string
  key?: string
}): string {
  const data = [
    params.providerRef,
    params.status,
    String(params.amountMinor),
    params.currency,
    params.eventId,
  ].join('|')
  return createHmac('sha256', params.key ?? mockKey()).update(data).digest('hex')
}

interface MockWebhookBody {
  providerRef?: string
  status?: 'success' | 'failure'
  amountMinor?: number
  currency?: string
  eventId?: string
  providerTxnId?: string
  errorMessage?: string
}

export class MockPaymentProvider implements PaymentProvider {
  readonly key = 'mock' as const
  readonly displayName = 'Test Ödeme Sağlayıcısı (mock)'

  constructor(private readonly config: { environment: PaymentEnvironment }) {}

  get environment(): PaymentEnvironment {
    return this.config.environment
  }

  /** Gerçek para ortamında ASLA yapılandırılmış sayılmaz. */
  get isConfigured(): boolean {
    return env.PAYMENT_ENVIRONMENT !== 'production'
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const token = randomBytes(16).toString('hex')
    const base = appBaseUrl()

    return {
      ok: true,
      checkoutToken: token,
      // Sağlayıcının ödeme sayfası yerine kendi test checkout sayfamız.
      checkoutUrl: `${base}/odeme/test/${encodeURIComponent(input.providerRef)}?t=${token}`,
      presentation: 'redirect',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      // ⚠️ Başarı VARSAYILMAZ — imzalı bildirim gelene kadar beklemede.
      status: 'PENDING',
      providerTxnId: `mock_${randomBytes(8).toString('hex')}`,
      raw: { provider: 'mock', amountMinor: input.amountMinor, currency: input.currency },
    }
  }

  async getPaymentStatus(): Promise<PaymentStatusResult> {
    return {
      ok: false,
      status: 'PENDING',
      errorCode: 'NOT_SUPPORTED',
      errorMessage: 'Mock sağlayıcıda sonuç yalnızca bildirimle döner.',
    }
  }

  verifyWebhook(req: RawWebhookRequest): boolean {
    const received = req.headers.get('x-mock-signature')
    if (!received) return false

    let body: MockWebhookBody
    try {
      body = JSON.parse(req.rawBody) as MockWebhookBody
    } catch {
      return false
    }
    if (!body.providerRef || !body.status || body.amountMinor == null || !body.eventId) return false

    const expected = computeMockSignature({
      providerRef: body.providerRef,
      status: body.status,
      amountMinor: body.amountMinor,
      currency: body.currency ?? 'TRY',
      eventId: body.eventId,
    })
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(received, 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  async handleWebhook(req: RawWebhookRequest): Promise<NormalizedWebhook> {
    const signatureValid = this.verifyWebhook(req)
    let body: MockWebhookBody = {}
    try {
      body = JSON.parse(req.rawBody) as MockWebhookBody
    } catch {
      /* bozuk gövde */
    }

    const success = body.status === 'success'
    return {
      signatureValid,
      providerEventId: body.eventId ?? 'unknown',
      providerRef: body.providerRef ?? null,
      providerTxnId: body.providerTxnId ?? null,
      status: success ? 'CAPTURED' : 'FAILED',
      amountMinor: body.amountMinor ?? null,
      currency: body.currency ?? 'TRY',
      eventType: success ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
      errorMessage: body.errorMessage ?? null,
      safePayload: redactProviderPayload(body) as Record<string, unknown>,
      ack: MOCK_ACK,
    }
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    return {
      ok: true,
      providerRefundId: `mockref_${randomBytes(6).toString('hex')}`,
      providerStatus: 'success',
      raw: { provider: 'mock', amountMinor: input.amountMinor },
    }
  }
}

export function createMockProvider(): MockPaymentProvider {
  return new MockPaymentProvider({ environment: env.PAYMENT_ENVIRONMENT })
}
