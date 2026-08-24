import { describe, expect, it } from 'vitest'
import { calculatePrice, PricingError, selectTier, validateQuantity } from '@/lib/pricing'
import { validateTiers } from '@/lib/pricing/tiers'
import type { PricingTier, QuantityConstraints } from '@/lib/pricing/types'
import { extractTaxFromGross, formatUnitPriceMinor } from '@/lib/money'

// Instagram · Takipçi · Standart — KDV DAHİL birim fiyatlar
const TIERS: PricingTier[] = [
  { id: 't1', mode: 'FLAT_TIER', minQuantity: 100, maxQuantity: 499, unitPriceMinor: 45, setupFeeMinor: 0, priority: 0 },
  { id: 't2', mode: 'FLAT_TIER', minQuantity: 500, maxQuantity: 999, unitPriceMinor: 38, setupFeeMinor: 0, priority: 0 },
  { id: 't3', mode: 'FLAT_TIER', minQuantity: 1000, maxQuantity: 4999, unitPriceMinor: 30, setupFeeMinor: 0, priority: 0 },
  { id: 't4', mode: 'FLAT_TIER', minQuantity: 5000, maxQuantity: null, unitPriceMinor: 24, setupFeeMinor: 0, priority: 0 },
]

const CONSTRAINTS: QuantityConstraints = { minQuantity: 100, maxQuantity: 100_000, quantityStep: 1 }
const KDV20 = 2000

function quote(quantity: number, extra: Partial<Parameters<typeof calculatePrice>[0]> = {}) {
  return calculatePrice({ quantity, tiers: TIERS, constraints: CONSTRAINTS, taxRateBp: KDV20, ...extra })
}

describe('kademe seçimi', () => {
  it('doğru kademeyi seçer', () => {
    expect(selectTier(TIERS, 100).id).toBe('t1')
    expect(selectTier(TIERS, 499).id).toBe('t1')
    expect(selectTier(TIERS, 500).id).toBe('t2')
    expect(selectTier(TIERS, 999).id).toBe('t2')
    expect(selectTier(TIERS, 1000).id).toBe('t3')
    expect(selectTier(TIERS, 4999).id).toBe('t3')
    expect(selectTier(TIERS, 5000).id).toBe('t4')
    expect(selectTier(TIERS, 999_999).id).toBe('t4')
  })

  it('kapsanmayan miktarda NO_PRICING_RULE fırlatır (fiyat boşluğu)', () => {
    const gapped: PricingTier[] = [TIERS[0]!, TIERS[3]!]
    expect(() => selectTier(gapped, 700)).toThrowError(PricingError)
    try {
      selectTier(gapped, 700)
    } catch (e) {
      expect((e as PricingError).code).toBe('NO_PRICING_RULE')
    }
  })

  it('çakışmada yüksek priority kazanır', () => {
    const promo: PricingTier = { id: 'promo', mode: 'FLAT_TIER', minQuantity: 100, maxQuantity: 999, unitPriceMinor: 20, setupFeeMinor: 0, priority: 10 }
    expect(selectTier([...TIERS, promo], 250).id).toBe('promo')
    expect(selectTier([...TIERS, promo], 2000).id).toBe('t3')
  })

  it('priority eşitse daha dar (yüksek min) kademe kazanır', () => {
    const wide: PricingTier = { id: 'wide', mode: 'FLAT_TIER', minQuantity: 1, maxQuantity: null, unitPriceMinor: 99, setupFeeMinor: 0, priority: 0 }
    expect(selectTier([wide, ...TIERS], 600).id).toBe('t2')
  })
})

describe('miktar doğrulama', () => {
  it('minimum altını reddeder', () => {
    expect(() => validateQuantity(50, CONSTRAINTS)).toThrowError(/en az 100/)
  })
  it('maksimum üstünü reddeder', () => {
    expect(() => validateQuantity(200_000, CONSTRAINTS)).toThrowError(/en fazla/)
  })
  it('adım ihlalini reddeder', () => {
    expect(() => validateQuantity(155, { minQuantity: 100, maxQuantity: 10_000, quantityStep: 50 })).toThrowError(/adımlarla/)
    expect(() => validateQuantity(150, { minQuantity: 100, maxQuantity: 10_000, quantityStep: 50 })).not.toThrow()
  })
  it('ondalık ve sıfırı reddeder', () => {
    expect(() => validateQuantity(100.5, CONSTRAINTS)).toThrowError(/tam sayı/)
    expect(() => validateQuantity(0, CONSTRAINTS)).toThrowError()
  })
})

