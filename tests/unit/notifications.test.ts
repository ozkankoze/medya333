import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertSafeVariables,
  ORDER_EMAIL_TEMPLATES,
  renderEmail,
  UnsafeEmailVariableError,
  type EmailPayload,
  type OrderEmailVars,
} from '@/server/mail/templates'
import { maskEmail } from '@/server/mail/provider'
import {
  minorToLira,
  parseLiraToMinor,
  parseQuantityList,
} from '@/components/admin/admin-client'

/**
 * ⭐ FAZ 8 — E-POSTA ŞABLONU VE BİLDİRİM BİRİM TESTLERİ
 *
 * Bu dosya "e-posta gitti mi" sorusunu değil, "e-postada NE VAR" sorusunu
 * denetler. Şablonlar müşteriye giden tek yazılı yüzeydir; oraya sızan bir
 * iç enum ya da sır, geri alınamaz.
 */

const ORDER_VARS: OrderEmailVars = {
  customerName: 'Ayşe',
  orderNo: 'M333-ABCD1234',
  platformName: 'Instagram',
  serviceName: 'Takipçi',
  variantLabel: 'Türk Takipçi',
  quantity: 1000,
  unitLabel: 'takipçi',
  totalMinor: 134990,
  targetHandle: 'medya333',
  trackingUrl: 'https://medya333.com/siparisler/M333-ABCD1234?t=GIZLI',
}

const ALL_PAYLOADS: EmailPayload[] = [
  { template: 'ORDER_CREATED', variables: ORDER_VARS },
  { template: 'PAYMENT_RECEIVED', variables: ORDER_VARS },
  { template: 'ORDER_STARTED', variables: ORDER_VARS },
  { template: 'ORDER_TRACKING', variables: ORDER_VARS },
  {
    template: 'ORDER_PROGRESS',
    variables: { ...ORDER_VARS, delivered: 400, remaining: 600, percent: 40 },
  },
  {
    template: 'ORDER_COMPLETED',
    variables: {
      ...ORDER_VARS,
      delivered: 1000,
      guaranteeDays: 365,
      guaranteeEndsAt: '2027-08-19T00:00:00.000Z',
    },
  },
  {
    template: 'REPLACEMENT_APPROVED',
    variables: { ...ORDER_VARS, replacementQuantity: 120 },
  },
  {
    template: 'REPLACEMENT_COMPLETED',
    variables: { ...ORDER_VARS, replacementQuantity: 120 },
  },
  { template: 'GUEST_CLAIM', variables: { claimUrl: 'https://medya333.com/hesabim?claim=X' } },
]

// ===========================================================================
describe('e-posta şablonları', () => {
  it('şart koşulan 7 olayın hepsi için şablon var', () => {
    for (const key of [
      'ORDER_CREATED',
      'PAYMENT_RECEIVED',
      'ORDER_STARTED',
      'ORDER_COMPLETED',
      'ORDER_PROGRESS',
      'REPLACEMENT_APPROVED',
      'REPLACEMENT_COMPLETED',
    ] as const) {
      expect(ORDER_EMAIL_TEMPLATES, `${key} şablonu yok`).toContain(key)
    }
  })

  it('her şablon konu, düz metin ve HTML üretir', () => {
    for (const payload of ALL_PAYLOADS) {
      const r = renderEmail(payload)
      expect(r.subject.length, payload.template).toBeGreaterThan(5)
      expect(r.text.length, payload.template).toBeGreaterThan(20)
      expect(r.html, payload.template).toContain('<!doctype html>')
      // Mobil: viewport meta'sı olmadan e-posta telefonda küçücük görünür
      expect(r.html, payload.template).toContain('width=device-width')
    }
  })

  it('⚠️ hiçbir şablon İÇ ENUM veya teknik jargon göstermez', () => {
    const banned = [
      'READY',
      'PROCESSING',
      'REVIEW_REQUIRED',
      'FULFILLMENT',
      'PENDING_PAYMENT',
      'CAPTURED',
      'iyzico',
      'paytr',
      'mock',
      'webhook',
      'fulfillment',
      'null',
      'undefined',
      'NaN',
    ]
    for (const payload of ALL_PAYLOADS) {
      const blob = `${renderEmail(payload).subject}\n${renderEmail(payload).text}\n${renderEmail(payload).html}`
      for (const word of banned) {
        expect(blob, `${payload.template} içinde "${word}"`).not.toContain(word)
      }
    }
  })

  it('⚠️ şablonlar Türkçedir', () => {
    for (const payload of ALL_PAYLOADS) {
      const r = renderEmail(payload)
      expect(r.text, payload.template).toMatch(/[çğıöşüÇĞİÖŞÜ]|Sipariş|Merhaba/)
    }
  })

  it('müşteri adı varsa kişiselleştirir, yoksa nötr selamlar', () => {
    const withName = renderEmail({ template: 'ORDER_CREATED', variables: ORDER_VARS })
    expect(withName.text).toContain('Merhaba Ayşe,')

    const without = renderEmail({
      template: 'ORDER_CREATED',
      variables: { ...ORDER_VARS, customerName: null },
    })
    expect(without.text).toContain('Merhaba,')
    expect(without.text).not.toContain('Merhaba ,')
  })

  it('sipariş özeti güvenli alanları içerir', () => {
    const r = renderEmail({ template: 'ORDER_CREATED', variables: ORDER_VARS })
    expect(r.text).toContain('M333-ABCD1234')
    expect(r.text).toContain('Instagram')
    expect(r.text).toContain('Takipçi')
    expect(r.text).toContain('Türk Takipçi')
    expect(r.text).toContain('@medya333')
    expect(r.text).toContain('1.349,90')
    expect(r.text).toContain(ORDER_VARS.trackingUrl)
  })

  it('⚠️ GARANTİ TAHMİN EDİLMEZ: tanımlı değilse hiç yazılmaz', () => {
    const withG = renderEmail({
      template: 'ORDER_COMPLETED',
      variables: { ...ORDER_VARS, delivered: 1000, guaranteeDays: 365, guaranteeEndsAt: null },
    })
    expect(withG.text).toContain('365 gün telafi garantisi')

    const withoutG = renderEmail({
      template: 'ORDER_COMPLETED',
      variables: { ...ORDER_VARS, delivered: 1000, guaranteeDays: null, guaranteeEndsAt: null },
    })
    expect(withoutG.text).not.toContain('garanti')
    expect(withoutG.text).not.toContain('Garanti')
  })

  it('HTML kaçışı yapılır (şablon enjeksiyonu yok)', () => {
    const r = renderEmail({
      template: 'ORDER_CREATED',
      variables: { ...ORDER_VARS, customerName: '<script>alert(1)</script>' },
    })
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
  })
})

