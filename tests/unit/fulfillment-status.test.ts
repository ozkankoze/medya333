import { describe, expect, it } from 'vitest'
import { FULFILLMENT_STATUS, type FulfillmentStatus } from '@/lib/enums'
import {
  ACTIVE_FULFILLMENT_STATUSES,
  assertFulfillmentTransition,
  assertManualActor,
  AUTO_CREATABLE_STATUSES,
  AutomationNotAllowedError,
  canTransitionFulfillment,
  computeFulfillmentProgress,
  computeGuaranteeEnd,
  CUSTOMER_FULFILLMENT_VIEW,
  deliveredFromMetricDelta,
  FULFILLMENT_TRANSITIONS,
  goalMetric,
  InvalidFulfillmentTransitionError,
  isWithinGuarantee,
  MANUAL_ONLY_TRANSITIONS,
  QUEUE_BUCKETS,
  QUEUE_PRIORITY,
} from '@/lib/fulfillment/status'

describe('durum makinesi bütünlüğü', () => {
  it('her FulfillmentStatus için geçiş tanımı vardır', () => {
    for (const s of FULFILLMENT_STATUS) {
      expect(FULFILLMENT_TRANSITIONS[s], `${s} tanımsız`).toBeDefined()
    }
  })

  it('her hedef durum geçerli bir FulfillmentStatus\'tür', () => {
    for (const [from, targets] of Object.entries(FULFILLMENT_TRANSITIONS)) {
      for (const to of targets) {
        expect(FULFILLMENT_STATUS, `${from} → ${to}`).toContain(to)
      }
    }
  })

  it('her durum için müşteri metni ve kuyruk önceliği vardır', () => {
    for (const s of FULFILLMENT_STATUS) {
      expect(CUSTOMER_FULFILLMENT_VIEW[s]?.label, `${s} müşteri metni yok`).toBeTruthy()
      expect(QUEUE_PRIORITY[s], `${s} önceliği yok`).toBeGreaterThan(0)
    }
  })

  it('READY üzerinden her durum ulaşılabilirdir', () => {
    const reachable = new Set<FulfillmentStatus>(['READY'])
    let changed = true
    while (changed) {
      changed = false
      for (const from of [...reachable]) {
        for (const to of FULFILLMENT_TRANSITIONS[from]) {
          if (!reachable.has(to)) {
            reachable.add(to)
            changed = true
          }
        }
      }
    }
    for (const s of FULFILLMENT_STATUS) expect(reachable.has(s), `${s} ulaşılamıyor`).toBe(true)
  })

  it('kuyruk kovaları tüm durumları kapsar ve örtüşmez', () => {
    const seen = new Set<string>()
    for (const statuses of Object.values(QUEUE_BUCKETS)) {
      for (const s of statuses) {
        expect(seen.has(s), `${s} birden fazla kovada`).toBe(false)
        seen.add(s)
      }
    }
    for (const s of FULFILLMENT_STATUS) expect(seen.has(s), `${s} hiçbir kovada yok`).toBe(true)
  })
})

