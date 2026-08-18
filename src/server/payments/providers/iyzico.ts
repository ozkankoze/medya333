import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'
import type { PaymentStatus } from '@/lib/enums'
import { redactProviderPayload } from '../redact'
import {
  ProviderCommunicationError,
  ProviderNotConfiguredError,
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
 * IYZICO — Checkout Form (CF) adapter
 *
 * Resmî akış (docs.iyzico.com):
 *   1. POST /payment/iyzipos/checkoutform/initialize/auth/ecom
 *      → paymentPageUrl + token  (3DS dahil, iyzico tarafında yönetilir)
 *   2. Kullanıcı iyzico ödeme sayfasında işlemi tamamlar
 *   3. iyzico → callbackUrl'e bildirim (server-to-server webhook)
 *   4. POST /payment/iyzipos/checkoutform/auth/ecom/detail ile SONUÇ DOĞRULANIR
 *
 * KİMLİK DOĞRULAMA (HMACSHA256 / IYZWSv2):
 *   payload   = randomKey + uriPath + requestBody
 *   signature = hex( HMAC-SHA256( payload, secretKey ) )
 *   authStr   = "apiKey:" + apiKey + "&randomKey:" + randomKey +
 *               "&signature:" + signature
 *   header    = "IYZWSv2 " + base64(authStr)
 *
 * WEBHOOK İMZASI (X-IYZ-SIGNATURE-V3), HPP/checkout biçimi:
 *   hex( HMAC-SHA256(
 *     secretKey + iyziEventType + iyziPaymentId + token +
 *     paymentConversationId + status,
 *     secretKey ) )
 *
 * ⚠️ Tarayıcının 3DS dönüşü TEK BAŞINA başarı sayılmaz. Sipariş yalnızca
 * doğrulanmış bildirim + sunucu tarafı `retrieve` sonucuyla PAID olur.
 *
 * ⚠️ Bu ortamda gerçek merchant bilgisi YOK. `isConfigured` false iken
 * hiçbir ağ isteği yapılmaz (Faz 3 kuralı 24).
 */

const PATH_CF_INITIALIZE = '/payment/iyzipos/checkoutform/initialize/auth/ecom'
const PATH_CF_RETRIEVE = '/payment/iyzipos/checkoutform/auth/ecom/detail'
const PATH_REFUND = '/payment/refund'

const IYZICO_ACK = { status: 200, body: '{"status":"ok"}', contentType: 'application/json' } as const

function hexHmac(data: string, key: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase(), 'utf8')
  const bb = Buffer.from(b.toLowerCase(), 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Kuruş → iyzico'nun beklediği ondalık metin ("12345" → "123.45"). */
export function minorToIyzicoPrice(minor: number): string {
  const s = (minor / 100).toFixed(2)
  // iyzico imzada sondaki sıfırların atılmasını ister: "10.50" → "10.5"
  return s.replace(/0+$/, '').replace(/\.$/, '.0')
}

/** IYZWSv2 Authorization başlığı — ayrı export: contract testi doğrular. */
export function buildIyzicoAuthHeader(params: {
  apiKey: string
  secretKey: string
  randomKey: string
  uriPath: string
  requestBody: string
}): string {
  const payload = params.randomKey + params.uriPath + params.requestBody
  const signature = hexHmac(payload, params.secretKey)
  const authStr = `apiKey:${params.apiKey}&randomKey:${params.randomKey}&signature:${signature}`
  return `IYZWSv2 ${Buffer.from(authStr, 'utf8').toString('base64')}`
}

/** X-IYZ-SIGNATURE-V3, HPP/checkout form bildirimi için. */
export function computeIyzicoWebhookSignature(params: {
  secretKey: string
  iyziEventType: string
  iyziPaymentId: string
  token: string
  paymentConversationId: string
  status: string
}): string {
  const data =
    params.secretKey +
    params.iyziEventType +
    params.iyziPaymentId +
    params.token +
    params.paymentConversationId +
    params.status
  return hexHmac(data, params.secretKey)
}

/** X-IYZ-SIGNATURE-V3, doğrudan (API) ödeme bildirimi için. */
export function computeIyzicoDirectWebhookSignature(params: {
  secretKey: string
  iyziEventType: string
  paymentId: string
  paymentConversationId: string
  status: string
}): string {
  const data =
    params.secretKey +
    params.iyziEventType +
    params.paymentId +
    params.paymentConversationId +
    params.status
  return hexHmac(data, params.secretKey)
}

/** iyzico durumlarını ortak domaine çevirir. */
export function mapIyzicoStatus(raw: string | undefined | null): PaymentStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'CAPTURED'
    case 'INIT_THREEDS':
    case 'CALLBACK_THREEDS':
    case 'PENDING_CREDIT':
      return 'PENDING_3DS'
    case 'INIT_BANK_TRANSFER':
    case 'INIT_APM':
      return 'PENDING'
    case 'FAILURE':
    case 'CALLBACK_FAILURE':
      return 'FAILED'
    default:
      return 'PENDING'
  }
}

