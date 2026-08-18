import { describe, expect, it } from 'vitest'
import { calculatePrice, entryPriceOf, listPriceAtQuantity, PricingError } from '@/lib/pricing'
import type { PricingTier } from '@/lib/pricing/types'
import { formatMinor } from '@/lib/money'
import { SERVICES, TOTAL_PRICE_POINTS, EXPECTED_PRICE_POINTS } from '../../prisma/seed/services'
import type { VariantSeed } from '../../prisma/seed/services'

/**
 * ⭐ GERÇEK FİYAT LİSTESİ — BİREBİR DOĞRULAMA (Faz 5)
 *
 * Buradaki beklenen değerler seed'den DEĞİL, brief'ten ELLE yazılmıştır.
 * Seed ile test aynı sabitten okusaydı test hiçbir şey kanıtlamazdı:
 * yanlış girilmiş bir fiyat sessizce "doğru" sayılırdı.
 *
 * Kabul edilmeyen sonuçlar: 1.349,89 · 1.349,91 · 1.350,00
 * Doğru sonuç: 1.349,90 ₺
 */

const KDV_20 = 2000

function variantOf(serviceSlug: string, variantSlug: string): VariantSeed {
  const service = SERVICES.instagram?.find((s) => s.slug === serviceSlug)
  if (!service) throw new Error(`Hizmet yok: ${serviceSlug}`)
  const variant = service.variants.find((v) => v.slug === variantSlug)
  if (!variant) throw new Error(`Varyant yok: ${serviceSlug}/${variantSlug}`)
  return variant
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

/** Kırılmaz boşluğu normalleştirir — karşılaştırma görünen metne göre yapılır. */
function displayPrice(amountMinor: number): string {
  return formatMinor(amountMinor).replace(/\u00a0/g, ' ')
}

function priceOf(v: VariantSeed, quantity: number): number {
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
  }).totalMinor
}

/** Brief'teki fiyat tablolarının ELLE yazılmış kopyası: [miktar, "gösterilen fiyat"] */
type Expectation = readonly (readonly [number, string])[]