// ===========================================================================
describe('⚠️ OTOMATİK / MANUEL AYRIMI — bu fazın temel iş kuralı', () => {
  it('sistem YALNIZCA READY üretebilir', () => {
    expect([...AUTO_CREATABLE_STATUSES]).toEqual(['READY'])
    for (const s of FULFILLMENT_STATUS) {
      expect(AUTO_CREATABLE_STATUSES.has(s), s).toBe(s === 'READY')
    }
  })

  it('PROCESSING · STARTED · PARTIAL · COMPLETED · FAILED yalnızca MANUEL olur', () => {
    for (const s of ['PROCESSING', 'STARTED', 'PARTIAL', 'COMPLETED', 'FAILED'] as const) {
      expect(MANUAL_ONLY_TRANSITIONS.has(s), s).toBe(true)
    }
  })

  it('aktörsüz (sistem) çağrı manuel geçişleri REDDEDER', () => {
    for (const s of MANUAL_ONLY_TRANSITIONS) {
      expect(() => assertManualActor(s, null), s).toThrowError(AutomationNotAllowedError)
    }
  })

  it('insan aktörle manuel geçişler serbesttir', () => {
    for (const s of MANUAL_ONLY_TRANSITIONS) {
      expect(() => assertManualActor(s, 'user_1'), s).not.toThrow()
    }
  })

  it('READY ve REVIEW_REQUIRED aktör olmadan da işaretlenebilir', () => {
    expect(() => assertManualActor('READY', null)).not.toThrow()
    expect(() => assertManualActor('REVIEW_REQUIRED', null)).not.toThrow()
  })

  it('READY doğrudan STARTED veya COMPLETED olamaz', () => {
    expect(canTransitionFulfillment('READY', 'STARTED')).toBe(false)
    expect(canTransitionFulfillment('READY', 'COMPLETED')).toBe(false)
    expect(canTransitionFulfillment('READY', 'PARTIAL')).toBe(false)
  })

  it('mutlu yol: READY → PROCESSING → STARTED → COMPLETED', () => {
    expect(canTransitionFulfillment('READY', 'PROCESSING')).toBe(true)
    expect(canTransitionFulfillment('PROCESSING', 'STARTED')).toBe(true)
    expect(canTransitionFulfillment('STARTED', 'COMPLETED')).toBe(true)
  })

  it('PARTIAL ile STARTED arasında gidiş geliş serbest', () => {
    expect(canTransitionFulfillment('STARTED', 'PARTIAL')).toBe(true)
    expect(canTransitionFulfillment('PARTIAL', 'STARTED')).toBe(true)
    expect(canTransitionFulfillment('PARTIAL', 'COMPLETED')).toBe(true)
  })

  it('⚠️ COMPLETED geri alınamaz — tekrar STARTED olamaz', () => {
    expect(canTransitionFulfillment('COMPLETED', 'STARTED')).toBe(false)
    expect(canTransitionFulfillment('COMPLETED', 'PROCESSING')).toBe(false)
    expect(canTransitionFulfillment('COMPLETED', 'PARTIAL')).toBe(false)
    expect(canTransitionFulfillment('COMPLETED', 'FAILED')).toBe(false)
    // Yalnızca inceleme açılabilir
    expect(canTransitionFulfillment('COMPLETED', 'REVIEW_REQUIRED')).toBe(true)
    expect(() => assertFulfillmentTransition('COMPLETED', 'STARTED')).toThrowError(
      InvalidFulfillmentTransitionError,
    )
  })

  it('aktif kuyruk durumları doğru', () => {
    expect([...ACTIVE_FULFILLMENT_STATUSES].sort()).toEqual(['PARTIAL', 'PROCESSING', 'STARTED'])
  })
})

// ===========================================================================
describe('ilerleme hesabı', () => {
  it('temel hesap', () => {
    expect(computeFulfillmentProgress({ requestedQuantity: 1000, deliveredQuantity: 500 })).toEqual({
      requested: 1000,
      delivered: 500,
      remaining: 500,
      percent: 50,
      isFullyDelivered: false,
    })
  })

  it('⚠️ teslim istenen miktarı AŞAMAZ — kırpılır', () => {
    const r = computeFulfillmentProgress({ requestedQuantity: 1000, deliveredQuantity: 1500 })
    expect(r.delivered).toBe(1000)
    expect(r.remaining).toBe(0)
    expect(r.percent).toBe(100)
    expect(r.isFullyDelivered).toBe(true)
  })

  it('negatif teslim sıfıra çekilir', () => {
    const r = computeFulfillmentProgress({ requestedQuantity: 1000, deliveredQuantity: -50 })
    expect(r.delivered).toBe(0)
    expect(r.percent).toBe(0)
  })

  it('sıfır istenen miktarda bölme hatası olmaz', () => {
    const r = computeFulfillmentProgress({ requestedQuantity: 0, deliveredQuantity: 0 })
    expect(r.percent).toBe(0)
    expect(r.isFullyDelivered).toBe(false)
  })

  it('ondalık girdiler tam sayıya indirilir', () => {
    const r = computeFulfillmentProgress({ requestedQuantity: 1000.9, deliveredQuantity: 250.7 })
    expect(r.requested).toBe(1000)
    expect(r.delivered).toBe(250)
  })

  it('kalan her zaman requested - delivered', () => {
    for (const d of [0, 1, 333, 999, 1000]) {
      const r = computeFulfillmentProgress({ requestedQuantity: 1000, deliveredQuantity: d })
      expect(r.remaining).toBe(1000 - r.delivered)
    }
  })
})

// ===========================================================================
describe('metrik hesabı', () => {
  it('hedef = başlangıç + istenen', () => {
    expect(goalMetric(2340, 1000)).toBe(3340)
    expect(goalMetric(null, 1000)).toBeNull()
  })

  it('brief örneği: 2.340 → 2.840, 1.000 sipariş → 500 teslim', () => {
    const d = deliveredFromMetricDelta(2340, 2840, 2340)
    expect(d.deliveredFromMetric).toBe(500)
    expect(d.decreased).toBe(false)
  })

  it('⚠️ metrik geriye düşerse HATA VERMEZ, işaretler', () => {
    const d = deliveredFromMetricDelta(2340, 2950, 3000)
    expect(d.decreased).toBe(true)
    expect(d.dropAmount).toBe(50)
    // Teslim adedi başlangıca göre hesaplanır, negatife düşmez
    expect(d.deliveredFromMetric).toBe(610)
  })

  it('başlangıcın altına düşerse teslim sıfırdır (negatif olmaz)', () => {
    const d = deliveredFromMetricDelta(2340, 2000, 2340)
    expect(d.deliveredFromMetric).toBe(0)
    expect(d.decreased).toBe(true)
  })

  it('ölçüm yoksa hesap yapılmaz', () => {
    expect(deliveredFromMetricDelta(null, 500, null).deliveredFromMetric).toBe(0)
    expect(deliveredFromMetricDelta(100, null, null).deliveredFromMetric).toBe(0)
  })
})

