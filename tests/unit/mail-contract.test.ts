/**
 * ⭐ E-POSTA SAĞLAYICI SÖZLEŞME TESTLERİ (Faz 10)
 *
 * ⚠️ GERÇEK E-POSTA GÖNDERİLMEZ. Ağ çağrısı `fetch` taklidiyle kesilir;
 * hiçbir teste gerçek API anahtarı verilmez ve hiçbir istek dışarı çıkmaz.
 *
 * Kanıtlanan sözleşme:
 *   1. Teslim edemeyen sağlayıcı "gönderildi" DEMEZ (`canDeliver`).
 *   2. Sağlayıcı isteği doğru şekli kurar (from/to/subject/text/html).
 *   3. Hata yollarında API ANAHTARI ve SAĞLAYICI GÖVDESİ sızmaz.
 *   4. Tüm şablonlar sağlayıcı katmanından geçebilir.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConsoleMailProvider,
  MemoryMailProvider,
  NoneMailProvider,
  ResendMailProvider,
  maskEmail,
  type OutgoingMail,
} from '@/server/mail/provider'
import { ORDER_EMAIL_TEMPLATES, renderEmail, type EmailPayload } from '@/server/mail/templates'

const API_KEY = 're_TESTANAHTARI_asla_gitmemeli_1234567890'
const TO = 'musteri@ornek.test'
const FROM = 'siparis@medya333.com'

const ORDER_VARS = {
  customerName: 'Ayşe',
  orderNo: 'M333-A1B2C3D4',
  platformName: 'Instagram',
  serviceName: 'Takipçi',
  variantLabel: 'Türk Takipçi',
  quantity: 500,
  unitLabel: 'takipçi',
  totalMinor: 34990,
  targetHandle: 'medya333',
  trackingUrl: 'https://www.medya333.com/siparis-takip?no=M333-A1B2C3D4&t=GIZLI_TOKEN',
}

const ALL_PAYLOADS: EmailPayload[] = [
  { template: 'ORDER_CREATED', variables: ORDER_VARS },
  { template: 'PAYMENT_RECEIVED', variables: ORDER_VARS },
  { template: 'ORDER_STARTED', variables: ORDER_VARS },
  { template: 'ORDER_PROGRESS', variables: { ...ORDER_VARS, delivered: 250, remaining: 250, percent: 50 } },
  { template: 'ORDER_COMPLETED', variables: { ...ORDER_VARS, delivered: 500, guaranteeDays: 365, guaranteeEndsAt: '2027-08-19T00:00:00.000Z' } },
  { template: 'REPLACEMENT_APPROVED', variables: { ...ORDER_VARS, replacementQuantity: 120 } },
  { template: 'REPLACEMENT_COMPLETED', variables: { ...ORDER_VARS, replacementQuantity: 120 } },
  { template: 'ORDER_TRACKING', variables: ORDER_VARS },
  { template: 'GUEST_CLAIM', variables: { claimUrl: 'https://www.medya333.com/hesabim?claim=X' } },
]

function outgoing(payload: EmailPayload): OutgoingMail {
  return { to: TO, template: payload.template, ...renderEmail(payload) }
}

// ===========================================================================
describe('⚠️ teslim edemeyen sağlayıcı "gönderildi" demez', () => {
  it('NoneMailProvider: canDeliver=false VE ok=false', async () => {
    const p = new NoneMailProvider()
    expect(p.canDeliver).toBe(false)
    const res = await p.send(outgoing(ALL_PAYLOADS[0]!))
    expect(res.ok).toBe(false)
  })

  it('ConsoleMailProvider: canDeliver=false (ok:true dönse bile teslim YOK)', async () => {
    const p = new ConsoleMailProvider()
    expect(p.canDeliver).toBe(false)
  })

  it('MemoryMailProvider: canDeliver=false — test kutusu teslim sayılmaz', async () => {
    const p = new MemoryMailProvider()
    expect(p.canDeliver).toBe(false)
    await p.send(outgoing(ALL_PAYLOADS[0]!))
    expect(p.outbox).toHaveLength(1)
  })

  it('ResendMailProvider: tek canDeliver=true olan sağlayıcı', () => {
    expect(new ResendMailProvider(API_KEY, FROM).canDeliver).toBe(true)
  })
})

// ===========================================================================
describe('⚠️ console sağlayıcısı GÖVDE yazmaz', () => {
  let logged: string[]

  beforeEach(() => {
    logged = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(' '))
    })
    vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(' '))
    })
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(' '))
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('log satırında e-posta gövdesi ve ham adres YOK', async () => {
    const mail = outgoing(ALL_PAYLOADS[0]!)
    await new ConsoleMailProvider().send(mail)

    const blob = logged.join('\n')
    expect(blob).not.toContain(mail.html)
    expect(blob).not.toContain(mail.text)
    // Ham adres yerine maskeli biçim
    expect(blob).not.toContain(TO)
    expect(blob).toContain(maskEmail(TO))
  })

  it('takip token\'ı log\'a düşmez', async () => {
    await new ConsoleMailProvider().send(outgoing(ALL_PAYLOADS[0]!))
    expect(logged.join('\n')).not.toContain('GIZLI_TOKEN')
  })
})

// ===========================================================================
describe('⭐ Resend sözleşmesi — gerçek gönderim YOK', () => {
  let calls: Array<{ url: string; init: RequestInit }>

  beforeEach(() => {
    calls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ id: 'resend-test-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('doğru uca, doğru gövdeyle POST eder', async () => {
    const mail = outgoing(ALL_PAYLOADS[1]!)
    const res = await new ResendMailProvider(API_KEY, FROM).send(mail)

    expect(res.ok).toBe(true)
    expect(res.id).toBe('resend-test-id')
    expect(calls).toHaveLength(1)

    const call = calls[0]!
    expect(call.url).toBe('https://api.resend.com/emails')
    expect(call.init.method).toBe('POST')

    const body = JSON.parse(call.init.body as string)
    expect(body.from).toBe(FROM)
    expect(body.to).toEqual([TO])
    expect(body.subject).toBe(mail.subject)
    expect(body.text).toBe(mail.text)
    expect(body.html).toBe(mail.html)
    // Fazladan alan gönderilmiyor — sağlayıcıya gereksiz veri verilmez.
    expect(Object.keys(body).sort()).toEqual(['from', 'html', 'subject', 'text', 'to'])
  })

  it('TÜM şablonlar sağlayıcı katmanından geçer', async () => {
    const p = new ResendMailProvider(API_KEY, FROM)
    for (const payload of ALL_PAYLOADS) {
      const res = await p.send(outgoing(payload))
      expect(res.ok, payload.template).toBe(true)
    }
    expect(calls).toHaveLength(ALL_PAYLOADS.length)
  })

  it('sipariş olayı şablonlarının HEPSİ kapsanmış', () => {
    const covered = new Set(ALL_PAYLOADS.map((p) => p.template))
    for (const key of ORDER_EMAIL_TEMPLATES) {
      expect(covered, `${key} sözleşme testinde yok`).toContain(key)
    }
  })
})

// ===========================================================================
describe('⚠️ hata yollarında SIR SIZMAZ', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sağlayıcı 4xx dönerse gövde TAŞINMAZ, yalnızca durum kodu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ message: `Invalid API key: ${API_KEY}`, name: 'validation_error' }),
            { status: 401 },
          ),
      ),
    )

    const res = await new ResendMailProvider(API_KEY, FROM).send(outgoing(ALL_PAYLOADS[0]!))

    expect(res.ok).toBe(false)
    expect(res.error).toBe('Sağlayıcı 401 döndü.')
    // ⚠️ En önemli satır: anahtar hata metnine geçmemiş.
    expect(JSON.stringify(res)).not.toContain(API_KEY)
    expect(JSON.stringify(res)).not.toContain('re_')
  })

  it('ağ hatasında yalnızca hata TÜRÜ taşınır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error(`connect ECONNREFUSED api.resend.com key=${API_KEY}`)
        err.name = 'TypeError'
        throw err
      }),
    )

    const res = await new ResendMailProvider(API_KEY, FROM).send(outgoing(ALL_PAYLOADS[0]!))

    expect(res.ok).toBe(false)
    expect(res.error).toBe('Sağlayıcıya ulaşılamadı: TypeError')
    expect(JSON.stringify(res)).not.toContain(API_KEY)
  })

  it('sağlayıcı ASLA fırlatmaz — bildirim kaydı yazılabilsin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('beklenmedik')
      }),
    )
    await expect(
      new ResendMailProvider(API_KEY, FROM).send(outgoing(ALL_PAYLOADS[0]!)),
    ).resolves.toMatchObject({ ok: false })
  })
})

// ===========================================================================
describe('adres maskeleme', () => {
  it('yerel kısım kısaltılır, alan adı korunur', () => {
    expect(maskEmail('musteri@ornek.test')).not.toContain('musteri')
    expect(maskEmail('musteri@ornek.test')).toContain('ornek.test')
  })

  it('çok kısa adresler de maskelenir', () => {
    for (const a of ['a@b.co', 'ab@c.io', 'x@y.z']) {
      expect(maskEmail(a), a).not.toBe(a)
    }
  })
})
