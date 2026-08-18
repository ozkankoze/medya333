import { describe, expect, it } from 'vitest'
import { maskPanInText, redactProviderPayload, safeLogLine } from '@/server/payments/redact'

/**
 * ÖDEME LOG'LARI VE SAKLANAN PAYLOAD (Faz 3 kuralı 26)
 *
 * Kart numarası, CVV, merchant secret ve imza girdileri ne veritabanına
 * ne de log'a yazılabilir. Bu testler o sınırı bekçiliğe alır.
 */

describe('kart numarası maskeleme', () => {
  it('geçerli (Luhn) kart numarasını maskeler', () => {
    // Yaygın olarak yayımlanan test kartı — gerçek bir karta ait değil
    expect(maskPanInText('kart: 4111111111111111')).toBe('kart: 411111******1111')
  })

  it('boşluk/tire ile yazılmış numarayı da yakalar', () => {
    expect(maskPanInText('4111 1111 1111 1111')).toContain('411111')
    expect(maskPanInText('4111 1111 1111 1111')).not.toContain('1111 1111 1111')
  })

  it('kart olmayan uzun sayıları BOZMAZ (Luhn kontrolü)', () => {
    expect(maskPanInText('sipariş 123456789012345')).toBe('sipariş 123456789012345')
    expect(maskPanInText('tutar 30000')).toBe('tutar 30000')
  })
})

describe('payload arındırma', () => {
  it('yasaklı anahtarları tamamen atar', () => {
    const out = redactProviderPayload({
      merchant_oid: 'OID1',
      status: 'success',
      total_amount: '30000',
      hash: 'gizli-hash',
      paytr_token: 'gizli-token',
      merchant_key: 'gizli-key',
      merchant_salt: 'gizli-salt',
      cardNumber: '4111111111111111',
      cvc: '123',
      expireMonth: '12',
      cardHolderName: 'AYSE YILMAZ',
      authorization: 'IYZWSv2 abc',
      signature: 'deadbeef',
    }) as Record<string, unknown>

    expect(out.merchant_oid).toBe('OID1')
    expect(out.status).toBe('success')
    expect(out.total_amount).toBe('30000')

    for (const k of [
      'hash',
      'paytr_token',
      'merchant_key',
      'merchant_salt',
      'cardNumber',
      'cvc',
      'expireMonth',
      'cardHolderName',
      'authorization',
      'signature',
    ]) {
      expect(out[k], k).toBe('[REDACTED]')
    }

    const json = JSON.stringify(out)
    expect(json).not.toContain('4111111111111111')
    expect(json).not.toContain('gizli-key')
    expect(json).not.toContain('gizli-salt')
    expect(json).not.toContain('AYSE YILMAZ')
  })

  it('PCI kapsamı dışındaki maskeli alanlar KORUNUR', () => {
    const out = redactProviderPayload({
      cardAssociation: 'MASTER_CARD',
      cardFamily: 'Bonus',
      lastFourDigits: '1111',
      binNumber: '411111',
    }) as Record<string, unknown>

    expect(out.cardAssociation).toBe('MASTER_CARD')
    expect(out.lastFourDigits).toBe('1111')
    expect(out.binNumber).toBe('411111')
  })

  it('iç içe yapılarda da çalışır', () => {
    const out = redactProviderPayload({
      data: { inner: { cvv: '999', ok: 'evet' } },
      list: [{ secret: 'x' }, { fine: 'y' }],
    })
    expect(JSON.stringify(out)).not.toContain('999')
    expect(JSON.stringify(out)).toContain('evet')
    expect(JSON.stringify(out)).toContain('fine')
  })

  it('metin içine gömülü kart numarasını maskeler', () => {
    const out = redactProviderPayload({ note: 'müşteri kartı 4111111111111111 ile ödedi' })
    expect(JSON.stringify(out)).not.toContain('4111111111111111')
  })

  it('derinlik ve uzunluk sınırlanır (log şişmesi)', () => {
    let deep: unknown = 'x'
    for (let i = 0; i < 12; i++) deep = { n: deep }
    expect(JSON.stringify(redactProviderPayload(deep))).toContain('[TRUNCATED]')

    const long = redactProviderPayload({ s: 'a'.repeat(2000) }) as { s: string }
    expect(long.s.length).toBeLessThan(600)
  })
})

describe('log satırı', () => {
  it('yasaklı alanları log\'a yazmaz', () => {
    const line = safeLogLine('payment.test', {
      orderNo: 'M333-ABCDEFGH',
      amountMinor: 30_000,
      merchantKey: 'gizli',
      cvv: '123',
    })
    expect(line).toContain('orderNo=M333-ABCDEFGH')
    expect(line).toContain('amountMinor=30000')
    expect(line).not.toContain('gizli')
    expect(line).not.toContain('123')
  })

  it('değer içindeki kart numarasını maskeler', () => {
    const line = safeLogLine('x', { note: '4111111111111111' })
    expect(line).not.toContain('4111111111111111')
  })
})