const CASES: ReadonlyArray<{
  label: string
  service: string
  variant: string
  expected: Expectation
}> = [
  {
    label: 'Yabancı Takipçi',
    service: 'takipci',
    variant: 'yabanci',
    expected: [
      [500, '324,90 ₺'],
      [1_000, '599,90 ₺'],
      [2_500, '1.349,90 ₺'],
      [5_000, '2.499,90 ₺'],
      [10_000, '4.499,90 ₺'],
      [25_000, '9.999,90 ₺'],
      [50_000, '17.499,90 ₺'],
      [100_000, '32.499,90 ₺'],
      [250_000, '74.999,90 ₺'],
      [1_000_000, '249.999,90 ₺'],
    ],
  },
  {
    label: 'Türk Takipçi',
    service: 'takipci',
    variant: 'turk',
    expected: [
      [500, '699,90 ₺'],
      [1_000, '1.349,90 ₺'],
      [2_500, '2.999,90 ₺'],
      [5_000, '5.749,90 ₺'],
      [10_000, '9.999,90 ₺'],
      [25_000, '22.499,90 ₺'],
      [50_000, '39.999,90 ₺'],
      [100_000, '74.999,90 ₺'],
    ],
  },
  {
    label: 'Türk Beğeni',
    service: 'begeni',
    variant: 'turk',
    expected: [
      [100, '49,90 ₺'],
      [250, '109,90 ₺'],
      [500, '199,90 ₺'],
      [1_000, '349,90 ₺'],
      [2_500, '799,90 ₺'],
      [5_000, '1.399,90 ₺'],
      [10_000, '2.499,90 ₺'],
      [25_000, '5.499,90 ₺'],
      [50_000, '9.999,90 ₺'],
      [100_000, '18.499,90 ₺'],
    ],
  },
  {
    label: 'Video İzlenme',
    service: 'goruntulenme',
    variant: 'video',
    expected: [
      [1_000, '49,90 ₺'],
      [2_500, '99,90 ₺'],
      [5_000, '174,90 ₺'],
      [10_000, '299,90 ₺'],
      [25_000, '599,90 ₺'],
      [50_000, '999,90 ₺'],
      [100_000, '1.749,90 ₺'],
      [250_000, '3.499,90 ₺'],
      [500_000, '5.999,90 ₺'],
    ],
  },
  {
    label: 'Türk Yorum',
    service: 'yorum',
    variant: 'turk',
    expected: [
      [10, '49,90 ₺'],
      [25, '99,90 ₺'],
      [50, '199,90 ₺'],
      [100, '399,90 ₺'],
      [250, '999,90 ₺'],
      [500, '1.999,90 ₺'],
      [1_000, '3.999,90 ₺'],
    ],
  },
  {
    label: 'Paylaşım',
    service: 'paylasim',
    variant: 'standart',
    expected: [
      [100, '50,00 ₺'],
      [250, '100,00 ₺'],
      [500, '175,00 ₺'],
      [1_000, '300,00 ₺'],
      [2_500, '600,00 ₺'],
      [5_000, '900,00 ₺'],
      [10_000, '1.500,00 ₺'],
    ],
  },
  {
    label: 'Kaydetme',
    service: 'kaydetme',
    variant: 'standart',
    expected: [
      [100, '50,00 ₺'],
      [250, '100,00 ₺'],
      [500, '175,00 ₺'],
      [1_000, '300,00 ₺'],
      [2_500, '600,00 ₺'],
      [5_000, '900,00 ₺'],
      [10_000, '1.500,00 ₺'],
    ],
  },
  {
    label: 'Instagram Keşfet Paketi',
    service: 'kesfet-paketi',
    variant: 'kesfet',
    expected: [[1, '1.000,00 ₺']],
  },
  {
    label: 'Aylık Paket 1',
    service: 'aylik-begeni-yorum-paketi',
    variant: 'paket-1',
    expected: [[1, '1.250,00 ₺']],
  },
  {
    label: 'Aylık Paket 2',
    service: 'aylik-begeni-yorum-paketi',
    variant: 'paket-2',
    expected: [[1, '2.000,00 ₺']],
  },
  {
    label: 'Aylık Paket 3',
    service: 'aylik-begeni-yorum-paketi',
    variant: 'paket-3',
    expected: [[1, '2.750,00 ₺']],
  },
  {
    label: 'Aylık Paket 4',
    service: 'aylik-begeni-yorum-paketi',
    variant: 'paket-4',
    expected: [[1, '5.000,00 ₺']],
  },
]

describe('gerçek fiyat listesi — 63 fiyat noktası', () => {
  for (const c of CASES) {
    describe(c.label, () => {
      const variant = variantOf(c.service, c.variant)

      it(`${c.expected.length} fiyat noktası tanımlı, fazlası/eksiği yok`, () => {
        expect(variant.presetQuantities).toEqual(c.expected.map(([q]) => q))
        expect(variant.tiers).toHaveLength(c.expected.length)
      })

      for (const [quantity, display] of c.expected) {
        it(`${quantity} → ${display}`, () => {
          // ⚠️ Kuruşu kuruşuna: 1.349,89 / 1.349,91 / 1.350,00 KABUL EDİLMEZ
          expect(displayPrice(priceOf(variant, quantity))).toBe(display)
        })
      }
    })
  }

  it('toplam 63 fiyat noktası vardır', () => {
    const total = CASES.reduce((n, c) => n + c.expected.length, 0)
    expect(total).toBe(63)
    expect(TOTAL_PRICE_POINTS).toBe(63)

    const seedTotal = (SERVICES.instagram ?? []).reduce(
      (n, s) => n + s.variants.reduce((m, v) => m + v.tiers.length, 0),
      0,
    )
    expect(seedTotal).toBe(63)
  })

  it('fiyat noktası dağılımı brief ile birebir aynıdır', () => {
    expect(EXPECTED_PRICE_POINTS).toEqual({
      'takipci/yabanci': 10,
      'takipci/turk': 8,
      'begeni/turk': 10,
      'goruntulenme/video': 9,
      'yorum/turk': 7,
      'kaydetme/standart': 7,
      'paylasim/standart': 7,
      'kesfet-paketi/kesfet': 1,
      'aylik-begeni-yorum-paketi/paket-1': 1,
      'aylik-begeni-yorum-paketi/paket-2': 1,
      'aylik-begeni-yorum-paketi/paket-3': 1,
      'aylik-begeni-yorum-paketi/paket-4': 1,
    })
  })

  it('⚠️ 1.000.000 TÜRK takipçi paketi YOKTUR', () => {
    const turk = variantOf('takipci', 'turk')
    expect(turk.presetQuantities).not.toContain(1_000_000)
    expect(turk.maxQuantity).toBe(100_000)
    expect(() => priceOf(turk, 1_000_000)).toThrow(PricingError)
  })

  it('Kaydetme ve Paylaşım fiyatları BİREBİR aynıdır', () => {
    const kaydetme = variantOf('kaydetme', 'standart')
    const paylasim = variantOf('paylasim', 'standart')
    for (const q of kaydetme.presetQuantities) {
      expect(priceOf(kaydetme, q)).toBe(priceOf(paylasim, q))
    }
  })
})

