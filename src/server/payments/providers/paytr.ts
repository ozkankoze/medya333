import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
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
 * PAYTR — iFrame API adapter
 *
 * Resmî akış (dev.paytr.com/en/iframe-api):
 *   1. Sunucu → POST https://www.paytr.com/odeme/api/get-token
 *      paytr_token = base64( HMAC-SHA256( hash_str, merchant_key ) )
 *      hash_str = merchant_id + user_ip + merchant_oid + email +
 *                 payment_amount + user_basket + no_installment +
 *                 max_installment + currency + test_mode + merchant_salt
 *   2. iframe: https://www.paytr.com/odeme/guvenli/<token>
 *   3. PayTR → Bildirim URL'ine POST (server-to-server)
 *      hash = base64( HMAC-SHA256( merchant_oid + merchant_salt + status +
 *                                  total_amount, merchant_key ) )
 *      Cevap GÖVDESİ tam olarak "OK" olmalı, öncesinde/sonrasında hiçbir şey yok.
 *
 * ⚠️ Ödeme sonucu YALNIZCA bu bildirimden kabul edilir. Kullanıcının
 * merchant_ok_url'e dönmesi UX'tir, kanıt değildir.
 *
 * ⚠️ Bu ortamda gerçek merchant bilgisi YOK. `isConfigured` false olduğunda
 * hiçbir ağ isteği yapılmaz; ödeme başlatma net bir hatayla reddedilir.
 * Sahte secret üretilmez, canlı uca istek atılmaz (Faz 3 kuralı 24).
 */

const TOKEN_ENDPOINT = 'https://www.paytr.com/odeme/api/get-token'
const IFRAME_BASE = 'https://www.paytr.com/odeme/guvenli'
const REFUND_ENDPOINT = 'https://www.paytr.com/odeme/iade'

/** PayTR "OK" dışında bir gövdede bildirimi başarısız sayar ve tekrar gönderir. */
const PAYTR_ACK = { status: 200, body: 'OK', contentType: 'text/plain; charset=utf-8' } as const

function b64hmac(data: string, key: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('base64')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** PayTR sepeti: [[ürün adı, birim fiyat "12.34", adet], …] JSON → base64 */
export function buildUserBasket(items: CreatePaymentInput['basket']): string {
  const rows = items.map((i) => [i.name.slice(0, 100), (i.amountMinor / 100).toFixed(2), 1])
  return Buffer.from(JSON.stringify(rows), 'utf8').toString('base64')
}

/**
 * paytr_token hesabı — dokümandaki sırayla, HİÇBİR alan atlanmadan.
 * Ayrı export: contract testleri bunu bağımsız olarak doğrular.
 */
export function computePaytrToken(params: {
  merchantId: string
  userIp: string
  merchantOid: string
  email: string
  paymentAmount: number
  userBasket: string
  noInstallment: 0 | 1
  maxInstallment: number
  currency: string
  testMode: 0 | 1
  merchantKey: string
  merchantSalt: string
}): string {
  const hashStr =
    params.merchantId +
    params.userIp +
    params.merchantOid +
    params.email +
    String(params.paymentAmount) +
    params.userBasket +
    String(params.noInstallment) +
    String(params.maxInstallment) +
    params.currency +
    String(params.testMode) +
    params.merchantSalt
  return b64hmac(hashStr, params.merchantKey)
}

/** Bildirim hash'i: merchant_oid + merchant_salt + status + total_amount */
export function computeCallbackHash(params: {
  merchantOid: string
  merchantSalt: string
  status: string
  totalAmount: string
  merchantKey: string
}): string {
  return b64hmac(
    params.merchantOid + params.merchantSalt + params.status + params.totalAmount,
    params.merchantKey,
  )
}

/** merchant_oid yalnızca alfanumerik olabilir — tire/alt çizgi kabul edilmez. */
export function toMerchantOid(providerRef: string): string {
  return providerRef.replace(/[^a-zA-Z0-9]/g, '')
}

function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v
  return out
}

export class PaytrPaymentProvider implements PaymentProvider {
  readonly key = 'paytr' as const
  readonly displayName = 'PayTR'

