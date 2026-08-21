/**
 * ⭐ SERBEST MİKTAR FİYATLANDIRMASI (paket → birim fiyat geçişi)
 *
 * ⚠️ NEDEN AYRI DOSYA?
 *
 * Katalog `PACKAGE`'tan `FLAT_TIER`'a geçti: müşteri artık 567 gibi herhangi
 * bir miktar seçebiliyor. Bu, GERÇEK SATIŞ FİYATINI değiştiren bir karardı ve
 * kuralı tek satırda özetlenebilir olmalı:
 *
 *     birim fiyat = round(gerçek paket fiyatı / miktar)
 *
 * Bu dosya o kuralı, kuralın bilinen istisnasını ve serbestliğin SINIRLARINI
 * sabitler. `catalog-prices.test.ts` brief fiyatlarının kendisini korur;
 * burası ARADAKİ miktarların davranışını korur.
 */

import { describe, expect, it } from 'vitest'
import { calculatePrice } from '@/lib/pricing'
import type { PricingTier } from '@/lib/pricing/types'
import { SERVICES, derivedUnitPriceMinor } from '../../prisma/seed/services'
import type { VariantSeed } from '../../prisma/seed/services'

const KDV_20 = 2000

function variantOf(service: string, variant: string): VariantSeed {
  const s = SERVICES.instagram?.find((x) => x.slug === service)
  const v = s?.variants.find((x) => x.slug === variant)
  if (!v) throw new Error(`${service}/${variant} yok`)
  return v
}

function tiersOf(v: VariantSeed): PricingTier[] {
  return v.tiers.map((t, i) => ({
    id: `${v.slug}-${i}`,
    mode: t.mode,
    minQuantity: t.minQuantity,
    maxQuantity: t.maxQuantity,
    unitPriceMinor: t.unitPriceMinor,
    packagePriceMinor: t.packagePriceMinor ?? null,
    setupFeeMinor: t.setupFeeMinor ?? 0,
    priority: 0,
  }))
}

function quote(v: VariantSeed, quantity: number) {
  return calculatePrice({
    quantity,
    tiers: tiersOf(v),
    constraints: {
      minQuantity: v.minQuantity,
      maxQuantity: v.maxQuantity,
      quantityStep: v.quantityStep,
      presetQuantities: v.presetQuantities,
      presetOnly: v.presetOnly,
    },
    taxRateBp: KDV_20,
  })
}

describe('türetme kuralı — ceil', () => {
  it('birim fiyat = ceil(paket / miktar)', () => {
    expect(derivedUnitPriceMinor([500, 32_490])).toBe(65) // 64,98 → 65
    expect(derivedUnitPriceMinor([1_000, 59_990])).toBe(60) // 59,99 → 60
    expect(derivedUnitPriceMinor([2_500, 134_990])).toBe(54) // 53,996 → 54
  })

  it('⭐ 100.000 YABANCI TAKİPÇİ = 33 kuruş (operatör kararı)', () => {
    // 32.499,90 ₺ / 100.000 = 32,4999 kr
    //   round() = 32 kr → 32.000,00 ₺  ← paket fiyatının ALTINDA, kabul edilemez
    //   ceil()  = 33 kr → 33.000,00 ₺  ← paketin üstünde, tavan devreye girer
    expect(derivedUnitPriceMinor([100_000, 3_249_990])).toBe(33)
    expect(33 * 100_000).toBe(3_300_000) // 100.000 × 0,33 ₺ = 33.000,00 ₺
  })

  it('⚠️ HİÇBİR kademe paket fiyatının ALTINA düşmez', () => {
    for (const [, list] of Object.entries(SERVICES)) {
      for (const svc of list) {
        for (const v of svc.variants) {
          if (v.maxQuantity === 1) continue
          for (const t of v.tiers) {
            const src = t.sourcePackagePriceMinor!
            expect(t.unitPriceMinor * t.minQuantity, `${v.slug}@${t.minQuantity}`)
              .toBeGreaterThanOrEqual(src)
          }
        }
      }
    }
  })
})

describe('⭐ ÇAPA TAVANI — katalog fiyatı BİREBİR korunur', () => {
  it('TÜM 194 ölçülebilir çapada sapma SIFIR', () => {
    let checked = 0
    for (const [, list] of Object.entries(SERVICES)) {
      for (const svc of list) {
        for (const v of svc.variants) {
          if (v.maxQuantity === 1) continue
          for (const t of v.tiers) {
            expect(quote(v, t.minQuantity).totalMinor, `${v.slug}@${t.minQuantity}`)
              .toBe(t.sourcePackagePriceMinor)
            checked++
          }
        }
      }
    }
    expect(checked).toBe(194)
  })

  it('100.000 yabancı: birim 33 kr ama ÖDENEN katalog fiyatı', () => {
    const yabanci = variantOf('takipci', 'yabanci')
    const b = quote(yabanci, 100_000)
    expect(b.unitPriceMinor).toBe(33) // kademenin ilan ettiği
    expect(b.totalMinor).toBe(3_249_990) // 32.499,90 ₺ — katalog fiyatı
    // Gösterilecek birim fiyat gerçekten ödenendir, kademe fiyatı değil.
    expect(b.effectiveUnitPriceMinor).toBeCloseTo(32.4999, 4)
  })
})