describe('KDV DAHİL fiyat hesabı', () => {
  it('152 takipçi → 68,40 ₺ brüt, KDV ayrıştırılır', () => {
    const r = quote(152)
    expect(r.unitPriceMinor).toBe(45)
    expect(r.listSubtotalMinor).toBe(6840)
    expect(r.totalMinor).toBe(6840)
    // 6840 * 2000 / 12000 = 1140
    expect(r.taxAmountMinor).toBe(1140)
    expect(r.subtotalMinor).toBe(5700)
    // net * 1.20 = brüt
    expect(r.subtotalMinor + r.taxAmountMinor).toBe(r.totalMinor)
  })

  it('checkout tutarına KDV EKLENMEZ — total daima list - discount', () => {
    const r = quote(1000)
    expect(r.totalMinor).toBe(r.listSubtotalMinor - r.discountMinor)
    expect(r.totalMinor).toBe(30_000) // 1000 * 30 kuruş = 300,00 ₺
  })

  it('249,00 ₺ örneği tam bölünür', () => {
    const { taxAmountMinor, netMinor } = extractTaxFromGross(24_900, KDV20)
    expect(taxAmountMinor).toBe(4150)
    expect(netMinor).toBe(20_750)
    expect(netMinor + taxAmountMinor).toBe(24_900)
  })

  it('KDV %0 olduğunda vergi sıfırdır', () => {
    const r = quote(500, { taxRateBp: 0 })
    expect(r.taxAmountMinor).toBe(0)
    expect(r.subtotalMinor).toBe(r.totalMinor)
  })

  it('vergi yuvarlaması hiçbir miktarda toplamı bozmaz', () => {
    for (let q = 100; q <= 3000; q += 7) {
      const r = quote(q)
      expect(r.subtotalMinor + r.taxAmountMinor).toBe(r.totalMinor)
      expect(Number.isInteger(r.taxAmountMinor)).toBe(true)
    }
  })

  it('setup fee toplama dahil edilir', () => {
    const withFee: PricingTier[] = [{ ...TIERS[0]!, setupFeeMinor: 500 }]
    const r = calculatePrice({ quantity: 200, tiers: withFee, constraints: CONSTRAINTS, taxRateBp: KDV20 })
    expect(r.listSubtotalMinor).toBe(200 * 45 + 500)
  })
})

describe('indirimler', () => {
  it('yüzde kupon uygular (basis point)', () => {
    const r = quote(1000, { coupon: { type: 'PERCENTAGE', value: 1000, code: 'HOSGELDIN' } }) // %10
    expect(r.couponDiscountMinor).toBe(3000)
    expect(r.totalMinor).toBe(27_000)
    expect(r.subtotalMinor + r.taxAmountMinor).toBe(r.totalMinor)
  })

  it('sabit tutar kuponu uygular', () => {
    const r = quote(1000, { coupon: { type: 'FIXED_AMOUNT', value: 5000 } })
    expect(r.couponDiscountMinor).toBe(5000)
    expect(r.totalMinor).toBe(25_000)
  })

  it('yüzde indirimde tavan uygulanır', () => {
    const r = quote(5000, { coupon: { type: 'PERCENTAGE', value: 5000, maxDiscountMinor: 10_000 } })
    expect(r.couponDiscountMinor).toBe(10_000)
  })

  it('minimum sepet tutarı altında kupon uygulanmaz', () => {
    const r = quote(100, { coupon: { type: 'FIXED_AMOUNT', value: 1000, minOrderMinor: 100_000 } })
    expect(r.couponDiscountMinor).toBe(0)
  })

  it('indirim toplamı asla tutarı aşamaz (negatif total imkânsız)', () => {
    const r = quote(100, { coupon: { type: 'FIXED_AMOUNT', value: 999_999 } })
    expect(r.totalMinor).toBe(0)
    expect(r.totalMinor).toBeGreaterThanOrEqual(0)
  })

  it('stacking kapalıyken kampanya varsa kupon uygulanmaz', () => {
    const r = quote(1000, {
      campaign: { type: 'PERCENTAGE', value: 1000 },
      coupon: { type: 'PERCENTAGE', value: 1000 },
      allowStacking: false,
    })
    expect(r.campaignDiscountMinor).toBe(3000)
    expect(r.couponDiscountMinor).toBe(0)
  })

  it('stacking açıkken kupon kampanya sonrası tutara uygulanır', () => {
    const r = quote(1000, {
      campaign: { type: 'PERCENTAGE', value: 1000 }, // 30000 → -3000 = 27000
      coupon: { type: 'PERCENTAGE', value: 1000 }, // 27000 → -2700
      allowStacking: true,
    })
    expect(r.campaignDiscountMinor).toBe(3000)
    expect(r.couponDiscountMinor).toBe(2700)
    expect(r.totalMinor).toBe(24_300)
  })
})

describe('kademeli (GRADUATED) mod', () => {
  const grad: PricingTier[] = TIERS.map((t) => ({ ...t, mode: 'GRADUATED' as const }))

  it('her kademeye düşen adet kendi fiyatıyla hesaplanır', () => {
    // 750 adet: ilk 499 × 45 + sonraki 251 × 38
    const r = calculatePrice({ quantity: 750, tiers: grad, constraints: CONSTRAINTS, taxRateBp: KDV20 })
    expect(r.listSubtotalMinor).toBe(499 * 45 + 251 * 38)
  })

  it('tek kademe içindeki miktarda flat ile aynı sonucu verir', () => {
    const r = calculatePrice({ quantity: 300, tiers: grad, constraints: CONSTRAINTS, taxRateBp: KDV20 })
    expect(r.listSubtotalMinor).toBe(300 * 45)
  })
})

