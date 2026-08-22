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

/** "1.349,90 ₺" → 134990 kuruş. Brief metnini sayıya çevirir. */
function parseTrl(display: string): number {
  const digits = display.replace(/[^\d,]/g, '').replace(',', '.')
  return Math.round(Number(digits) * 100)
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
          /**
           * ⚠️ ORİJİNAL SIKILIĞA GERİ DÖNDÜ — hatta daha güçlü.
           *
           * Serbest miktara geçerken bir ara "türetme kuralı" doğrulanıyordu
           * (çapada +0,10 ₺ sapma vardı). Çapa tavanı eklendikten sonra sapma
           * SIFIR: müşteri çapa miktarında tam olarak katalog fiyatını ödüyor.
           * Kuruşu kuruşuna: 1.349,89 / 1.349,91 / 1.350,00 KABUL EDİLMEZ.
           */
          expect(displayPrice(priceOf(variant, quantity))).toBe(display)
        })
      }
    })
  }

  it('Instagram toplamı 63 fiyat noktasıdır', () => {
    const total = CASES.reduce((n, c) => n + c.expected.length, 0)
    expect(total).toBe(63)

    const seedTotal = (SERVICES.instagram ?? []).reduce(
      (n, s) => n + s.variants.reduce((m, v) => m + v.tiers.length, 0),
      0,
    )
    expect(seedTotal).toBe(63)
    // Katalogun TAMAMI: 63 Instagram + 27 YouTube + 43 FB + 50 TikTok
    // ⚠️ FB/TikTok "Türk Takipçi" kaldırıldığı için 199 değil 183.
    expect(TOTAL_PRICE_POINTS).toBe(183)
  })

  it('Instagram fiyat noktası dağılımı brief ile birebir aynıdır', () => {
    const instagramOnly = Object.fromEntries(
      Object.entries(EXPECTED_PRICE_POINTS).filter(([k]) => k.startsWith('instagram/')),
    )
    expect(instagramOnly).toEqual({
      'instagram/takipci/yabanci': 10,
      'instagram/takipci/turk': 8,
      'instagram/begeni/turk': 10,
      'instagram/goruntulenme/video': 9,
      'instagram/yorum/turk': 7,
      'instagram/kaydetme/standart': 7,
      'instagram/paylasim/standart': 7,
      'instagram/kesfet-paketi/kesfet': 1,
      'instagram/aylik-begeni-yorum-paketi/paket-1': 1,
      'instagram/aylik-begeni-yorum-paketi/paket-2': 1,
      'instagram/aylik-begeni-yorum-paketi/paket-3': 1,
      'instagram/aylik-begeni-yorum-paketi/paket-4': 1,
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

  it('⭐ listede olmayan miktar artık KABUL EDİLİR (7.342)', () => {
    // Eskiden QUANTITY_NOT_ALLOWED fırlatıyordu. Serbest miktara geçildi:
    // 7.342 → 5.000–9.999 bandı → 115 kr birim fiyat.
    expect(priceOf(turk, 7_342)).toBe(115 * 7_342)
  })

  it('⭐ SERBEST MİKTAR — 501 artık KABUL EDİLİR', () => {
    // Eskiden `QUANTITY_NOT_ALLOWED` fırlatıyordu (presetOnly). Katalog
    // FLAT_TIER'a geçtiği için 500–999 bandının birim fiyatı uygulanır.
    expect(priceOf(turk, 501)).toBe(140 * 501)
    expect(priceOf(turk, 567)).toBe(140 * 567)
    expect(priceOf(turk, 1_847)).toBe(135 * 1_847)
    expect(priceOf(turk, 12_436)).toBe(100 * 12_436)
  })

  it('⚠️ min/max SINIRI DURUYOR — serbestlik sınırsızlık değildir', () => {
    expect(() => priceOf(turk, turk.minQuantity - 1)).toThrowError(
      expect.objectContaining({ code: 'BELOW_MINIMUM' }),
    )
    expect(() => priceOf(turk, turk.maxQuantity + 1)).toThrowError(
      expect.objectContaining({ code: 'ABOVE_MAXIMUM' }),
    )
  })

  it('ölçülebilir varyantlar serbest, sabit paketler kilitli', () => {
    for (const service of SERVICES.instagram ?? []) {
      for (const v of service.variants) {
        const isBundle = v.maxQuantity === 1
        expect(v.presetOnly, `${service.slug}/${v.slug}`).toBe(isBundle)
        expect(v.presetQuantities.length).toBeGreaterThan(0)
        // Kademe modu da buna uymalı — ikisi ayrışırsa fiyat sessizce bozulur.
        for (const t of v.tiers) {
          expect(t.mode, `${service.slug}/${v.slug}`).toBe(isBundle ? 'PACKAGE' : 'FLAT_TIER')
        }
      }
    }
  })

  it('⚠️ birim fiyatlar miktar arttıkça ARTMAZ (eğri monoton)', () => {
    for (const service of SERVICES.instagram ?? []) {
      for (const v of service.variants) {
        if (v.maxQuantity === 1) continue
        const units = v.tiers.map((t) => t.unitPriceMinor)
        for (let i = 1; i < units.length; i++) {
          expect(units[i]!, `${service.slug}/${v.slug} kademe ${i}`).toBeLessThanOrEqual(units[i - 1]!)
        }
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
  it('⭐ karta basılan tutar EN KÜÇÜK SİPARİŞİN TOPLAMIDIR, birim fiyat değil', () => {
    const v = variantOf('takipci', 'yabanci')
    const entry = entryPriceOf(tiersOf(v))

    // `amountMinor` hâlâ en ucuz BİRİM fiyattır — yalnızca varyantlar arası
    // yüzde farkı için kullanılır (bkz. VariantPicker).
    expect(entry).toMatchObject({ kind: 'unit', amountMinor: 25 })

    /**
     * ⚠️ MÜŞTERİYE GÖSTERİLEN ALAN BU. 25 kuruşluk birim fiyata ancak
     * 1.000.000 takipçi alan biri ulaşır; "0,25 ₺'den başlar" yazmak
     * müşteriye asla karşılaşmayacağı bir rakam vaat ediyordu.
     * En küçük sipariş 500 takipçidir ve KATALOG FİYATI 324,90 ₺'dir —
     * 65 kr × 500 = 325,00 ₺ DEĞİL; çapa tavanı uygulanır.
     */
    expect(entry?.minOrderQuantity).toBe(500)
    expect(entry?.minOrderMinor).toBe(32_490)
  })

  it('sabit paketlerde giriş fiyatı HÂLÂ paket toplamıdır', () => {
    const kesfet = variantOf('kesfet-paketi', 'kesfet')
    expect(entryPriceOf(tiersOf(kesfet))).toEqual({
      kind: 'package',
      amountMinor: 100_000,
      quantity: 1,
      // Sabit pakette en küçük sipariş zaten paketin kendisidir.
      minOrderMinor: 100_000,
      minOrderQuantity: 1,
    })
  })

  it('⭐ listPriceAtQuantity her miktarda fiyat döner (artık null değil)', () => {
    const v = variantOf('begeni', 'turk')
    // Çapa noktası: 799,90 ₺ / 2.500 = 31,996 kr → 32 kr
    expect(listPriceAtQuantity(tiersOf(v), 2_500)).toBe(32 * 2_500)
    // Eskiden null dönerdi; artık aynı bandın birim fiyatı uygulanır.
    expect(listPriceAtQuantity(tiersOf(v), 2_501)).toBe(32 * 2_501)
  })
})

describe('katalog bütünlüğü', () => {
  it('aktif platformlar: Instagram · YouTube · Facebook · TikTok', () => {
    expect(Object.keys(SERVICES)).toEqual(['instagram', 'youtube', 'facebook', 'tiktok'])
  })

  it('Instagram\'da 8 hizmet vardır ve isimleri brief ile aynıdır', () => {
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

  it('⚠️ Instagram TAKİPÇİ garanti süresi 365 gündür', () => {
    const takipci = SERVICES.instagram?.find((s) => s.slug === 'takipci')
    expect(takipci?.variants.map((v) => [v.slug, v.refillDays])).toEqual([
      ['yabanci', 365],
      ['turk', 365],
    ])
  })

  it('⚠️ garanti süresi VERİLMEYEN hiçbir varyanta süre atanmamıştır', () => {
    for (const [platform, services] of Object.entries(SERVICES)) {
      for (const s of services) {
        for (const v of s.variants) {
          const isInstagramFollower = platform === 'instagram' && s.slug === 'takipci'
          expect(v.refillDays ?? null, `${platform}/${s.slug}/${v.slug}`).toBe(
            isInstagramFollower ? 365 : null,
          )
        }
      }
    }
  })

  it('kademeler moduna uygun ve POZİTİF fiyatlıdır', () => {
    for (const s of SERVICES.instagram ?? []) {
      for (const v of s.variants) {
        const isBundle = v.maxQuantity === 1
        for (const t of v.tiers) {
          if (isBundle) {
            // Sabit paketler DEĞİŞMEDİ: tutar okunur, çarpılmaz.
            expect(t.mode).toBe('PACKAGE')
            expect(t.packagePriceMinor).toBeGreaterThan(0)
            expect(t.minQuantity).toBe(t.maxQuantity)
            expect(t.unitPriceMinor).toBe(0)
          } else {
            expect(t.mode).toBe('FLAT_TIER')
            expect(t.unitPriceMinor).toBeGreaterThan(0)
            // ⭐ `packagePriceMinor` artık ÇAPA TAVANI taşıyor (null DEĞİL).
            //    Gerçek katalog fiyatının birebir korunmasını o sağlıyor.
            expect(t.packagePriceMinor).toBe(t.sourcePackagePriceMinor)
            expect(t.packagePriceMinor!).toBeGreaterThan(0)
            // ⚠️ Band artık TEK miktara kilitli DEĞİL — aralık kapsar.
            expect(t.maxQuantity === null || t.maxQuantity > t.minQuantity).toBe(true)
          }
        }
      }
    }
  })
})