  constructor(
    private readonly config: {
      merchantId?: string | undefined
      merchantKey?: string | undefined
      merchantSalt?: string | undefined
      environment: PaymentEnvironment
      /** Test edilebilirlik: gerçek ağ yerine enjekte edilebilir fetch */
      fetchImpl?: typeof fetch
    },
  ) {}

  get environment(): PaymentEnvironment {
    return this.config.environment
  }

  get isConfigured(): boolean {
    return Boolean(this.config.merchantId && this.config.merchantKey && this.config.merchantSalt)
  }

  private creds() {
    if (!this.isConfigured) throw new ProviderNotConfiguredError('paytr')
    return {
      merchantId: this.config.merchantId!,
      merchantKey: this.config.merchantKey!,
      merchantSalt: this.config.merchantSalt!,
    }
  }

  private get testMode(): 0 | 1 {
    return this.config.environment === 'production' ? 0 : 1
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { merchantId, merchantKey, merchantSalt } = this.creds()
    const merchantOid = toMerchantOid(input.providerRef)
    const userBasket = buildUserBasket(input.basket)

    const paytrToken = computePaytrToken({
      merchantId,
      userIp: input.buyer.ip,
      merchantOid,
      email: input.buyer.email,
      paymentAmount: input.amountMinor, // PayTR kuruş bekler — Order.totalMinor birebir
      userBasket,
      noInstallment: 0,
      maxInstallment: 0,
      currency: 'TL',
      testMode: this.testMode,
      merchantKey,
      merchantSalt,
    })

    const body = new URLSearchParams({
      merchant_id: merchantId,
      user_ip: input.buyer.ip,
      merchant_oid: merchantOid,
      email: input.buyer.email,
      payment_amount: String(input.amountMinor),
      paytr_token: paytrToken,
      user_basket: userBasket,
      debug_on: this.config.environment === 'production' ? '0' : '1',
      no_installment: '0',
      max_installment: '0',
      user_name: `${input.buyer.firstName} ${input.buyer.lastName}`.trim(),
      user_address: '-', // Fatura adresi toplanmıyor (veri minimizasyonu)
      user_phone: input.buyer.phone ?? '-',
      merchant_ok_url: input.successUrl,
      merchant_fail_url: input.failureUrl,
      timeout_limit: '30',
      currency: 'TL',
      test_mode: String(this.testMode),
      lang: 'tr',
    })

    const doFetch = this.config.fetchImpl ?? fetch
    let json: { status?: string; token?: string; reason?: string }
    try {
      const res = await doFetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      json = (await res.json()) as typeof json
    } catch (err) {
      throw new ProviderCommunicationError('paytr', (err as Error).message)
    }

    if (json.status !== 'success' || !json.token) {
      return {
        ok: false,
        presentation: 'iframe',
        status: 'FAILED',
        errorCode: 'PAYTR_TOKEN_FAILED',
        errorMessage: json.reason ?? 'Ödeme oturumu başlatılamadı.',
        raw: redactProviderPayload(json),
      }
    }

    return {
      ok: true,
      checkoutToken: json.token,
      checkoutUrl: `${IFRAME_BASE}/${json.token}`,
      presentation: 'iframe',
      // 30 dakika: timeout_limit ile aynı
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: 'PENDING',
      raw: redactProviderPayload({ status: json.status }),
    }
  }

  /**
   * PayTR'de ödeme durumu sorgulama ucu iframe akışının parçası değildir;
   * sonuç yalnızca bildirimle gelir. Bu yüzden burada ağ isteği yapılmaz —
   * çağıran, veritabanındaki son duruma güvenir.
   */
  async getPaymentStatus(): Promise<PaymentStatusResult> {
    return {
      ok: false,
      status: 'PENDING',
      errorCode: 'NOT_SUPPORTED',
      errorMessage: 'PayTR sonucu yalnızca bildirim (callback) ile döner.',
    }
  }

