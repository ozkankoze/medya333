import { describe, expect, it } from 'vitest'
import { findStepBoundaryIssues } from '@/lib/pricing'
import type { PricingTier } from '@/lib/pricing'

/**
 * TIER_BOUNDARY_UNREACHABLE
 *
 * `quantityStep` nedeniyle bir kademenin son miktarı seçilemiyorsa bu bir hata
 * değildir (sipariş yine geçer, fiyat boşluğu oluşmaz) — ama admin "1000'e
 * kadar bu fiyat" sanırken kademe aslında 950'de biter. Açık uyarı gerekir.
 */

function tier(id: string, min: number, max: number | null): PricingTier {
  return {
    id,
    mode: 'FLAT_TIER',
    minQuantity: min,
    maxQuantity: max,
    unitPriceMinor: 100,
    setupFeeMinor: 0,
    priority: 0,
  }
}

describe('findStepBoundaryIssues', () => {
  it('step 1 iken hiç uyarı üretmez', () => {
    const issues = findStepBoundaryIssues([tier('a', 100, 499), tier('b', 500, 1000)], {
      minQuantity: 100,
      maxQuantity: 1000,
      quantityStep: 1,
    })
    expect(issues).toHaveLength(0)
  })

  it('kademenin son miktarı seçilemiyorsa BOUNDARY uyarısı verir', () => {
    // min=100, step=50 → seçilebilir: 100, 150, … 450, 500 …
    // 100–499 kademesi pratikte 450'de biter.
    const issues = findStepBoundaryIssues([tier('a', 100, 499)], {
      minQuantity: 100,
      maxQuantity: 1000,
      quantityStep: 50,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      tierId: 'a',
      kind: 'BOUNDARY',
      declaredTo: 499,
      firstSelectable: 100,
      lastSelectable: 450,
    })
  })

  it('sınır adım katına denk geliyorsa uyarı ÜRETMEZ', () => {
    const issues = findStepBoundaryIssues([tier('a', 100, 450), tier('b', 500, 1000)], {
      minQuantity: 100,
      maxQuantity: 1000,
      quantityStep: 50,
    })
    expect(issues).toHaveLength(0)
  })

  it('aralıkta hiç seçilebilir miktar yoksa EMPTY uyarısı verir', () => {
    // min=100, step=100 → 100, 200, 300 … 120–180 aralığında hiçbiri yok.
    const issues = findStepBoundaryIssues([tier('a', 120, 180)], {
      minQuantity: 100,
      maxQuantity: 1000,
      quantityStep: 100,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.kind).toBe('EMPTY')
    expect(issues[0]?.lastSelectable).toBeNull()
  })

  it('sonsuz üst sınırlı kademede sınır kontrolü yapılmaz', () => {
    const issues = findStepBoundaryIssues([tier('a', 100, null)], {
      minQuantity: 100,
      maxQuantity: 1000,
      quantityStep: 50,
    })
    expect(issues).toHaveLength(0)
  })

  it('varyant aralığının tamamen dışındaki kademeyi ATLAR (UNREACHABLE_TIER kapsamı)', () => {
    const issues = findStepBoundaryIssues([tier('a', 5000, 9999)], {
      minQuantity: 100,
      maxQuantity: 1000,
      quantityStep: 50,
    })
    expect(issues).toHaveLength(0)
  })

  it('son kademe varyantın max değerinde bitiyorsa uyarı üretmez', () => {
    // 500–1000, max=1000, step=50 → 1000 seçilebilir
    const issues = findStepBoundaryIssues([tier('b', 500, 1000)], {
      minQuantity: 100,
      maxQuantity: 1000,
      quantityStep: 50,
    })
    expect(issues).toHaveLength(0)
  })
})
