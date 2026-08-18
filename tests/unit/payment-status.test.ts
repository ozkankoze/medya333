import { describe, expect, it, vi } from 'vitest'
import { PAYMENT_STATUS, type PaymentStatus } from '@/lib/enums'
import {
  assertPaymentTransition,
  canTransitionPayment,
  InvalidPaymentTransitionError,
  isInFlight,
  isNoOpTransition,
  isSettled,
  PAYMENT_IN_FLIGHT,
  PAYMENT_SETTLED,
  PAYMENT_STATUS_META,
  PAYMENT_TERMINAL_FAILURE,
  PAYMENT_TRANSITIONS,
  PAYMENT_UNLOCKS_ORDER,
  unlocksOrder,
} from '@/lib/payments/status'

describe('ödeme durum makinesi bütünlüğü', () => {
  it('her PaymentStatus için geçiş tanımı vardır', () => {
    for (const s of PAYMENT_STATUS) {
      expect(PAYMENT_TRANSITIONS[s], `${s} tanımsız`).toBeDefined()
    }
  })

  it('her hedef durum geçerli bir PaymentStatus\'tür', () => {
    for (const [from, targets] of Object.entries(PAYMENT_TRANSITIONS)) {
      for (const to of targets) {
        expect(PAYMENT_STATUS, `${from} → ${to}`).toContain(to)
      }
    }
  })

  it('her PaymentStatus için meta tanımı vardır', () => {
    for (const s of PAYMENT_STATUS) {
      expect(PAYMENT_STATUS_META[s]?.label, `${s} etiketi yok`).toBeTruthy()
    }
  })

  it('INITIATED üzerinden her durum ulaşılabilirdir', () => {
    const reachable = new Set<PaymentStatus>(['INITIATED'])
    let changed = true
    while (changed) {
      changed = false
      for (const from of [...reachable]) {
        for (const to of PAYMENT_TRANSITIONS[from]) {
          if (!reachable.has(to)) {
            reachable.add(to)
            changed = true
          }
        }
      }
    }
    for (const s of PAYMENT_STATUS) expect(reachable.has(s), `${s} ulaşılamıyor`).toBe(true)
  })

  it('durum kümeleri örtüşmez ve eksiksizdir', () => {
    for (const s of PAYMENT_SETTLED) expect(PAYMENT_IN_FLIGHT.has(s)).toBe(false)
    for (const s of PAYMENT_TERMINAL_FAILURE) {
      expect(PAYMENT_SETTLED.has(s)).toBe(false)
      expect(PAYMENT_IN_FLIGHT.has(s)).toBe(false)
    }
  })
})