describe('hazır miktar kilidi', () => {
  const turk = variantOf('takipci', 'turk')

  it('listede olmayan miktar REDDEDİLİR (7.342)', () => {
    expect(() => priceOf(turk, 7_342)).toThrowError(
      expect.objectContaining({ code: 'QUANTITY_NOT_ALLOWED' }),
    )
  })

  it('hazır miktarın 1 fazlası bile reddedilir (501)', () => {
    expect(() => priceOf(turk, 501)).toThrowError(
      expect.objectContaining({ code: 'QUANTITY_NOT_ALLOWED' }),
    )
  })

  it('tüm gerçek varyantlar hazır miktar kilitlidir', () => {
    for (const service of SERVICES.instagram ?? []) {
      for (const v of service.variants) {
        expect(v.presetOnly, `${service.slug}/${v.slug}`).toBe(true)
        expect(v.presetQuantities.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('sabit paket fiyatlandırma', () => {
  it('miktarla ÇARPILMAZ — paket fiyatı olduğu gibi okunur', () => {
    const kesfet = variantOf('kesfet-paketi', 'kesfet')
    const b = calculatePrice({
      quantity: 1,
      tiers: tiersOf(kesfet),
      constraints: {
        minQuantity: 1,
        maxQuantity: 1,
        quantityStep: 1,
        presetQuantities: [1],
        presetOnly: true,
      },
      taxRateBp: KDV_20,
    })
    expect(b.pricingMode).toBe('PACKAGE')
    expect(b.packagePriceMinor).toBe(100_000)
    expect(b.totalMinor).toBe(100_000)
    // Birim fiyat YOKTUR — 0'dır ve müşteriye gösterilmez.
    expect(b.unitPriceMinor).toBe(0)
    // "Biraz daha ekle, birim fiyat düşsün" ipucu anlamsızdır.
    expect(b.nextTier).toBeNull()
  })

  it('kırılım satırı "Paket fiyatı" der, "1 × birim fiyat" DEMEZ', () => {
    const kesfet = variantOf('kesfet-paketi', 'kesfet')
    const b = calculatePrice({
      quantity: 1,
      tiers: tiersOf(kesfet),
      constraints: { minQuantity: 1, maxQuantity: 1, quantityStep: 1, presetQuantities: [1], presetOnly: true },
      taxRateBp: KDV_20,
    })
    expect(b.lines[0]?.label).toBe('Paket fiyatı')
  })

  it('paket fiyatı tanımsızsa hesaplama YAPILMAZ', () => {
    const broken: PricingTier[] = [
      {
        id: 'x',
        mode: 'PACKAGE',
        minQuantity: 1,
        maxQuantity: 1,
        unitPriceMinor: 0,
        packagePriceMinor: null,
        setupFeeMinor: 0,
        priority: 0,
      },
    ]
    expect(() =>
      calculatePrice({
        quantity: 1,
        tiers: broken,
        constraints: { minQuantity: 1, maxQuantity: 1, quantityStep: 1, presetQuantities: [1], presetOnly: true },
        taxRateBp: KDV_20,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE_PRICE' }))
  })
})

describe('KDV — fiyatlar KDV DAHİL, brütten ayrıştırılır', () => {
  it('249,00 ₺ → 207,50 matrah + 41,50 KDV', () => {
    const tiers: PricingTier[] = [
      {
        id: 'x',
        mode: 'PACKAGE',
        minQuantity: 1,
        maxQuantity: 1,
        unitPriceMinor: 0,
        packagePriceMinor: 24_900,
        setupFeeMinor: 0,
        priority: 0,
      },
    ]
    const b = calculatePrice({
      quantity: 1,
      tiers,
      constraints: { minQuantity: 1, maxQuantity: 1, quantityStep: 1, presetQuantities: [1], presetOnly: true },
      taxRateBp: KDV_20,
    })
    expect(b.totalMinor).toBe(24_900)
    expect(b.taxAmountMinor).toBe(4_150)
    expect(b.subtotalMinor).toBe(20_750)
  })

  it('gerçek katalogda toplam = matrah + KDV, her fiyat noktasında', () => {
    for (const c of CASES) {
      const v = variantOf(c.service, c.variant)
      for (const [q] of c.expected) {
        const b = calculatePrice({
          quantity: q,
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
        expect(b.subtotalMinor + b.taxAmountMinor).toBe(b.totalMinor)
      }
    }
  })
})

describe('gösterim yardımcıları', () => {
  it('paket kademelerinde "…’den başlar" tutarı PAKET TOPLAMIDIR', () => {
    const v = variantOf('takipci', 'yabanci')
    const entry = entryPriceOf(tiersOf(v))
    expect(entry).toEqual({ kind: 'package', amountMinor: 32_490, quantity: 500 })
  })

  it('listPriceAtQuantity katalogdaki fiyatı birebir döner', () => {
    const v = variantOf('begeni', 'turk')
    expect(listPriceAtQuantity(tiersOf(v), 2_500)).toBe(79_990)
    expect(listPriceAtQuantity(tiersOf(v), 2_501)).toBeNull()
  })
})

describe('katalog bütünlüğü', () => {
  it('yalnızca Instagram platformu tanımlıdır', () => {
    expect(Object.keys(SERVICES)).toEqual(['instagram'])
  })

  it('8 hizmet vardır ve isimleri brief ile aynıdır', () => {
    expect((SERVICES.instagram ?? []).map((s) => s.name)).toEqual([
      'Takipçi',
      'Beğeni',
      'Görüntülenme',
      'Yorum',
      'Kaydetme',
      'Paylaşım',
      'Keşfet Paketi',
      'Aylık Türk Beğeni + Yorum Paketi',
    ])
  })

  it('hedef tipleri hizmete göre doğrudur', () => {
    const byslug = Object.fromEntries((SERVICES.instagram ?? []).map((s) => [s.slug, s.targetType]))
    expect(byslug).toEqual({
      takipci: 'PROFILE',
      begeni: 'POST',
      goruntulenme: 'VIDEO',
      yorum: 'POST',
      kaydetme: 'POST',
      paylasim: 'POST',
      'kesfet-paketi': 'POST',
      'aylik-begeni-yorum-paketi': 'PROFILE',
    })
  })

  it('birim etiketleri brief ile aynıdır', () => {
    const byslug = Object.fromEntries((SERVICES.instagram ?? []).map((s) => [s.slug, s.unitLabel]))
    expect(byslug).toEqual({
      takipci: 'takipçi',
      begeni: 'beğeni',
      goruntulenme: 'izlenme',
      yorum: 'yorum',
      kaydetme: 'kaydetme',
      paylasim: 'paylaşım',
      'kesfet-paketi': 'paket',
      'aylik-begeni-yorum-paketi': 'ay',
    })
  })

  it('tüm fiyat kademeleri PACKAGE modundadır ve pozitif fiyatlıdır', () => {
    for (const s of SERVICES.instagram ?? []) {
      for (const v of s.variants) {
        for (const t of v.tiers) {
          expect(t.mode).toBe('PACKAGE')
          expect(t.packagePriceMinor).toBeGreaterThan(0)
          expect(t.minQuantity).toBe(t.maxQuantity)
          expect(t.unitPriceMinor).toBe(0)
        }
      }
    }
  })
})