  verifyWebhook(req: RawWebhookRequest): boolean {
    if (!this.isConfigured) return false
    const { merchantKey, merchantSalt } = this.creds()
    const form = parseForm(req.rawBody)

    const oid = form.merchant_oid
    const status = form.status
    const totalAmount = form.total_amount
    const received = form.hash
    if (!oid || !status || totalAmount === undefined || !received) return false

    const expected = computeCallbackHash({
      merchantOid: oid,
      merchantSalt,
      status,
      totalAmount,
      merchantKey,
    })
    return safeEqual(expected, received)
  }

  async handleWebhook(req: RawWebhookRequest): Promise<NormalizedWebhook> {
    const form = parseForm(req.rawBody)
    const signatureValid = this.verifyWebhook(req)

    const oid = form.merchant_oid ?? null
    const success = form.status === 'success'

    // PayTR total_amount'ı kuruş cinsinden (x100) gönderir.
    const totalAmount = form.total_amount ? Number(form.total_amount) : null
    const amountMinor = Number.isFinite(totalAmount) ? totalAmount : null

    const status: PaymentStatus = success ? 'CAPTURED' : 'FAILED'

    return {
      signatureValid,
      /**
       * PayTR ayrı bir olay kimliği göndermez. Bildirim, aynı merchant_oid için
       * aynı sonucu tekrar tekrar gönderir; olay kimliği olarak
       * "<oid>:<status>" kullanılır. PaymentEvent üzerindeki
       * @@unique([provider, providerEventId]) tekrarları yakalar.
       */
      providerEventId: `${oid ?? 'unknown'}:${form.status ?? 'unknown'}`,
      providerRef: oid,
      providerTxnId: null,
      status,
      amountMinor,
      // Bildirimde currency yalnızca başarılıda gelir; TL → TRY
      currency: form.currency ? (form.currency === 'TL' ? 'TRY' : form.currency) : null,
      eventType: success ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
      errorCode: form.failed_reason_code ?? null,
      errorMessage: form.failed_reason_msg ?? null,
      card: form.payment_type ? { brand: form.payment_type } : null,
      installment: form.installment_count ? Number(form.installment_count) : null,
      safePayload: redactProviderPayload(form) as Record<string, unknown>,
      /**
       * ⚠️ İmza geçersiz olsa BİLE PayTR'ye "OK" döneriz.
       * Aksi halde PayTR bildirimi saatlerce tekrar gönderir. Bildirim
       * kaydedilir, işlenmez; operasyon PaymentEvent üzerinden görür.
       */
      ack: PAYTR_ACK,
    }
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    const { merchantId, merchantKey, merchantSalt } = this.creds()
    const merchantOid = toMerchantOid(input.providerRef)
    const returnAmount = (input.amountMinor / 100).toFixed(2)

    const paytrToken = b64hmac(merchantId + merchantOid + returnAmount + merchantSalt, merchantKey)

    const body = new URLSearchParams({
      merchant_id: merchantId,
      merchant_oid: merchantOid,
      return_amount: returnAmount,
      paytr_token: paytrToken,
    })

    const doFetch = this.config.fetchImpl ?? fetch
    try {
      const res = await doFetch(REFUND_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      const json = (await res.json()) as { status?: string; err_no?: string; err_msg?: string }
      if (json.status === 'success') {
        return {
          ok: true,
          providerRefundId: input.refundRef,
          providerStatus: 'success',
          raw: redactProviderPayload(json),
        }
      }
      return {
        ok: false,
        providerStatus: json.status ?? null,
        errorCode: json.err_no ?? 'PAYTR_REFUND_FAILED',
        errorMessage: json.err_msg ?? 'İade işlemi reddedildi.',
        raw: redactProviderPayload(json),
      }
    } catch (err) {
      throw new ProviderCommunicationError('paytr', (err as Error).message)
    }
  }
}

export function createPaytrProvider(fetchImpl?: typeof fetch): PaytrPaymentProvider {
  return new PaytrPaymentProvider({
    merchantId: env.PAYTR_MERCHANT_ID,
    merchantKey: env.PAYTR_MERCHANT_KEY,
    merchantSalt: env.PAYTR_MERCHANT_SALT,
    environment: env.PAYMENT_ENVIRONMENT,
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}
