/**
 * SAĞLAYICI CONTRACT TESTLERİ — gerçek credential ve ağ olmadan
 *
 * Faz 3 kuralı 23-24: sandbox erişimi yoksa adapter'ların SÖZLEŞMESİ test
 * edilir. Burada doğrulanan şeyler:
 *
 *   • İmza/hash hesabı resmî dokümandaki BİRLEŞTİRME SIRASINA uyuyor mu?
 *     (Beklenen değer, testin içinde BAĞIMSIZ olarak yeniden hesaplanır —
 *      uygulamanın fonksiyonu çağrılmaz; iki farklı yol aynı sonucu vermeli.)
 *   • Sağlayıcıya giden istek gövdesi doğru alanları taşıyor mu?
 *   • Sağlayıcı yanıtı ortak domaine doğru mu çevriliyor?
 *   • Kimlik bilgisi yokken ağ isteği YAPILMIYOR mu?
 *
 * Ağ tamamen kapalı: her adapter'a sahte `fetchImpl` enjekte edilir. Testte
 * kullanılan anahtarlar tamamen uydurma ve YALNIZCA bu dosyada geçerli —
 * hiçbir gerçek merchant hesabına ait değil ve hiçbir uca gönderilmiyor.
 */

import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.IYZICO_BASE_URL ??= 'https://sandbox-api.iyzipay.com'
process.env.ORDER_TOKEN_SECRET ??= 'test-token-secret-test-token-secret-0123'
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000'

import {
  buildUserBasket,
  computeCallbackHash,
  computePaytrToken,
  PaytrPaymentProvider,
  toMerchantOid,
} from '@/server/payments/providers/paytr'
import {
  buildIyzicoAuthHeader,
  computeIyzicoDirectWebhookSignature,
  computeIyzicoWebhookSignature,
  IyzicoPaymentProvider,
  mapIyzicoStatus,
  minorToIyzicoPrice,
} from '@/server/payments/providers/iyzico'
import type { CreatePaymentInput } from '@/server/payments/types'
import { ProviderNotConfiguredError } from '@/server/payments/types'

// --- Test-only sahte kimlikler (hiçbir gerçek hesaba ait değil) ------------
const PAYTR = { id: '123456', key: 'test-merchant-key', salt: 'test-merchant-salt' }
const IYZ = { apiKey: 'sandbox-apikey-xxx', secretKey: 'sandbox-secret-yyy' }

const BASE_INPUT: CreatePaymentInput = {
  providerRef: 'M333ABCDEFGHA1R0011aa',
  orderNo: 'M333-ABCDEFGH',
  amountMinor: 30_000,
  currency: 'TRY',
  buyer: {
    id: 'usr_1',
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    email: 'ayse@ornek.test',
    ip: '203.0.113.10',
    phone: '05551112233',
  },
  basket: [{ id: 'itm_1', name: 'Instagram Takipçi', amountMinor: 30_000 }],
  callbackUrl: 'https://medya333.test/api/v1/payments/webhooks/paytr',
  successUrl: 'https://medya333.test/odeme/sonuc/M333-ABCDEFGH',
  failureUrl: 'https://medya333.test/odeme/sonuc/M333-ABCDEFGH?durum=basarisiz',
}

function jsonResponse(body: unknown) {
  return { json: async () => body } as unknown as Response
}