// ===========================================================================
describe('garanti hesabı', () => {
  const base = new Date('2026-08-18T12:00:00.000Z')

  it('refillDays varsa bitiş tarihi hesaplanır', () => {
    const end = computeGuaranteeEnd(base, 30)
    expect(end).toEqual(new Date('2026-09-17T12:00:00.000Z'))
  })

  it('refillDays yoksa garanti yoktur', () => {
    expect(computeGuaranteeEnd(base, null)).toBeNull()
    expect(computeGuaranteeEnd(base, 0)).toBeNull()
    expect(computeGuaranteeEnd(base, undefined)).toBeNull()
  })

  it('garanti penceresi doğru kontrol edilir', () => {
    const end = computeGuaranteeEnd(base, 30)!
    expect(isWithinGuarantee(end, new Date('2026-09-01T00:00:00.000Z'))).toBe(true)
    expect(isWithinGuarantee(end, new Date('2026-09-18T00:00:00.000Z'))).toBe(false)
    expect(isWithinGuarantee(null, base)).toBe(false)
  })
})

// ===========================================================================
describe('müşteri durum eşlemesi', () => {
  it('⚠️ FAILED müşteriye "başarısız" DEMEZ', () => {
    const v = CUSTOMER_FULFILLMENT_VIEW.FAILED
    expect(v.label).toBe('İnceleniyor')
    expect(v.description).not.toMatch(/başarısız/i)
    expect(v.description).toContain('inceleniyor')
  })

  it('PARTIAL müşteriye güvenli mesaj verir', () => {
    expect(CUSTOMER_FULFILLMENT_VIEW.PARTIAL.description).toBe('İşleminiz devam ediyor.')
  })

  it('brief\'teki eşlemeler birebir', () => {
    expect(CUSTOMER_FULFILLMENT_VIEW.READY.description).toBe(
      'Siparişiniz onaylandı ve işlem sırasına alındı.',
    )
    expect(CUSTOMER_FULFILLMENT_VIEW.PROCESSING.description).toBe('İşleminiz hazırlanıyor.')
    expect(CUSTOMER_FULFILLMENT_VIEW.STARTED.description).toBe('İşleminiz başladı.')
    expect(CUSTOMER_FULFILLMENT_VIEW.COMPLETED.description).toBe('İşleminiz tamamlandı.')
    expect(CUSTOMER_FULFILLMENT_VIEW.REVIEW_REQUIRED.description).toBe(
      'Siparişiniz ekibimiz tarafından inceleniyor.',
    )
  })

  it('⚠️ hiçbir müşteri metni iç bilgi sızdırmaz', () => {
    // TAM KELİME eşleşmesi: "ip" alt dizisi Türkçede masum kelimelerin
    // içinde geçer ("sırasına"), substring kontrolü yanlış alarm verir.
    const forbidden = ['operatör', 'operator', 'internal', 'ip', 'maliyet', 'provider', 'audit', 'hata']
    for (const s of FULFILLMENT_STATUS) {
      const text = `${CUSTOMER_FULFILLMENT_VIEW[s].label} ${CUSTOMER_FULFILLMENT_VIEW[s].description}`
      const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      for (const word of forbidden) {
        expect(words, `${s} → ${word}`).not.toContain(word)
      }
    }
  })

  it('⚠️ POLLING terminal durumda DURUR', () => {
    expect(CUSTOMER_FULFILLMENT_VIEW.COMPLETED.polling).toBe(false)
    // Devam eden işlerde sürer
    for (const s of ['READY', 'PROCESSING', 'STARTED', 'PARTIAL'] as const) {
      expect(CUSTOMER_FULFILLMENT_VIEW[s].polling, s).toBe(true)
    }
  })
})

// ===========================================================================
describe('kuyruk önceliği', () => {
  it('READY en üstte, COMPLETED en altta', () => {
    expect(QUEUE_PRIORITY.READY).toBe(1)
    expect(QUEUE_PRIORITY.COMPLETED).toBe(7)
  })

  it('brief\'teki sıralama korunur', () => {
    const order = FULFILLMENT_STATUS.slice().sort((a, b) => QUEUE_PRIORITY[a] - QUEUE_PRIORITY[b])
    expect(order).toEqual([
      'READY',
      'PROCESSING',
      'STARTED',
      'PARTIAL',
      'REVIEW_REQUIRED',
      'FAILED',
      'COMPLETED',
    ])
  })
})
