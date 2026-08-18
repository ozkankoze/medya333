import { describe, expect, it } from 'vitest'
import { ORDER_STATUS, type OrderStatus } from '@/lib/enums'
import {
  ACTIVE_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTerminal,
  PAID_STATUSES,
  TRANSITIONS,
} from '@/lib/orders/transitions'
import { computeProgress, deliveredFromMetric, ORDER_STATUS_META } from '@/lib/orders/status'

describe('state machine bütünlüğü', () => {
  it('her OrderStatus için geçiş tanımı vardır', () => {
    for (const s of ORDER_STATUS) {
      expect(TRANSITIONS[s], `${s} tanımsız`).toBeDefined()
    }
  })

  it('her hedef durum geçerli bir OrderStatus\'tür', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(ORDER_STATUS, `${from} → ${to}`).toContain(to)
      }
    }
  })

  it('hiçbir durum kendine geçemez (idempotency transition katmanında ele alınır)', () => {
    for (const s of ORDER_STATUS) {
      expect(TRANSITIONS[s]).not.toContain(s)
    }
  })

  it('her OrderStatus için meta tanımı vardır', () => {
    for (const s of ORDER_STATUS) {
      expect(ORDER_STATUS_META[s]?.label, `${s} etiketi yok`).toBeTruthy()
    }
  })

  it('REFUNDED tek terminal durumdur', () => {
    const terminals = ORDER_STATUS.filter((s) => isTerminal(s))
    expect(terminals).toEqual(['REFUNDED'])
  })

  it('DRAFT üzerinden her durum ulaşılabilirdir', () => {
    const reachable = new Set<OrderStatus>(['DRAFT'])
    let changed = true
    while (changed) {
      changed = false
      for (const from of [...reachable]) {
        for (const to of TRANSITIONS[from]) {
          if (!reachable.has(to)) {
            reachable.add(to)
            changed = true
          }
        }
      }
    }
    for (const s of ORDER_STATUS) expect(reachable.has(s), `${s} ulaşılamıyor`).toBe(true)
  })
})

describe('geçiş kuralları', () => {
  it('mutlu yol çalışır', () => {
    expect(canTransition('DRAFT', 'PENDING_PAYMENT')).toBe(true)
    expect(canTransition('PENDING_PAYMENT', 'PAID')).toBe(true)
    expect(canTransition('PAID', 'PROCESSING')).toBe(true)
    expect(canTransition('PROCESSING', 'STARTED')).toBe(true)
    expect(canTransition('STARTED', 'IN_PROGRESS')).toBe(true)
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true)
  })

  it('ödeme alınmadan işleme geçilemez', () => {
    expect(canTransition('PENDING_PAYMENT', 'PROCESSING')).toBe(false)
    expect(canTransition('PENDING_PAYMENT', 'STARTED')).toBe(false)
    expect(canTransition('PENDING_PAYMENT', 'COMPLETED')).toBe(false)
    expect(canTransition('DRAFT', 'PROCESSING')).toBe(false)
  })

  it('iade edilmiş sipariş hiçbir yere gidemez', () => {
    expect(allowedTransitions('REFUNDED')).toHaveLength(0)
  })

  it('başarısız ödeme yeniden denenebilir', () => {
    expect(canTransition('FAILED', 'PENDING_PAYMENT')).toBe(true)
  })

  it('PARTIAL hem tamamlanabilir hem iade edilebilir', () => {
    expect(canTransition('PARTIAL', 'COMPLETED')).toBe(true)
    expect(canTransition('PARTIAL', 'REFUNDED')).toBe(true)
  })

  it('assertTransition geçersizde InvalidTransitionError fırlatır', () => {
    expect(() => assertTransition('COMPLETED', 'PROCESSING')).toThrowError(InvalidTransitionError)
    expect(() => assertTransition('PROCESSING', 'STARTED')).not.toThrow()
  })
})

describe('durum kümeleri', () => {
  it('ödenmiş durumlar iade edilebilir olmalı', () => {
    for (const s of PAID_STATUSES) {
      const reachesRefund = TRANSITIONS[s].includes('REFUNDED') || TRANSITIONS[s].some((t) => TRANSITIONS[t].includes('REFUNDED'))
      expect(reachesRefund, `${s} iadeye ulaşamıyor`).toBe(true)
    }
  })

  it('aktif kuyruk ödenmiş durumların alt kümesidir', () => {
    for (const s of ACTIVE_STATUSES) expect(PAID_STATUSES.has(s)).toBe(true)
  })
})

describe('fulfillment ilerlemesi', () => {
  it('yüzdeyi doğru hesaplar', () => {
    expect(computeProgress({ quantity: 1000, deliveredQuantity: 420 })).toEqual({
      delivered: 420,
      remaining: 580,
      percent: 42,
    })
  })

  it('teslim miktarı hedefi aşamaz', () => {
    const r = computeProgress({ quantity: 1000, deliveredQuantity: 1500 })
    expect(r.delivered).toBe(1000)
    expect(r.percent).toBe(100)
    expect(r.remaining).toBe(0)
  })

  it('METRIC modunda fark hesaplanır, organik düşüş negatif olmaz', () => {
    expect(deliveredFromMetric(12_400, 12_820)).toBe(420)
    expect(deliveredFromMetric(12_400, 12_100)).toBe(0)
    expect(deliveredFromMetric(null, 12_820)).toBe(0)
  })
})