// ===========================================================================
describe('PayTR — hash sözleşmesi', () => {
  it('paytr_token dokümandaki birleştirme sırasını kullanır', () => {
    const userBasket = buildUserBasket(BASE_INPUT.basket)

    const actual = computePaytrToken({
      merchantId: PAYTR.id,
      userIp: '203.0.113.10',
      merchantOid: 'M333ABCDEFGHA1R0011aa',
      email: 'ayse@ornek.test',
      paymentAmount: 30_000,
      userBasket,
      noInstallment: 0,
      maxInstallment: 0,
      currency: 'TL',
      testMode: 1,
      merchantKey: PAYTR.key,
      merchantSalt: PAYTR.salt,
    })

    // BAĞIMSIZ yeniden hesap: dokümandaki sıra elle yazılır.
    const expectedStr =
      PAYTR.id +
      '203.0.113.10' +
      'M333ABCDEFGHA1R0011aa' +
      'ayse@ornek.test' +
      '30000' +
      userBasket +
      '0' +
      '0' +
      'TL' +
      '1' +
      PAYTR.salt
    const expected = createHmac('sha256', PAYTR.key).update(expectedStr, 'utf8').digest('base64')

    expect(actual).toBe(expected)
  })

  it('herhangi bir alan değişirse token değişir (sıra duyarlı)', () => {
    const base = {
      merchantId: PAYTR.id,
      userIp: '203.0.113.10',
      merchantOid: 'OID1',
      email: 'a@b.test',
      paymentAmount: 100,
      userBasket: 'x',
      noInstallment: 0 as const,
      maxInstallment: 0,
      currency: 'TL',
      testMode: 1 as const,
      merchantKey: PAYTR.key,
      merchantSalt: PAYTR.salt,
    }
    const t0 = computePaytrToken(base)
    expect(computePaytrToken({ ...base, paymentAmount: 101 })).not.toBe(t0)
    expect(computePaytrToken({ ...base, merchantOid: 'OID2' })).not.toBe(t0)
    expect(computePaytrToken({ ...base, merchantSalt: 'baska-salt' })).not.toBe(t0)
  })

  it('bildirim hash\'i merchant_oid + salt + status + total_amount sırasındadır', () => {
    const actual = computeCallbackHash({
      merchantOid: 'OID99',
      merchantSalt: PAYTR.salt,
      status: 'success',
      totalAmount: '30000',
      merchantKey: PAYTR.key,
    })
    const expected = createHmac('sha256', PAYTR.key)
      .update('OID99' + PAYTR.salt + 'success' + '30000', 'utf8')
      .digest('base64')
    expect(actual).toBe(expected)
  })

  it('merchant_oid yalnızca alfanumerik olur (PayTR kısıtı)', () => {
    expect(toMerchantOid('M333-ABCD_EFGH.1')).toBe('M333ABCDEFGH1')
    expect(toMerchantOid('M333-ABCD')).toMatch(/^[a-zA-Z0-9]+$/)
  })

  it('user_basket base64 JSON: [[ad, "300.00", 1]]', () => {
    const decoded = JSON.parse(
      Buffer.from(buildUserBasket(BASE_INPUT.basket), 'base64').toString('utf8'),
    )
    expect(decoded).toEqual([['Instagram Takipçi', '300.00', 1]])
  })
})