// ===========================================================================
describe('şablon değişkeni güvenlik kapısı', () => {
  it('yasaklı alan adları reddedilir', () => {
    for (const key of [
      'password',
      'secret',
      'trackingToken',
      'sessionToken',
      'authorization',
      'cardNumber',
      'cvv',
      'internalNote',
      'failureReason',
      'operatorId',
    ]) {
      expect(() => assertSafeVariables({ [key]: 'x' }), key).toThrow(UnsafeEmailVariableError)
    }
  })

  it('büyük/küçük harf farkı kapıyı atlatmaz', () => {
    expect(() => assertSafeVariables({ CVV: '123' })).toThrow()
    expect(() => assertSafeVariables({ TrackingToken: 'x' })).toThrow()
  })

  it('güvenli alanlar geçer', () => {
    expect(() => assertSafeVariables(ORDER_VARS as unknown as Record<string, unknown>)).not.toThrow()
  })

  it('⚠️ trackingUrl BİLİNÇLİ olarak serbesttir (token yalnızca URL içinde taşınır)', () => {
    expect(() => assertSafeVariables({ trackingUrl: 'https://x/y?t=abc' })).not.toThrow()
  })
})

// ===========================================================================
describe('e-posta maskeleme', () => {
  it('yerel kısmın yalnızca ilk iki karakteri kalır', () => {
    expect(maskEmail('ornek@site.com')).toBe('or***@site.com')
    expect(maskEmail('ab@site.com')).toBe('ab***@site.com')
  })

  it('geçersiz adres tamamen maskelenir', () => {
    expect(maskEmail('bozuk')).toBe('***')
    expect(maskEmail('@site.com')).toBe('***')
  })
})