interface IyzicoWebhookBody {
  iyziEventType?: string
  iyziReferenceCode?: string
  iyziPaymentId?: number | string
  paymentId?: number | string
  token?: string
  paymentConversationId?: string
  status?: string
  iyziEventTime?: number
}

export class IyzicoPaymentProvider implements PaymentProvider {
  readonly key = 'iyzico' as const
  readonly displayName = 'iyzico'

  constructor(
    private readonly config: {
      apiKey?: string | undefined
      secretKey?: string | undefined
      baseUrl: string
      environment: PaymentEnvironment
      fetchImpl?: typeof fetch
    },
  ) {}

  get environment(): PaymentEnvironment {
    return this.config.environment
  }

  get isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.secretKey)
  }

  private creds() {
    if (!this.isConfigured) throw new ProviderNotConfiguredError('iyzico')
    return { apiKey: this.config.apiKey!, secretKey: this.config.secretKey! }
  }

  private async call<T>(uriPath: string, body: unknown): Promise<T> {
    const { apiKey, secretKey } = this.creds()
    const requestBody = JSON.stringify(body)
    const randomKey = `${Date.now()}${randomBytes(6).toString('hex')}`

    const doFetch = this.config.fetchImpl ?? fetch
    try {
      const res = await doFetch(`${this.config.baseUrl}${uriPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-iyzi-rnd': randomKey,
          Authorization: buildIyzicoAuthHeader({
            apiKey,
            secretKey,
            randomKey,
            uriPath,
            requestBody,
          }),
        },
        body: requestBody,
      })
      return (await res.json()) as T
    } catch (err) {
      throw new ProviderCommunicationError('iyzico', (err as Error).message)
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const price = minorToIyzicoPrice(input.amountMinor)

    const request = {
      locale: 'tr',
      conversationId: input.providerRef,
      price,
      paidPrice: price,
      currency: 'TRY',
      basketId: input.orderNo,
      paymentGroup: 'PRODUCT',
      callbackUrl: input.callbackUrl,
      enabledInstallments: [1],
      buyer: {
        id: input.buyer.id,
        name: input.buyer.firstName,
        surname: input.buyer.lastName,
        email: input.buyer.email,
        identityNumber: '11111111111', // TCKN toplanmıyor; iyzico zorunlu alan
        registrationAddress: '-',
        ip: input.buyer.ip,
        city: '-',
        country: 'Turkey',
        ...(input.buyer.phone ? { gsmNumber: input.buyer.phone } : {}),
      },
      // Dijital hizmet: kargo/fatura adresi toplanmıyor (veri minimizasyonu)
      billingAddress: {
        contactName: `${input.buyer.firstName} ${input.buyer.lastName}`.trim(),
        city: '-',
        country: 'Turkey',
        address: '-',
      },
      basketItems: input.basket.map((i) => ({
        id: i.id,
        name: i.name.slice(0, 100),
        category1: 'Dijital Hizmet',
        itemType: 'VIRTUAL',
        price: minorToIyzicoPrice(i.amountMinor),
      })),
    }

    const res = await this.call<{
      status?: string
      token?: string
      paymentPageUrl?: string
      tokenExpireTime?: number
      errorCode?: string
      errorMessage?: string
    }>(PATH_CF_INITIALIZE, request)

    if (res.status !== 'success' || !res.token || !res.paymentPageUrl) {
      return {
        ok: false,
        presentation: 'redirect',
        status: 'FAILED',
        errorCode: res.errorCode ?? 'IYZICO_INIT_FAILED',
        errorMessage: res.errorMessage ?? 'Ödeme oturumu başlatılamadı.',
        raw: redactProviderPayload(res),
      }
    }

    return {
      ok: true,
      checkoutToken: res.token,
      checkoutUrl: res.paymentPageUrl,
      presentation: 'redirect',
      expiresAt: new Date(Date.now() + (res.tokenExpireTime ?? 1800) * 1000),
      status: 'PENDING_3DS',
      raw: redactProviderPayload({ status: res.status }),
    }
  }

  /**
   * ⚠️ ÖDEMENİN ASIL DOĞRULAMASI BURASI.
   * Bildirim yalnızca "bak bir şey oldu" der; parayı aldığımızı iyzico'ya
   * SORARAK öğreniriz. Webhook işleyicisi bunu çağırır.
   */
  async getPaymentStatus(ref: {
    providerRef: string
    providerTxnId?: string | null
    checkoutToken?: string | null
  }): Promise<PaymentStatusResult> {
    if (!ref.checkoutToken) {
      return {
        ok: false,
        status: 'PENDING',
        errorCode: 'MISSING_TOKEN',
        errorMessage: 'Checkout token bulunamadı.',
      }
    }

    const res = await this.call<{
      status?: string
      paymentStatus?: string
      paymentId?: string | number
      price?: string | number
      paidPrice?: string | number
      currency?: string
      conversationId?: string
      errorCode?: string
      errorMessage?: string
    }>(PATH_CF_RETRIEVE, {
      locale: 'tr',
      conversationId: ref.providerRef,
      token: ref.checkoutToken,
    })

    if (res.status !== 'success') {
      return {
        ok: false,
        status: 'FAILED',
        errorCode: res.errorCode ?? 'IYZICO_RETRIEVE_FAILED',
        errorMessage: res.errorMessage ?? 'Ödeme sonucu alınamadı.',
      }
    }

    const paidPrice = Number(res.paidPrice ?? res.price ?? 0)
    return {
      ok: true,
      status: mapIyzicoStatus(res.paymentStatus),
      providerTxnId: res.paymentId != null ? String(res.paymentId) : null,
      // Ondalık fiyat → kuruş. Kayan nokta hatasına karşı yuvarlanır.
      amountMinor: Number.isFinite(paidPrice) ? Math.round(paidPrice * 100) : null,
      currency: res.currency ?? null,
    }
  }

  verifyWebhook(req: RawWebhookRequest): boolean {
    if (!this.isConfigured) return false
    const { secretKey } = this.creds()

    const received = req.headers.get('x-iyz-signature-v3')
    if (!received) return false

    let body: IyzicoWebhookBody
    try {
      body = JSON.parse(req.rawBody) as IyzicoWebhookBody
    } catch {
      return false
    }

    const eventType = body.iyziEventType ?? ''
    const conversationId = body.paymentConversationId ?? ''
    const status = body.status ?? ''

    // HPP (checkout form) biçimi: token taşır.
    if (body.token) {
      const expected = computeIyzicoWebhookSignature({
        secretKey,
        iyziEventType: eventType,
        iyziPaymentId: String(body.iyziPaymentId ?? body.paymentId ?? ''),
        token: body.token,
        paymentConversationId: conversationId,
        status,
      })
      return safeEqualHex(expected, received)
    }

    // Doğrudan (API) biçimi.
    const expected = computeIyzicoDirectWebhookSignature({
      secretKey,
      iyziEventType: eventType,
      paymentId: String(body.paymentId ?? body.iyziPaymentId ?? ''),
      paymentConversationId: conversationId,
      status,
    })
    return safeEqualHex(expected, received)
  }

  async handleWebhook(req: RawWebhookRequest): Promise<NormalizedWebhook> {
    const signatureValid = this.verifyWebhook(req)

    let body: IyzicoWebhookBody = {}
    try {
      body = JSON.parse(req.rawBody) as IyzicoWebhookBody
    } catch {
      /* bozuk gövde → aşağıda providerRef null kalır, işlenmez */
    }

    const status = mapIyzicoStatus(body.status)
    const paymentId = body.iyziPaymentId ?? body.paymentId ?? null

    return {
      signatureValid,
      // iyziReferenceCode her bildirim için benzersizdir — replay tespiti buradan.
      providerEventId:
        body.iyziReferenceCode ??
        `${body.paymentConversationId ?? 'unknown'}:${body.status ?? 'unknown'}`,
      providerRef: body.paymentConversationId ?? null,
      providerTxnId: paymentId != null ? String(paymentId) : null,
      status,
      /**
       * ⚠️ iyzico bildirimi TUTAR TAŞIMAZ. Tutar doğrulaması `getPaymentStatus`
       * ile sunucudan sorularak yapılır — webhook işleyicisi bunu zorunlu tutar.
       */
      amountMinor: null,
      currency: null,
      eventType: body.iyziEventType ?? 'UNKNOWN',
      safePayload: redactProviderPayload(body) as Record<string, unknown>,
      ack: IYZICO_ACK,
    }
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    if (!input.providerTxnId) {
      return {
        ok: false,
        errorCode: 'MISSING_PAYMENT_ID',
        errorMessage: 'iyzico ödeme kimliği olmadan iade yapılamaz.',
      }
    }

    const res = await this.call<{
      status?: string
      paymentId?: string | number
      errorCode?: string
      errorMessage?: string
    }>(PATH_REFUND, {
      locale: 'tr',
      conversationId: input.refundRef,
      paymentTransactionId: input.providerTxnId,
      price: minorToIyzicoPrice(input.amountMinor),
      currency: input.currency,
      ip: input.buyerIp,
    })

    if (res.status === 'success') {
      return {
        ok: true,
        providerRefundId: res.paymentId != null ? String(res.paymentId) : input.refundRef,
        providerStatus: 'success',
        raw: redactProviderPayload(res),
      }
    }
    return {
      ok: false,
      providerStatus: res.status ?? null,
      errorCode: res.errorCode ?? 'IYZICO_REFUND_FAILED',
      errorMessage: res.errorMessage ?? 'İade işlemi reddedildi.',
      raw: redactProviderPayload(res),
    }
  }
}

export function createIyzicoProvider(fetchImpl?: typeof fetch): IyzicoPaymentProvider {
  return new IyzicoPaymentProvider({
    apiKey: env.IYZICO_API_KEY,
    secretKey: env.IYZICO_SECRET_KEY,
    baseUrl: env.IYZICO_BASE_URL,
    environment: env.PAYMENT_ENVIRONMENT,
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}