describe('PayTR — istek ve yanıt sözleşmesi', () => {
  let sent: { url: string; body: URLSearchParams } | null = null

  const provider = new PaytrPaymentProvider({
    merchantId: PAYTR.id,
    merchantKey: PAYTR.key,
    merchantSalt: PAYTR.salt,
    environment: 'sandbox',
    fetchImpl: (async (url: string, init: RequestInit) => {
      sent = { url: String(url), body: new URLSearchParams(String(init.body)) }
      return jsonResponse({ status: 'success', token: 'iframe-token-123' })
    }) as unknown as typeof fetch,
  })

  beforeEach(() => {
    sent = null
  })

  it('token isteği doğru uca ve doğru alanlarla gider', async () => {
    const res = await provider.createPayment(BASE_INPUT)

    expect(sent!.url).toBe('https://www.paytr.com/odeme/api/get-token')
    // ⚠️ TUTAR KURUŞ olarak, Order.totalMinor ile BİREBİR
    expect(sent!.body.get('payment_amount')).toBe('30000')
    expect(sent!.body.get('currency')).toBe('TL')
    expect(sent!.body.get('merchant_id')).toBe(PAYTR.id)
    expect(sent!.body.get('test_mode')).toBe('1')
    expect(sent!.body.get('merchant_ok_url')).toBe(BASE_INPUT.successUrl)
    expect(sent!.body.get('merchant_fail_url')).toBe(BASE_INPUT.failureUrl)
    expect(sent!.body.get('paytr_token')).toBeTruthy()

    // ⚠️ merchant_key / merchant_salt İSTEK GÖVDESİNE GİRMEZ
    expect(sent!.body.get('merchant_key')).toBeNull()
    expect(sent!.body.get('merchant_salt')).toBeNull()
    expect(String(sent!.body)).not.toContain(PAYTR.key)
    expect(String(sent!.body)).not.toContain(PAYTR.salt)

    expect(res.ok).toBe(true)
    expect(res.checkoutUrl).toBe('https://www.paytr.com/odeme/guvenli/iframe-token-123')
    expect(res.presentation).toBe('iframe')
    // ⚠️ Başarı VARSAYILMAZ
    expect(res.status).toBe('PENDING')
  })

  it('sağlayıcı hata dönerse ödeme FAILED olur, checkout URL üretilmez', async () => {
    const failing = new PaytrPaymentProvider({
      merchantId: PAYTR.id,
      merchantKey: PAYTR.key,
      merchantSalt: PAYTR.salt,
      environment: 'sandbox',
      fetchImpl: (async () =>
        jsonResponse({ status: 'failed', reason: 'invalid merchant' })) as unknown as typeof fetch,
    })
    const res = await failing.createPayment(BASE_INPUT)
    expect(res.ok).toBe(false)
    expect(res.status).toBe('FAILED')
    expect(res.checkoutUrl).toBeUndefined()
  })

  it('geçerli bildirimi doğrular ve CAPTURED\'a çevirir', async () => {
    const oid = 'OIDSUCCESS'
    const hash = computeCallbackHash({
      merchantOid: oid,
      merchantSalt: PAYTR.salt,
      status: 'success',
      totalAmount: '30000',
      merchantKey: PAYTR.key,
    })
    const rawBody = new URLSearchParams({
      merchant_oid: oid,
      status: 'success',
      total_amount: '30000',
      payment_amount: '30000',
      currency: 'TL',
      payment_type: 'card',
      hash,
    }).toString()

    const hook = await provider.handleWebhook({
      headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      rawBody,
      contentType: 'application/x-www-form-urlencoded',
    })

    expect(hook.signatureValid).toBe(true)
    expect(hook.status).toBe('CAPTURED')
    expect(hook.amountMinor).toBe(30_000)
    expect(hook.currency).toBe('TRY')
    expect(hook.providerRef).toBe(oid)
    // ⚠️ PayTR gövdesi TAM OLARAK "OK" olmalı
    expect(hook.ack.body).toBe('OK')
    expect(hook.ack.status).toBe(200)
  })

  it('bozuk hash reddedilir ama yine "OK" döner (sonsuz tekrar olmasın)', async () => {
    const rawBody = new URLSearchParams({
      merchant_oid: 'OIDX',
      status: 'success',
      total_amount: '30000',
      hash: 'kesinlikle-yanlis-hash',
    }).toString()

    const hook = await provider.handleWebhook({
      headers: new Headers(),
      rawBody,
      contentType: 'application/x-www-form-urlencoded',
    })
    expect(hook.signatureValid).toBe(false)
    expect(hook.ack.body).toBe('OK')
  })

  it('başarısız bildirim FAILED\'a çevrilir ve hata kodu taşınır', async () => {
    const oid = 'OIDFAIL'
    const hash = computeCallbackHash({
      merchantOid: oid,
      merchantSalt: PAYTR.salt,
      status: 'failed',
      totalAmount: '0',
      merchantKey: PAYTR.key,
    })
    const hook = await provider.handleWebhook({
      headers: new Headers(),
      rawBody: new URLSearchParams({
        merchant_oid: oid,
        status: 'failed',
        total_amount: '0',
        failed_reason_code: '6',
        failed_reason_msg: 'Yetersiz bakiye',
        hash,
      }).toString(),
      contentType: 'application/x-www-form-urlencoded',
    })
    expect(hook.signatureValid).toBe(true)
    expect(hook.status).toBe('FAILED')
    expect(hook.errorCode).toBe('6')
  })

  it('⚠️ kimlik bilgisi YOKKEN ağ isteği YAPILMAZ', async () => {
    const fetchSpy = vi.fn()
    const unconfigured = new PaytrPaymentProvider({
      merchantId: undefined,
      merchantKey: undefined,
      merchantSalt: undefined,
      environment: 'sandbox',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(unconfigured.isConfigured).toBe(false)
    await expect(unconfigured.createPayment(BASE_INPUT)).rejects.toThrowError(
      ProviderNotConfiguredError,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    // Yapılandırılmamışken hiçbir bildirim geçerli sayılmaz
    expect(
      unconfigured.verifyWebhook({ headers: new Headers(), rawBody: '', contentType: null }),
    ).toBe(false)
  })
})

// ===========================================================================
describe('iyzico — imza sözleşmesi', () => {
  it('IYZWSv2 başlığı randomKey + uriPath + body üzerinden kurulur', () => {
    const body = JSON.stringify({ locale: 'tr', conversationId: 'abc' })
    const actual = buildIyzicoAuthHeader({
      apiKey: IYZ.apiKey,
      secretKey: IYZ.secretKey,
      randomKey: 'RND123',
      uriPath: '/payment/test',
      requestBody: body,
    })

    // BAĞIMSIZ yeniden hesap
    const sig = createHmac('sha256', IYZ.secretKey)
      .update('RND123' + '/payment/test' + body, 'utf8')
      .digest('hex')
    const authStr = `apiKey:${IYZ.apiKey}&randomKey:RND123&signature:${sig}`
    const expected = `IYZWSv2 ${Buffer.from(authStr, 'utf8').toString('base64')}`

    expect(actual).toBe(expected)
    expect(actual.startsWith('IYZWSv2 ')).toBe(true)

    // Çözüldüğünde secretKey görünmemeli — yalnızca türetilmiş imza
    const decoded = Buffer.from(actual.slice(8), 'base64').toString('utf8')
    expect(decoded).not.toContain(IYZ.secretKey)
    expect(decoded).toContain(IYZ.apiKey)
  })

  it('HPP webhook imzası: secretKey+eventType+paymentId+token+conversationId+status (hex)', () => {
    const actual = computeIyzicoWebhookSignature({
      secretKey: IYZ.secretKey,
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      iyziPaymentId: '999',
      token: 'tok_1',
      paymentConversationId: 'conv_1',
      status: 'SUCCESS',
    })
    const expected = createHmac('sha256', IYZ.secretKey)
      .update(IYZ.secretKey + 'CHECKOUT_FORM_AUTH' + '999' + 'tok_1' + 'conv_1' + 'SUCCESS', 'utf8')
      .digest('hex')
    expect(actual).toBe(expected)
    expect(actual).toMatch(/^[0-9a-f]{64}$/) // hex, base64 DEĞİL
  })

  it('doğrudan API webhook imzası token taşımaz', () => {
    const actual = computeIyzicoDirectWebhookSignature({
      secretKey: IYZ.secretKey,
      iyziEventType: 'PAYMENT_API',
      paymentId: '555',
      paymentConversationId: 'conv_2',
      status: 'SUCCESS',
    })
    const expected = createHmac('sha256', IYZ.secretKey)
      .update(IYZ.secretKey + 'PAYMENT_API' + '555' + 'conv_2' + 'SUCCESS', 'utf8')
      .digest('hex')
    expect(actual).toBe(expected)
  })

  it('kuruş → iyzico fiyat biçimi (sondaki sıfırlar atılır)', () => {
    expect(minorToIyzicoPrice(30_000)).toBe('300.0')
    expect(minorToIyzicoPrice(1050)).toBe('10.5')
    expect(minorToIyzicoPrice(1234)).toBe('12.34')
    expect(minorToIyzicoPrice(100)).toBe('1.0')
  })

  it('iyzico durumları ortak domaine doğru eşlenir', () => {
    expect(mapIyzicoStatus('SUCCESS')).toBe('CAPTURED')
    expect(mapIyzicoStatus('FAILURE')).toBe('FAILED')
    expect(mapIyzicoStatus('INIT_THREEDS')).toBe('PENDING_3DS')
    expect(mapIyzicoStatus('CALLBACK_THREEDS')).toBe('PENDING_3DS')
    // Bilinmeyen durum ASLA başarı sayılmaz
    expect(mapIyzicoStatus('SOMETHING_NEW')).toBe('PENDING')
    expect(mapIyzicoStatus(null)).toBe('PENDING')
  })
})

describe('iyzico — istek ve yanıt sözleşmesi', () => {
  let calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []

  function providerWith(responses: unknown[]) {
    let i = 0
    return new IyzicoPaymentProvider({
      apiKey: IYZ.apiKey,
      secretKey: IYZ.secretKey,
      baseUrl: 'https://sandbox-api.iyzipay.com',
      environment: 'sandbox',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({
          url: String(url),
          headers: init.headers as Record<string, string>,
          body: JSON.parse(String(init.body)),
        })
        return jsonResponse(responses[i++] ?? {})
      }) as unknown as typeof fetch,
    })
  }

  beforeEach(() => {
    calls = []
  })

  it('checkout initialize doğru uca, doğru tutarla ve imzalı gider', async () => {
    const p = providerWith([
      {
        status: 'success',
        token: 'cf_token_1',
        paymentPageUrl: 'https://sandbox-cf.iyzipay.com/?token=cf_token_1',
        tokenExpireTime: 1800,
      },
    ])
    const res = await p.createPayment(BASE_INPUT)

    expect(calls[0]!.url).toBe(
      'https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/initialize/auth/ecom',
    )
    expect(calls[0]!.headers.Authorization?.startsWith('IYZWSv2 ')).toBe(true)

    const body = calls[0]!.body as Record<string, unknown>
    expect(body.price).toBe('300.0')
    expect(body.paidPrice).toBe('300.0')
    expect(body.currency).toBe('TRY')
    expect(body.conversationId).toBe(BASE_INPUT.providerRef)
    expect(body.callbackUrl).toBe(BASE_INPUT.callbackUrl)

    // secretKey gövdeye SIZMAZ
    expect(JSON.stringify(body)).not.toContain(IYZ.secretKey)

    expect(res.ok).toBe(true)
    expect(res.presentation).toBe('redirect')
    // 3DS iyzico tarafında; başlangıç durumu beklemededir
    expect(res.status).toBe('PENDING_3DS')
  })

  it('⚠️ webhook TUTAR TAŞIMAZ — amountMinor null döner', async () => {
    const p = providerWith([])
    const body = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      iyziReferenceCode: 'ref_1',
      iyziPaymentId: 999,
      token: 'tok_1',
      paymentConversationId: 'conv_1',
      status: 'SUCCESS',
    }
    const sig = computeIyzicoWebhookSignature({
      secretKey: IYZ.secretKey,
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      iyziPaymentId: '999',
      token: 'tok_1',
      paymentConversationId: 'conv_1',
      status: 'SUCCESS',
    })

    const hook = await p.handleWebhook({
      headers: new Headers({ 'x-iyz-signature-v3': sig }),
      rawBody: JSON.stringify(body),
      contentType: 'application/json',
    })

    expect(hook.signatureValid).toBe(true)
    expect(hook.status).toBe('CAPTURED')
    // Tutar bildirimde yok → webhook işleyicisi sunucuya SORMAK zorunda
    expect(hook.amountMinor).toBeNull()
    expect(hook.providerRef).toBe('conv_1')
    expect(hook.providerEventId).toBe('ref_1')
  })

  it('imza başlığı yoksa veya yanlışsa doğrulama başarısız', async () => {
    const p = providerWith([])
    const body = JSON.stringify({
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      iyziPaymentId: 1,
      token: 't',
      paymentConversationId: 'c',
      status: 'SUCCESS',
    })
    expect(p.verifyWebhook({ headers: new Headers(), rawBody: body, contentType: null })).toBe(false)
    expect(
      p.verifyWebhook({
        headers: new Headers({ 'x-iyz-signature-v3': 'deadbeef' }),
        rawBody: body,
        contentType: null,
      }),
    ).toBe(false)
  })

  it('getPaymentStatus retrieve ucunu çağırır ve kuruşa çevirir', async () => {
    const p = providerWith([
      {
        status: 'success',
        paymentStatus: 'SUCCESS',
        paymentId: '12345',
        paidPrice: '300.00',
        currency: 'TRY',
      },
    ])
    const res = await p.getPaymentStatus({ providerRef: 'conv_1', checkoutToken: 'tok_1' })

    expect(calls[0]!.url).toContain('/payment/iyzipos/checkoutform/auth/ecom/detail')
    expect(res.ok).toBe(true)
    expect(res.status).toBe('CAPTURED')
    expect(res.amountMinor).toBe(30_000)
    expect(res.providerTxnId).toBe('12345')
  })

  it('token olmadan durum sorgulanamaz (ağ isteği yapılmaz)', async () => {
    const p = providerWith([])
    const res = await p.getPaymentStatus({ providerRef: 'conv_1' })
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('⚠️ kimlik bilgisi YOKKEN ağ isteği YAPILMAZ', async () => {
    const fetchSpy = vi.fn()
    const unconfigured = new IyzicoPaymentProvider({
      apiKey: undefined,
      secretKey: undefined,
      baseUrl: 'https://sandbox-api.iyzipay.com',
      environment: 'sandbox',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(unconfigured.isConfigured).toBe(false)
    await expect(unconfigured.createPayment(BASE_INPUT)).rejects.toThrowError(
      ProviderNotConfiguredError,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('iade paymentTransactionId olmadan yapılmaz', async () => {
    const p = providerWith([])
    const res = await p.refundPayment({
      providerRef: 'conv_1',
      providerTxnId: null,
      amountMinor: 1000,
      currency: 'TRY',
      reason: 'test',
      refundRef: 'rf_1',
      buyerIp: '203.0.113.1',
    })
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