describe('⚠️ TERSLİK YOK — toplam miktarla birlikte ASLA azalmaz', () => {
  it('999 ile 1.000 arasındaki terslik KAPANDI', () => {
    const turk = variantOf('takipci', 'turk')
    // Eskiden: 999 → 1.398,60 ₺ · 1.000 → 1.350,00 ₺ (1 fazla, 48,60 ₺ az)
    expect(quote(turk, 999).totalMinor).toBe(134_990)
    expect(quote(turk, 1_000).totalMinor).toBe(134_990)
    expect(quote(turk, 999).totalMinor).toBeLessThanOrEqual(quote(turk, 1_000).totalMinor)
  })

  it('TÜM katalogda band sınırı komşuluklarında monotondur', () => {
    for (const [, list] of Object.entries(SERVICES)) {
      for (const svc of list) {
        for (const v of svc.variants) {
          if (v.maxQuantity === 1) continue
          for (const t of v.tiers) {
            for (const d of [-2, -1, 0, 1]) {
              const a = t.minQuantity + d
              const b = a + 1
              if (a < v.minQuantity || b > v.maxQuantity) continue
              expect(quote(v, a).totalMinor, `${v.slug} ${a}→${b}`)
                .toBeLessThanOrEqual(quote(v, b).totalMinor)
            }
          }
        }
      }
    }
  })
})

describe('⭐ ARADAKİ MİKTARLAR — kullanıcının örnekleri', () => {
  const turk = variantOf('takipci', 'turk')

  it.each([
    [567, 140, 79_380],
    [1_847, 135, 249_345],
    [12_436, 100, 1_243_600],
  ])('%i takipçi → %i kr birim · %i kuruş toplam', (qty, unit, total) => {
    const b = quote(turk, qty)
    expect(b.unitPriceMinor).toBe(unit)
    expect(b.totalMinor).toBe(total)
  })
})

describe('bir sonraki kademe ipucu', () => {
  it('gerçekten avantaj varsa gösterilir', () => {
    const turk = variantOf('takipci', 'turk')
    const b = quote(turk, 567)
    expect(b.nextTier).not.toBeNull()
    expect(b.nextTier!.minQuantity).toBe(1_000)
    expect(b.nextTier!.unitPriceMinor).toBe(135)
    expect(b.nextTier!.unitSavingMinor).toBe(5) // 140 → 135
  })

  it('son kademede ipucu YOKTUR — uydurulmaz', () => {
    const turk = variantOf('takipci', 'turk')
    expect(quote(turk, turk.maxQuantity).nextTier).toBeNull()
  })

  it('sabit pakette ipucu anlamsızdır', () => {
    const kesfet = variantOf('kesfet-paketi', 'kesfet')
    expect(quote(kesfet, 1).nextTier).toBeNull()
  })
})

describe('⚠️ SERBESTLİK SINIRSIZLIK DEĞİLDİR', () => {
  const turk = variantOf('takipci', 'turk')

  it('alt sınırın altı reddedilir', () => {
    expect(() => quote(turk, turk.minQuantity - 1)).toThrowError(
      expect.objectContaining({ code: 'BELOW_MINIMUM' }),
    )
  })

  it('üst sınırın üstü reddedilir', () => {
    expect(() => quote(turk, turk.maxQuantity + 1)).toThrowError(
      expect.objectContaining({ code: 'ABOVE_MAXIMUM' }),
    )
  })

  it('tam sayı olmayan miktar reddedilir', () => {
    expect(() => quote(turk, 567.5)).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUANTITY' }),
    )
  })

  it('takipçide minimum 500 KALDI — 100 uydurulmadı', () => {
    // Katalogda 500'ün altında fiyat noktası yok; oraya birim fiyat
    // uydurmak "fiyat uydurma" olurdu (operatör kararı).
    expect(turk.minQuantity).toBe(500)
    expect(variantOf('takipci', 'yabanci').minQuantity).toBe(500)
    // Beğeni/yorum kendi gerçek alt sınırlarını korur.
    expect(variantOf('begeni', 'turk').minQuantity).toBe(100)
    expect(variantOf('yorum', 'turk').minQuantity).toBe(10)
  })
})

describe('KDV brütten AYRIŞTIRILIR — eklenmez', () => {
  it('toplam = birim × miktar; KDV içeriden çıkar', () => {
    const b = quote(variantOf('takipci', 'turk'), 567)
    expect(b.totalMinor).toBe(140 * 567)
    expect(b.taxAmountMinor).toBe(Math.round((b.totalMinor * KDV_20) / (10_000 + KDV_20)))
    expect(b.subtotalMinor + b.taxAmountMinor).toBe(b.totalMinor)
  })
})