// ===========================================================================
describe('TL → kuruş dönüşümü (admin girişi)', () => {
  it('⚠️ 1.349,90 tam olarak 134990 kuruş olur', () => {
    expect(parseLiraToMinor('1.349,90')).toBe(134990)
    expect(parseLiraToMinor('1349,90')).toBe(134990)
    expect(parseLiraToMinor('1349.90')).toBe(134990)
  })

  it('eksik kuruş basamağı sıfırla tamamlanır', () => {
    expect(parseLiraToMinor('1349,9')).toBe(134990)
    expect(parseLiraToMinor('1349')).toBe(134900)
  })

  it('⚠️ KAYAN NOKTA HATASI YOK — float ile farklı çıkan değerler doğru', () => {
    // parseFloat('8.29')*100 === 828.9999999999999
    for (const [text, expected] of [
      ['8,29', 829],
      ['0,29', 29],
      ['1,15', 115],
      ['70,07', 7007],
      ['1234,56', 123456],
    ] as const) {
      expect(parseLiraToMinor(text), text).toBe(expected)
    }
  })

  it('⚠️ AYIRICI BELİRSİZLİĞİ: nokta ondalık mı binlik mi doğru çözülür', () => {
    // Tek nokta + 2 hane ⇒ ONDALIK. Naif "tüm noktaları sil" yaklaşımı burada
    // 13.499.000 kuruş üretirdi: yüz kat fiyat hatası.
    expect(parseLiraToMinor('1349.90')).toBe(134990)
    expect(parseLiraToMinor('1349.9')).toBe(134990)
    // Tek nokta + 3 hane ⇒ Türkçe BİNLİK ayırıcı
    expect(parseLiraToMinor('1.234')).toBe(123400)
    expect(parseLiraToMinor('1.234.567')).toBe(123456700)
    // İki ayırıcı: sonuncusu ondalıktır
    expect(parseLiraToMinor('1.349,90')).toBe(134990)
    expect(parseLiraToMinor('1,349.90')).toBe(134990)
  })

  it('geçersiz girdi null döner — SIFIR SAYILMAZ', () => {
    for (const bad of ['', 'abc', '-5', '1,234,5', '1.2.3', '12,', ',5', '1..2', '₺100']) {
      expect(parseLiraToMinor(bad), bad).toBeNull()
    }
  })

  it('gidiş-dönüş kayıpsızdır', () => {
    for (const minor of [1, 29, 829, 134990, 999999]) {
      expect(parseLiraToMinor(minorToLira(minor))).toBe(minor)
    }
  })
})

describe('hazır miktar listesi ayrıştırma', () => {
  it('virgülle ayrılmış liste sıralanır ve tekilleşir', () => {
    expect(parseQuantityList('1000, 100,500, 100')).toEqual([100, 500, 1000])
  })

  it('binlik ayırıcı kabul edilir', () => {
    expect(parseQuantityList('1.000, 2.500')).toEqual([1000, 2500])
  })

  it('boş metin boş liste verir', () => {
    expect(parseQuantityList('   ')).toEqual([])
  })

  it('geçersiz parça tüm listeyi reddeder', () => {
    for (const bad of ['100, abc', '100, -5', '100, 0', '100, 1.5.2']) {
      expect(parseQuantityList(bad), bad).toBeNull()
    }
  })
})

// ===========================================================================
describe('bildirim mimarisi — kaynak kodu denetimi', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

  it('⚠️ sipariş/ödeme/fulfillment kodu ŞABLON KURMAZ (bildirim katmanı ayrı)', () => {
    const offenders: string[] = []
    for (const file of [
      'src/server/orders/create.ts',
      'src/server/orders/admin.ts',
      'src/server/orders/tracking.ts',
      'src/server/payments/webhook.ts',
      'src/server/fulfillment/operate.ts',
      'src/server/fulfillment/replacement.ts',
      'src/app/api/v1/orders/route.ts',
    ]) {
      const body = read(file)
      // Şablon derleme veya doğrudan gönderim BURADA olmamalı
      if (/renderEmail\(|sendEmail\(/.test(body)) offenders.push(file)
    }
    expect(offenders, 'e-posta doğrudan sipariş koduna gömülmüş').toEqual([])
  })

  it('⚠️ idempotency VERİTABANI kısıtıyla sağlanır, uygulama mantığıyla değil', () => {
    const schema = read('prisma/schema.prisma')
    expect(schema).toContain('@@unique([orderEventId, channel])')
  })

  it('⚠️ SMS/WhatsApp kanalı EKLENMEMİŞTİR', () => {
    const schema = read('prisma/schema.prisma')
    const block = schema.slice(
      schema.indexOf('enum NotificationChannel'),
      schema.indexOf('enum NotificationStatus'),
    )
    expect(block).toContain('EMAIL')
    expect(block).not.toContain('SMS')
    expect(block).not.toContain('WHATSAPP')
  })

  it('⚠️ console sağlayıcısı gövdeyi loglamaz', () => {
    const provider = read('src/server/mail/provider.ts')
    const consoleLines = provider
      .split('\n')
      .filter((l) => /console\.(log|error|warn)/.test(l))
    for (const line of consoleLines) {
      expect(line, `gövde loglanıyor: ${line}`).not.toMatch(/message\.(text|html)/)
    }
  })

  it('⚠️ üretimde e-posta sağlayıcısı yoksa BAŞARILI SAYILMAZ', () => {
    const provider = read('src/server/mail/provider.ts')
    // NoneMailProvider `ok:false` döner
    expect(provider).toMatch(/class NoneMailProvider[\s\S]*?ok:\s*false/)
    // console sağlayıcısı teslim edemez olarak işaretli
    expect(provider).toMatch(/class ConsoleMailProvider[\s\S]*?canDeliver = false/)
  })
})