describe('upsell göstergesi (nextTier)', () => {
  it('bir sonraki ucuz kademeyi önerir', () => {
    const r = quote(450)
    expect(r.nextTier?.minQuantity).toBe(500)
    expect(r.nextTier?.unitPriceMinor).toBe(38)
    expect(r.nextTier?.unitSavingMinor).toBe(7)
    expect(r.nextTier?.totalAtNextTierMinor).toBe(500 * 38)
  })

  it('en üst kademede öneri yoktur', () => {
    expect(quote(9000).nextTier).toBeNull()
  })
})

describe('kademe sağlık kontrolü (admin)', () => {
  it('sağlam tabloda uyarı vermez', () => {
    const r = validateTiers(TIERS, { minQuantity: 100, maxQuantity: 100_000 })
    expect(r.ok).toBe(true)
    expect(r.gaps).toHaveLength(0)
    expect(r.overlaps).toHaveLength(0)
  })

  it('boşluğu tespit eder', () => {
    const r = validateTiers([TIERS[0]!, TIERS[2]!], { minQuantity: 100, maxQuantity: 4999 })
    expect(r.ok).toBe(false)
    expect(r.gaps).toEqual([{ fromQuantity: 500, toQuantity: 999 }])
  })

  it('eksik üst kademeyi boşluk olarak bildirir', () => {
    const r = validateTiers([TIERS[0]!, TIERS[1]!, TIERS[2]!], { minQuantity: 100, maxQuantity: 100_000 })
    expect(r.gaps).toEqual([{ fromQuantity: 5000, toQuantity: 100_000 }])
  })

  it('çakışmayı ve kazananı tespit eder', () => {
    const overlapping: PricingTier[] = [
      TIERS[0]!,
      { id: 'x', mode: 'FLAT_TIER', minQuantity: 400, maxQuantity: 999, unitPriceMinor: 40, setupFeeMinor: 0, priority: 0 },
    ]
    const r = validateTiers(overlapping, { minQuantity: 100, maxQuantity: 999 })
    expect(r.overlaps).toHaveLength(1)
    expect(r.overlaps[0]).toMatchObject({ fromQuantity: 400, toQuantity: 499, winnerId: 'x' })
  })

  it('sıfır/negatif fiyatı reddeder (parmak hatası koruması)', () => {
    const bad: PricingTier[] = [{ ...TIERS[0]!, unitPriceMinor: 0 }]
    const r = validateTiers(bad, { minQuantity: 100, maxQuantity: 499 })
    expect(r.ok).toBe(false)
    expect(r.invalid[0]?.reason).toMatch(/sıfır veya negatif/)
  })
})

/**
 * ⚠️ BİRİM FİYAT BİÇİMLENDİRME — KAYAN NOKTA TUZAĞI
 *
 * Bu testler bir GÖRÜNTÜ hatasını kilitler: `1,15 ₺`lik bir birim fiyat
 * fiyat tablosunda `1,1500 ₺` olarak çıkıyordu. Hiçbir hesap yanlış
 * değildi, hiçbir test kırılmıyordu — yalnızca tek bir satır dört haneli
 * görünüyordu ve bu, fiyat tablosuna bakan müşteride "burada bir şey
 * yanlış" hissi bırakır.
 *
 * Sebep: `Number.isInteger(amountMinor / 100 * 100)` — 115 için `false`.
 */
describe('birim fiyat biçimlendirme', () => {
  it('⚠️ TAM KURUŞ tutarlar İKİ HANE ile gösterilir', () => {
    // 115 kuruş: bölüp çarpınca 114.99999999999999 olan tam da bu değer.
    expect(formatUnitPriceMinor(115)).toBe('1,15 ₺')
    expect(formatUnitPriceMinor(65)).toBe('0,65 ₺')
    expect(formatUnitPriceMinor(4)).toBe('0,04 ₺')
    expect(formatUnitPriceMinor(140)).toBe('1,40 ₺')
  })

  it('⚠️ KURUŞ ALTI tutarlar DÖRT HANEYE iner — sıfıra yuvarlanmaz', () => {
    // Türetilmiş birim fiyatlar tam sayı olmayabilir; "0,00 ₺" yazmak
    // ücretsiz olduğu izlenimi verirdi.
    expect(formatUnitPriceMinor(0.65)).toBe('0,0065 ₺')
    expect(formatUnitPriceMinor(0.5)).toBe('0,0050 ₺')
  })

  it('kesirli kuruş tutarları dört hane ile gösterilir', () => {
    expect(formatUnitPriceMinor(64.98)).toBe('0,6498 ₺')
  })

  it('⚠️ HİÇBİR TAM KURUŞ tutar dört haneli çıkmaz (1–2000 kr taraması)', () => {
    // Nokta düzeltme yerine ARALIK taraması: aynı kayan nokta hatası
    // başka bir değerde saklanıyorsa burada yakalanır.
    for (let kurus = 1; kurus <= 2000; kurus++) {
      const text = formatUnitPriceMinor(kurus)
      expect(text, `${kurus} kuruş dört haneli çıktı: ${text}`).toMatch(/^\d+,\d{2} ₺$/)
    }
  })
})