describe('geçiş kuralları', () => {
  it('mutlu yol: INITIATED → PENDING_3DS → CAPTURED', () => {
    expect(canTransitionPayment('INITIATED', 'PENDING_3DS')).toBe(true)
    expect(canTransitionPayment('PENDING_3DS', 'CAPTURED')).toBe(true)
  })

  it('⚠️ SUCCESS → PENDING geri dönüşü YASAK', () => {
    expect(canTransitionPayment('CAPTURED', 'PENDING')).toBe(false)
    expect(canTransitionPayment('CAPTURED', 'PENDING_3DS')).toBe(false)
    expect(canTransitionPayment('CAPTURED', 'INITIATED')).toBe(false)
    expect(() => assertPaymentTransition('CAPTURED', 'PENDING')).toThrowError(
      InvalidPaymentTransitionError,
    )
  })

  it('⚠️ tahsil edilmiş ödeme FAILED olamaz (geç gelen başarısızlık)', () => {
    expect(canTransitionPayment('CAPTURED', 'FAILED')).toBe(false)
    expect(canTransitionPayment('CAPTURED', 'CANCELLED')).toBe(false)
  })

  it('SUCCESS → SUCCESS idempotent no-op\'tur, hata değil', () => {
    expect(isNoOpTransition('CAPTURED', 'CAPTURED')).toBe(true)
    // Geçiş tablosunda kendine geçiş yoktur — no-op ayrı ele alınır
    expect(canTransitionPayment('CAPTURED', 'CAPTURED')).toBe(false)
  })

  it('başarısız/iptal terminaldir — aynı satır canlanmaz', () => {
    expect(PAYMENT_TRANSITIONS.FAILED).toHaveLength(0)
    expect(PAYMENT_TRANSITIONS.CANCELLED).toHaveLength(0)
  })

  it('iade yalnızca tahsil edilmiş ödemeden yapılabilir', () => {
    expect(canTransitionPayment('CAPTURED', 'REFUNDED')).toBe(true)
    expect(canTransitionPayment('CAPTURED', 'PARTIALLY_REFUNDED')).toBe(true)
    expect(canTransitionPayment('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true)
    expect(canTransitionPayment('PENDING', 'REFUNDED')).toBe(false)
    expect(canTransitionPayment('FAILED', 'REFUNDED')).toBe(false)
  })

  it('kısmi iade birden fazla kez yapılabilir', () => {
    expect(canTransitionPayment('PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED')).toBe(true)
  })
})

describe('sipariş kilidini açan durumlar', () => {
  it('⚠️ SİPARİŞİ PAID YAPAN TEK DURUM: CAPTURED', () => {
    expect([...PAYMENT_UNLOCKS_ORDER]).toEqual(['CAPTURED'])
    for (const s of PAYMENT_STATUS) {
      expect(unlocksOrder(s), `${s}`).toBe(s === 'CAPTURED')
    }
  })

  it('bekleyen hiçbir durum siparişi açmaz', () => {
    for (const s of PAYMENT_IN_FLIGHT) expect(unlocksOrder(s)).toBe(false)
    expect(unlocksOrder('AUTHORIZED')).toBe(false) // ön provizyon tahsilat DEĞİL
  })

  it('yardımcılar tutarlı', () => {
    expect(isSettled('CAPTURED')).toBe(true)
    expect(isSettled('PENDING')).toBe(false)
    expect(isInFlight('PENDING_3DS')).toBe(true)
    expect(isInFlight('FAILED')).toBe(false)
  })
})

describe('müşteri metinleri', () => {
  it('yalnızca CAPTURED kesin başarı ifadesi taşır', () => {
    expect(PAYMENT_STATUS_META.CAPTURED.label).toBe('Ödeme başarılı')
    for (const s of PAYMENT_IN_FLIGHT) {
      expect(PAYMENT_STATUS_META[s].label, s).not.toContain('başarılı')
    }
  })

  it('bekleyen durumlar "doğrulanıyor" der ve tekrar denenemez', () => {
    for (const s of ['PENDING', 'PENDING_3DS', 'AUTHORIZED'] as const) {
      expect(PAYMENT_STATUS_META[s].label).toBe('Ödemeniz doğrulanıyor')
      expect(PAYMENT_STATUS_META[s].retryable).toBe(false)
    }
  })

  it('başarısız/iptal tekrar denenebilir', () => {
    expect(PAYMENT_STATUS_META.FAILED.retryable).toBe(true)
    expect(PAYMENT_STATUS_META.CANCELLED.retryable).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('yapılandırma güvenliği', () => {
  it('canlı ortamda mock sağlayıcı reddedilir', async () => {
    vi.resetModules()
    process.env.PAYMENT_ENVIRONMENT = 'production'
    process.env.PAYMENT_PROVIDER = 'mock'
    process.env.ORDER_TOKEN_SECRET ??= 'test-token-secret-test-token-secret-0123'
    process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000'

    const { assertPaymentConfig, getProvider } = await import('@/server/payments/registry')

    expect(() => assertPaymentConfig()).toThrowError(/PAYMENT_PROVIDER=mock olamaz/)
    // Mock çözülemez bile
    expect(() => getProvider('mock')).toThrowError()

    process.env.PAYMENT_ENVIRONMENT = 'sandbox'
    vi.resetModules()
  })

  it('sandbox ortamında mock çözülebilir', async () => {
    vi.resetModules()
    process.env.PAYMENT_ENVIRONMENT = 'sandbox'
    process.env.PAYMENT_PROVIDER = 'mock'
    const { assertPaymentConfig, getProvider } = await import('@/server/payments/registry')

    expect(() => assertPaymentConfig()).not.toThrow()
    expect(getProvider('mock').isConfigured).toBe(true)
    vi.resetModules()
  })
})
