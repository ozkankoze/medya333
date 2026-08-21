import { describe, expect, it } from 'vitest'
import { calculatePrice } from '@/lib/pricing'
import type { PricingTier } from '@/lib/pricing/types'
import { formatMinor, applyBasisPoints } from '@/lib/money'
import {
  SERVICES,
  TOTAL_PRICE_POINTS,
  PRICE_POINTS_BY_PLATFORM,
  EXPECTED_PRICE_POINTS,
} from '../../prisma/seed/services'
import type { ServiceSeed, VariantSeed } from '../../prisma/seed/services'

/**
 * ⭐ FAZ 5.1 — KATALOG GENİŞLETME
 *
 * ⚠️ Beklenen değerler seed'den OKUNMAZ; brief'ten elle yazılmıştır.
 * YouTube'un 27 fiyat noktası ve Facebook/TikTok'un türetilmiş fiyatlarının
 * tamamı burada bağımsız olarak doğrulanır.
 */

const KDV_20 = 2000

function serviceOf(platform: string, slug: string): ServiceSeed {
  const s = SERVICES[platform]?.find((x) => x.slug === slug)
  if (!s) throw new Error(`Hizmet yok: ${platform}/${slug}`)
  return s
}

function variantOf(platform: string, service: string, variant: string): VariantSeed {
  const v = serviceOf(platform, service).variants.find((x) => x.slug === variant)
  if (!v) throw new Error(`Varyant yok: ${platform}/${service}/${variant}`)
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

/** Fiyat motorundan geçirir — kartın yazdığı değil, ÖDENECEK tutar. */
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

/** "1.349,90 ₺" → 134990 kuruş. Brief metnini sayıya çevirir. */
function parseTrl(display: string): number {
  const digits = display.replace(/[^\d,]/g, '').replace(',', '.')
  return Math.round(Number(digits) * 100)
}

function displayPrice(amountMinor: number): string {
  return formatMinor(amountMinor).replace(/ /g, ' ')
}

// ===========================================================================
//  YOUTUBE — 27 FİYAT NOKTASI
// ===========================================================================

type Expectation = readonly (readonly [number, string])[]

const YOUTUBE_CASES: ReadonlyArray<{
  label: string
  service: string
  variant: string
  expected: Expectation
}> = [
  {
    label: 'Türk Abone',
    service: 'abone',
    variant: 'turk',
    expected: [
      [100, '1.000,00 ₺'],
      [250, '2.250,00 ₺'],
      [500, '4.000,00 ₺'],
    ],
  },
  {
    label: 'Yabancı Abone',
    service: 'abone',
    variant: 'yabanci',
    expected: [
      [1_000, '2.500,00 ₺'],
      [2_500, '5.750,00 ₺'],
      [5_000, '10.500,00 ₺'],
      [10_000, '20.000,00 ₺'],
      [25_000, '47.500,00 ₺'],
      [50_000, '90.000,00 ₺'],
      [100_000, '170.000,00 ₺'],
    ],
  },
  {
    label: 'YouTube İzlenme',
    service: 'izlenme',
    variant: 'standart',
    expected: [
      [1_000, '400,00 ₺'],
      [2_500, '900,00 ₺'],
      [5_000, '1.600,00 ₺'],
      [10_000, '2.750,00 ₺'],
      [25_000, '6.000,00 ₺'],
      [50_000, '11.000,00 ₺'],
      [100_000, '20.000,00 ₺'],
    ],
  },
  {
    label: 'YouTube Beğeni',
    service: 'begeni',
    variant: 'standart',
    expected: [
      [100, '149,70 ₺'],
      [250, '329,70 ₺'],
      [500, '599,70 ₺'],
      [1_000, '1.049,70 ₺'],
      [2_500, '2.399,70 ₺'],
      [5_000, '4.199,70 ₺'],
      [10_000, '7.499,70 ₺'],
      [25_000, '16.499,70 ₺'],
      [50_000, '29.999,70 ₺'],
      [100_000, '55.499,70 ₺'],
    ],
  },
]

describe('YouTube kataloğu — 27 fiyat noktası', () => {
  for (const c of YOUTUBE_CASES) {
    describe(c.label, () => {
      const variant = variantOf('youtube', c.service, c.variant)

      it(`${c.expected.length} fiyat noktası tanımlı, fazlası/eksiği yok`, () => {
        expect(variant.presetQuantities).toEqual(c.expected.map(([q]) => q))
        expect(variant.tiers).toHaveLength(c.expected.length)
      })

      for (const [quantity, display] of c.expected) {
        it(`${quantity} → ${display}`, () => {
          // ⚠️ Çapa tavanı sayesinde katalog fiyatı BİREBİR korunuyor.
          expect(displayPrice(priceOf(variant, quantity))).toBe(display)
        })
      }
    })
  }

  it('YouTube toplamı 27 fiyat noktasıdır', () => {
    const fromCases = YOUTUBE_CASES.reduce((n, c) => n + c.expected.length, 0)
    expect(fromCases).toBe(27)

    const fromSeed = (SERVICES.youtube ?? []).reduce(
      (n, s) => n + s.variants.reduce((m, v) => m + v.tiers.length, 0),
      0,
    )
    expect(fromSeed).toBe(27)
    expect(PRICE_POINTS_BY_PLATFORM.youtube).toBe(27)
  })

  it('⚠️ Türk Abone üst sınırı 500; 501 ve 1.000 SEÇİLEMEZ', () => {
    const turk = variantOf('youtube', 'abone', 'turk')
    expect(turk.maxQuantity).toBe(500)
    // ⚠️ ÜST SINIR HÂLÂ DAYATILIYOR — serbest miktar sınırsız demek değil.
    expect(() => priceOf(turk, 501)).toThrowError(
      expect.objectContaining({ code: 'ABOVE_MAXIMUM' }),
    )
    expect(() => priceOf(turk, 1_000)).toThrowError(
      expect.objectContaining({ code: 'ABOVE_MAXIMUM' }),
    )
    // 150 artık GEÇERLİ bir ara miktardır (alt sınırın üstünde).
    expect(priceOf(turk, 150)).toBeGreaterThan(0)
  })

  it('⚠️ Yabancı Abone: 1.000.000 için FİYAT VERİLMEDİ, paket ÜRETİLMEDİ', () => {
    const yabanci = variantOf('youtube', 'abone', 'yabanci')
    expect(yabanci.presetQuantities).not.toContain(1_000_000)
    expect(yabanci.maxQuantity).toBe(100_000)
    expect(() => priceOf(yabanci, 1_000_000)).toThrowError(
      expect.objectContaining({ code: 'ABOVE_MAXIMUM' }),
    )
    // "Maksimum 1 Milyon" bilgisi yine de müşteriye ANLATILIR
    expect(yabanci.description).toContain('1 Milyon')
  })

  it('YouTube Beğeni, Instagram Türk Beğeni\'nin TAM 3 KATIDIR', () => {
    const ig = variantOf('instagram', 'begeni', 'turk')
    const yt = variantOf('youtube', 'begeni', 'standart')
    expect(yt.presetQuantities).toEqual(ig.presetQuantities)
    for (const q of ig.presetQuantities) {
      expect(anchorMinor(yt, q), `${q} beğeni`).toBe(anchorMinor(ig, q) * 3)
    }
  })

  it('hedef tipleri: Abone → PROFILE · İzlenme/Beğeni → VIDEO', () => {
    expect(serviceOf('youtube', 'abone').targetType).toBe('PROFILE')
    expect(serviceOf('youtube', 'izlenme').targetType).toBe('VIDEO')
    expect(serviceOf('youtube', 'begeni').targetType).toBe('VIDEO')
  })

  it('birim etiketleri doğrudur', () => {
    expect(serviceOf('youtube', 'abone').unitLabel).toBe('abone')
    expect(serviceOf('youtube', 'izlenme').unitLabel).toBe('izlenme')
    expect(serviceOf('youtube', 'begeni').unitLabel).toBe('beğeni')
  })
})

// ===========================================================================
//  FACEBOOK / TIKTOK — INSTAGRAM × %125
// ===========================================================================

/** Brief'in verdiği yuvarlama kuralı: 62,375 → 62,38 (en yakın kuruşa). */
/** Bir varyantın çapa (paket) fiyatını denetim izinden okur. */
function anchorMinor(v: VariantSeed, quantity: number): number {
  const tier = v.tiers.find((t) => t.minQuantity === quantity)
  if (!tier) throw new Error(`${v.slug}: ${quantity} çapası yok`)
  const src = tier.sourcePackagePriceMinor ?? tier.packagePriceMinor
  if (src == null) throw new Error(`${v.slug}: ${quantity} için kaynak fiyat yok`)
  return src
}

function expectedDerived(instagramMinor: number): number {
  return applyBasisPoints(instagramMinor, 12_500)
}

const DERIVED_PLATFORMS = ['facebook', 'tiktok'] as const

/** [platform hizmeti, Instagram kaynağı] eşlemesi */
const DERIVED_MAP: ReadonlyArray<
  readonly [service: string, variant: string, igService: string, igVariant: string]
> = [
  ['takipci', 'yabanci', 'takipci', 'yabanci'],
  ['takipci', 'turk', 'takipci', 'turk'],
  ['begeni', 'turk', 'begeni', 'turk'],
  ['goruntulenme', 'video', 'goruntulenme', 'video'],
  ['yorum', 'turk', 'yorum', 'turk'],
  ['paylasim', 'standart', 'paylasim', 'standart'],
]

describe('Facebook / TikTok — Instagram × %125', () => {
  it('⚠️ brief örneği: 49,90 ₺ → 62,38 ₺ (62,375 EN YAKIN KURUŞA yuvarlanır)', () => {
    expect(expectedDerived(4_990)).toBe(6_238)
    expect(displayPrice(6_238)).toBe('62,38 ₺')
  })

  it('yuvarlama kayan noktayla DEĞİL tam sayı kuruşla yapılır', () => {
    // (4990 × 125) / 100 = 6237,5 → yarı yukarı → 6238
    expect(Math.floor((4_990 * 125 * 2 + 100) / 200)).toBe(6_238)

    /**
     * ⚠️ %125 çarpanı (5/4) ikilik tabanda TAM temsil edildiği için bu
     * katsayıda kayan nokta tesadüfen doğru sonucu verir. Yöntem yine de
     * tam sayı aritmetiğidir: yarın çarpan %115 olursa kayan nokta SESSİZCE
     * bir kuruş aşağı kayar ve fiyat listesi bozulur.
     */
    const driftCases = [10_990, 449_990, 1_749_990, 3_249_990, 24_999_990]
    for (const v of driftCases) {
      const float = Math.round(v * 1.15)
      const integer = applyBasisPoints(v, 11_500)
      expect(integer, `${v} × %115`).toBe(float + 1)
    }
  })

  for (const platform of DERIVED_PLATFORMS) {
    describe(platform, () => {
      for (const [service, variant, igService, igVariant] of DERIVED_MAP) {
        it(`${service}/${variant} fiyatları Instagram'ın %125'idir`, () => {
          const ig = variantOf('instagram', igService, igVariant)
          const derived = variantOf(platform, service, variant)

          expect(derived.presetQuantities).toEqual(ig.presetQuantities)
          for (const q of ig.presetQuantities) {
            // ⚠️ Değişmez GERÇEK fiyat üzerinde doğrulanır. Yuvarlanmış birim
            //    fiyat üzerinden karşılaştırmak, yuvarlama hatasını
            //    "iş kuralı ihlali" gibi gösterirdi.
            const expected = expectedDerived(anchorMinor(ig, q))
            expect(anchorMinor(derived, q), `${platform}/${service} ${q}`).toBe(expected)
          }
        })
      }

      it('hiçbir türev fiyat Instagram fiyatına EŞİT değildir', () => {
        for (const [service, variant, igService, igVariant] of DERIVED_MAP) {
          const ig = variantOf('instagram', igService, igVariant)
          const derived = variantOf(platform, service, variant)
          for (const q of ig.presetQuantities) {
            // ⚠️ Çapa fiyatı üzerinden. Yuvarlanmış birim fiyatlar küçük
            //    miktarlarda EŞİTLENEBİLİR (ör. 25 kr vs 25 kr) — bu bir iş
            //    kuralı ihlali değil, kuruş tabanının doğal sonucudur.
            expect(anchorMinor(derived, q)).toBeGreaterThan(anchorMinor(ig, q))
          }
        }
      })
    })
  }

  it('⚠️ Instagram\'a ÖZGÜ paketler kopyalanmadı', () => {
    for (const platform of DERIVED_PLATFORMS) {
      const slugs = (SERVICES[platform] ?? []).map((s) => s.slug)
      expect(slugs, `${platform} keşfet`).not.toContain('kesfet-paketi')
      expect(slugs, `${platform} aylık`).not.toContain('aylik-begeni-yorum-paketi')
    }
  })

  it('⚠️ Facebook\'ta KAYDETME hizmeti YOK (herkese açık sayaç yok)', () => {
    expect((SERVICES.facebook ?? []).map((s) => s.slug)).not.toContain('kaydetme')
  })

  it('TikTok\'ta kaydetme VAR ve fiyatı Instagram kaydetmenin %125\'i', () => {
    const ig = variantOf('instagram', 'kaydetme', 'standart')
    const tt = variantOf('tiktok', 'kaydetme', 'standart')
    for (const q of ig.presetQuantities) {
      expect(anchorMinor(tt, q)).toBe(expectedDerived(anchorMinor(ig, q)))
    }
  })

  it('hedef tipleri adapter yeteneklerine uygundur', () => {
    // TikTok adapter'ı POST desteklemez; içerik zaten videodur.
    for (const s of SERVICES.tiktok ?? []) {
      expect(['PROFILE', 'VIDEO'], `tiktok/${s.slug}`).toContain(s.targetType)
    }
    expect(serviceOf('tiktok', 'takipci').targetType).toBe('PROFILE')
    expect(serviceOf('tiktok', 'begeni').targetType).toBe('VIDEO')

    for (const s of SERVICES.facebook ?? []) {
      expect(['PROFILE', 'POST', 'VIDEO'], `facebook/${s.slug}`).toContain(s.targetType)
    }
    expect(serviceOf('facebook', 'takipci').targetType).toBe('PROFILE')
    expect(serviceOf('facebook', 'goruntulenme').targetType).toBe('VIDEO')
    expect(serviceOf('facebook', 'begeni').targetType).toBe('POST')
  })

  it('fiyat noktası sayıları: Facebook 51 · TikTok 58', () => {
    const count = (platform: string) =>
      (SERVICES[platform] ?? []).reduce(
        (n, s) => n + s.variants.reduce((m, v) => m + v.tiers.length, 0),
        0,
      )
    expect(count('facebook')).toBe(51)
    expect(count('tiktok')).toBe(58)
    expect(PRICE_POINTS_BY_PLATFORM.facebook).toBe(51)
    expect(PRICE_POINTS_BY_PLATFORM.tiktok).toBe(58)
  })
})

// ===========================================================================
//  GARANTİ SÜRESİ
// ===========================================================================

describe('garanti süresi — yalnızca AÇIKÇA verilen değer', () => {
  it('Instagram Yabancı + Türk Takipçi → 365 gün', () => {
    expect(variantOf('instagram', 'takipci', 'yabanci').refillDays).toBe(365)
    expect(variantOf('instagram', 'takipci', 'turk').refillDays).toBe(365)
  })

  it('⚠️ YouTube hizmetlerinde garanti süresi YOK (verilmedi)', () => {
    for (const s of SERVICES.youtube ?? []) {
      for (const v of s.variants) {
        expect(v.refillDays ?? null, `youtube/${s.slug}/${v.slug}`).toBeNull()
      }
    }
  })

  it('⚠️ Facebook/TikTok hizmetlerinde garanti süresi YOK (verilmedi)', () => {
    for (const platform of DERIVED_PLATFORMS) {
      for (const s of SERVICES[platform] ?? []) {
        for (const v of s.variants) {
          expect(v.refillDays ?? null, `${platform}/${s.slug}/${v.slug}`).toBeNull()
        }
      }
    }
  })

  it('⚠️ "telafi sağlanır" ifadesi otomatik olarak 365 gün ANLAMINA GELMEZ', () => {
    // YouTube İzlenme açıklaması ücretsiz telafiden söz eder ama SÜRE vermez.
    const izlenme = variantOf('youtube', 'izlenme', 'standart')
    expect(izlenme.description).toContain('telafi')
    expect(izlenme.refillDays ?? null).toBeNull()
  })
})

// ===========================================================================
//  KATALOG TOPLAMI
// ===========================================================================

describe('katalog toplamı', () => {
  it('4 platform · 199 fiyat noktası', () => {
    expect(Object.keys(SERVICES).sort()).toEqual(['facebook', 'instagram', 'tiktok', 'youtube'])

    const total = Object.values(SERVICES).reduce(
      (n, list) => n + list.reduce((m, s) => m + s.variants.reduce((k, v) => k + v.tiers.length, 0), 0),
      0,
    )
    expect(total).toBe(199)
    expect(TOTAL_PRICE_POINTS).toBe(199)
    expect(
      Object.values(PRICE_POINTS_BY_PLATFORM).reduce((a, b) => a + b, 0),
    ).toBe(199)
  })

  it('EXPECTED_PRICE_POINTS tablosu seed ile birebir tutarlıdır', () => {
    for (const [key, expected] of Object.entries(EXPECTED_PRICE_POINTS)) {
      const [platform, service, variant] = key.split('/') as [string, string, string]
      expect(variantOf(platform, service, variant).tiers.length, key).toBe(expected)
    }
    const seedVariantCount = Object.values(SERVICES).reduce(
      (n, list) => n + list.reduce((m, s) => m + s.variants.length, 0),
      0,
    )
    expect(Object.keys(EXPECTED_PRICE_POINTS)).toHaveLength(seedVariantCount)
  })

  it('tüm platformlarda mod ile kilit TUTARLIDIR', () => {
    for (const [platform, list] of Object.entries(SERVICES)) {
      for (const s of list) {
        for (const v of s.variants) {
          const isBundle = v.maxQuantity === 1
          const where = `${platform}/${s.slug}/${v.slug}`
          expect(v.presetOnly, where).toBe(isBundle)
          for (const t of v.tiers) {
            if (isBundle) {
              expect(t.mode, where).toBe('PACKAGE')
              expect(t.packagePriceMinor).toBeGreaterThan(0)
              expect(t.minQuantity).toBe(t.maxQuantity)
            } else {
              expect(t.mode, where).toBe('FLAT_TIER')
              expect(t.unitPriceMinor).toBeGreaterThan(0)
            }
          }
        }
      }
    }
  })

  it('⚠️ TÜM platformlarda birim fiyat eğrisi monotondur', () => {
    for (const [platform, list] of Object.entries(SERVICES)) {
      for (const s of list) {
        for (const v of s.variants) {
          if (v.maxQuantity === 1) continue
          const units = v.tiers.map((t) => t.unitPriceMinor)
          for (let i = 1; i < units.length; i++) {
            expect(units[i]!, `${platform}/${s.slug}/${v.slug} kademe ${i}`)
              .toBeLessThanOrEqual(units[i - 1]!)
          }
        }
      }
    }
  })
})
