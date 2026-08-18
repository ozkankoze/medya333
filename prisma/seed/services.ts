/**
 * ⭐ GERÇEK KATALOG — MEDYA 333 (Faz 5)
 *
 * ⚠️ BURADAKİ FİYATLAR GERÇEK SATIŞ FİYATLARIDIR.
 *    • Kuruşu kuruşuna müşteriye gösterilen, KDV DAHİL tutarlardır.
 *    • Yuvarlanmaz, birim fiyata çevrilmez, yeniden hesaplanmaz.
 *    • Listede olmayan hiçbir miktar/paket üretilmez.
 *
 * Fiyat modeli: `PACKAGE`. Her hazır miktarın KENDİ sabit toplamı vardır ve
 * `quantity × unitPrice` HİÇ çalıştırılmaz — 32490 / 500 = 64,98 kuruş olduğu
 * için birim fiyat üzerinden geri hesap kuruş kaybı üretirdi.
 *
 * `measurementMode`:
 *   METRIC       → sayılabilir (takipçi, beğeni, izlenme, kaydetme, paylaşım)
 *   MANUAL_COUNT → sayılamaz (yorum, keşfet paketi, aylık paket)
 */

export type TargetTypeSeed = 'PROFILE' | 'POST' | 'VIDEO' | 'CHANNEL' | 'GROUP'
export type MeasurementModeSeed = 'METRIC' | 'MANUAL_COUNT'
export type PricingModeSeed = 'FLAT_TIER' | 'GRADUATED' | 'PACKAGE'

export interface TierSeed {
  mode: PricingModeSeed
  minQuantity: number
  maxQuantity: number | null
  /** KDV DAHİL birim fiyat, kuruş. PACKAGE modunda 0 (kullanılmaz). */
  unitPriceMinor: number
  /** KDV DAHİL sabit paket fiyatı, kuruş. SADECE PACKAGE modunda. */
  packagePriceMinor?: number | null
  setupFeeMinor?: number
}

export interface VariantSeed {
  slug: string
  internalName: string
  customerLabel: string
  tagline?: string
  description?: string
  badge?: string
  isDefault?: boolean
  packageItems?: string[]
  minQuantity: number
  maxQuantity: number
  quantityStep: number
  presetQuantities: number[]
  presetOnly: boolean
  estimatedStartMinutes?: number
  estimatedCompleteMinutes?: number
  refillDays?: number
  tiers: TierSeed[]
}

export interface ServiceSeed {
  slug: string
  name: string
  shortDescription: string
  targetType: TargetTypeSeed
  measurementMode: MeasurementModeSeed
  /** Müşteriye gösterilen birim adı — SADECE gösterim, fiyat mantığına girmez */
  unitLabel: string
  inputLabel: string
  inputPlaceholder: string
  inputHelpText: string
  inputExample: string
  variants: VariantSeed[]
}

// ---------------------------------------------------------------------------
// Hedef girdisi tanımları — hangi hizmetin neyi istediği DB'den sürülür
// ---------------------------------------------------------------------------

const IG_PROFILE_INPUT = {
  inputLabel: 'Instagram kullanıcı adınız',
  inputPlaceholder: '@medya333 veya profil bağlantısı',
  inputHelpText: 'Hesabınızın herkese açık olması gerekir. Girdiğiniz hedefi onaylamanız istenecek.',
  inputExample: 'instagram.com/medya333',
} as const

const IG_POST_INPUT = {
  inputLabel: 'Gönderi bağlantısı',
  inputPlaceholder: 'instagram.com/p/... veya /reel/...',
  inputHelpText: 'Tarayıcıdaki tam adresi yapıştırın. Gönderinin herkese açık olması gerekir.',
  inputExample: 'instagram.com/p/CxYzAbCdEfG/',
} as const

const IG_VIDEO_INPUT = {
  inputLabel: 'Video / Reel bağlantısı',
  inputPlaceholder: 'instagram.com/reel/... veya /p/...',
  inputHelpText: 'Tarayıcıdaki tam adresi yapıştırın. Videonun herkese açık olması gerekir.',
  inputExample: 'instagram.com/reel/CxYzAbCdEfG/',
} as const

// ---------------------------------------------------------------------------
// Fabrikalar
// ---------------------------------------------------------------------------

/** [miktar, KDV dahil toplam kuruş] çiftleri — GERÇEK fiyat listesi. */
type PricePoint = readonly [quantity: number, priceMinor: number]

function packageTier([quantity, priceMinor]: PricePoint): TierSeed {
  return {
    mode: 'PACKAGE',
    // Kademe TEK miktara kilitlenir: 500 için tanımlı fiyat 501'i kapsamaz.
    minQuantity: quantity,
    maxQuantity: quantity,
    unitPriceMinor: 0, // PACKAGE modunda kullanılmaz
    packagePriceMinor: priceMinor,
  }
}

/**
 * HAZIR MİKTARLI varyant (preset package pricing).
 * Müşteri yalnızca listedeki miktarlardan birini seçebilir; slider yoktur.
 */
function presetVariant(v: {
  slug: string
  internalName: string
  customerLabel: string
  description?: string
  tagline?: string
  badge?: string
  isDefault?: boolean
  prices: readonly PricePoint[]
}): VariantSeed {
  const quantities = v.prices.map(([q]) => q)
  return {
    slug: v.slug,
    internalName: v.internalName,
    customerLabel: v.customerLabel,
    description: v.description,
    tagline: v.tagline,
    badge: v.badge,
    isDefault: v.isDefault ?? false,
    minQuantity: Math.min(...quantities),
    maxQuantity: Math.max(...quantities),
    quantityStep: 1,
    presetQuantities: quantities,
    presetOnly: true,
    tiers: v.prices.map(packageTier),
  }
}

/**
 * SABİT PAKET varyantı (fixed package).
 * Miktar her zaman 1'dir; içerik `packageItems` ile anlatılır ve içindeki
 * hizmetler AYRI AYRI fiyatlandırılmaz.
 */
function fixedPackageVariant(v: {
  slug: string
  internalName: string
  customerLabel: string
  description?: string
  badge?: string
  isDefault?: boolean
  packageItems: string[]
  priceMinor: number
}): VariantSeed {
  return {
    slug: v.slug,
    internalName: v.internalName,
    customerLabel: v.customerLabel,
    description: v.description,
    badge: v.badge,
    isDefault: v.isDefault ?? false,
    packageItems: v.packageItems,
    minQuantity: 1,
    maxQuantity: 1,
    quantityStep: 1,
    presetQuantities: [1],
    presetOnly: true,
    tiers: [packageTier([1, v.priceMinor])],
  }
}

// ---------------------------------------------------------------------------
// GERÇEK FİYAT LİSTELERİ  (KDV DAHİL, kuruş)
// ---------------------------------------------------------------------------

/** 10 fiyat noktası */
const YABANCI_TAKIPCI: readonly PricePoint[] = [
  [500, 32_490], // 324,90 ₺
  [1_000, 59_990], // 599,90 ₺
  [2_500, 134_990], // 1.349,90 ₺
  [5_000, 249_990], // 2.499,90 ₺
  [10_000, 449_990], // 4.499,90 ₺
  [25_000, 999_990], // 9.999,90 ₺
  [50_000, 1_749_990], // 17.499,90 ₺
  [100_000, 3_249_990], // 32.499,90 ₺
  [250_000, 7_499_990], // 74.999,90 ₺
  [1_000_000, 24_999_990], // 249.999,90 ₺
]

/** 8 fiyat noktası — ⚠️ 1.000.000 TÜRK takipçi paketi YOKTUR. */
const TURK_TAKIPCI: readonly PricePoint[] = [
  [500, 69_990], // 699,90 ₺
  [1_000, 134_990], // 1.349,90 ₺
  [2_500, 299_990], // 2.999,90 ₺
  [5_000, 574_990], // 5.749,90 ₺
  [10_000, 999_990], // 9.999,90 ₺
  [25_000, 2_249_990], // 22.499,90 ₺
  [50_000, 3_999_990], // 39.999,90 ₺
  [100_000, 7_499_990], // 74.999,90 ₺
]

/** 10 fiyat noktası */
const TURK_BEGENI: readonly PricePoint[] = [
  [100, 4_990], // 49,90 ₺
  [250, 10_990], // 109,90 ₺
  [500, 19_990], // 199,90 ₺
  [1_000, 34_990], // 349,90 ₺
  [2_500, 79_990], // 799,90 ₺
  [5_000, 139_990], // 1.399,90 ₺
  [10_000, 249_990], // 2.499,90 ₺
  [25_000, 549_990], // 5.499,90 ₺
  [50_000, 999_990], // 9.999,90 ₺
  [100_000, 1_849_990], // 18.499,90 ₺
]

/** 9 fiyat noktası */
const VIDEO_IZLENME: readonly PricePoint[] = [
  [1_000, 4_990], // 49,90 ₺
  [2_500, 9_990], // 99,90 ₺
  [5_000, 17_490], // 174,90 ₺
  [10_000, 29_990], // 299,90 ₺
  [25_000, 59_990], // 599,90 ₺
  [50_000, 99_990], // 999,90 ₺
  [100_000, 174_990], // 1.749,90 ₺
  [250_000, 349_990], // 3.499,90 ₺
  [500_000, 599_990], // 5.999,90 ₺
]

/** 7 fiyat noktası */
const TURK_YORUM: readonly PricePoint[] = [
  [10, 4_990], // 49,90 ₺
  [25, 9_990], // 99,90 ₺
  [50, 19_990], // 199,90 ₺
  [100, 39_990], // 399,90 ₺
  [250, 99_990], // 999,90 ₺
  [500, 199_990], // 1.999,90 ₺
  [1_000, 399_990], // 3.999,90 ₺
]

/**
 * 7 fiyat noktası. ⚠️ KAYDETME ve PAYLAŞIM fiyatları BİREBİR AYNIDIR;
 * ikisi de bu listeyi kullanır (kopyalanıp ayrışmasın diye tek sabit).
 */
const PAYLASIM_KAYDETME: readonly PricePoint[] = [
  [100, 5_000], // 50,00 ₺
  [250, 10_000], // 100,00 ₺
  [500, 17_500], // 175,00 ₺
  [1_000, 30_000], // 300,00 ₺
  [2_500, 60_000], // 600,00 ₺
  [5_000, 90_000], // 900,00 ₺
  [10_000, 150_000], // 1.500,00 ₺
]

// ---------------------------------------------------------------------------
// KATALOG — YALNIZCA INSTAGRAM
// ---------------------------------------------------------------------------

export const SERVICES: Record<string, ServiceSeed[]> = {
  instagram: [
    // -- 1 · TAKİPÇİ ---------------------------------------------------------
    {
      slug: 'takipci',
      name: 'Takipçi',
      shortDescription: 'Profilinize gerçek kullanıcı takipçisi kazandırın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'takipçi',
      ...IG_PROFILE_INPUT,
      variants: [
        presetVariant({
          slug: 'yabanci',
          internalName: 'IG-Takipci-Yabanci',
          customerLabel: 'Yabancı Takipçi',
          description:
            'Takipçiler yabancıdır, düşüş oranı %1 - %5 aralığındadır. Profiliniz her gün takip edilir ve herhangi bir düşüş yaşanmışsa aynı gün tekrardan yüklenir.',
          isDefault: true,
          prices: YABANCI_TAKIPCI,
        }),
        presetVariant({
          slug: 'turk',
          internalName: 'IG-Takipci-Turk',
          customerLabel: 'Türk Takipçi',
          description:
            'Takipçiler Türk’tür, düşüş oranı %1 - %5 aralığındadır. Profiliniz her gün takip edilir ve herhangi bir düşüş yaşanmışsa aynı gün tekrardan yüklenir.',
          prices: TURK_TAKIPCI,
        }),
      ],
    },

    // -- 2 · BEĞENİ ----------------------------------------------------------
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Gönderinize Türk hesaplardan beğeni gelsin.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'beğeni',
      ...IG_POST_INPUT,
      variants: [
        presetVariant({
          slug: 'turk',
          internalName: 'IG-Begeni-Turk',
          customerLabel: 'Türk Beğeni',
          description: 'Beğeniler tamamen Türk hesaplardan gelir.',
          isDefault: true,
          prices: TURK_BEGENI,
        }),
      ],
    },

    // -- 3 · GÖRÜNTÜLENME ----------------------------------------------------
    {
      slug: 'goruntulenme',
      name: 'Görüntülenme',
      shortDescription: 'Video ve reel içeriklerinizin izlenme sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'izlenme',
      ...IG_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'video',
          internalName: 'IG-Izlenme-Video',
          customerLabel: 'Video İzlenme',
          isDefault: true,
          prices: VIDEO_IZLENME,
        }),
      ],
    },

    // -- 4 · YORUM -----------------------------------------------------------
    {
      slug: 'yorum',
      name: 'Yorum',
      shortDescription: 'Gönderinize Türk hesaplardan yorum gelsin.',
      targetType: 'POST',
      measurementMode: 'MANUAL_COUNT',
      unitLabel: 'yorum',
      ...IG_POST_INPUT,
      variants: [
        presetVariant({
          slug: 'turk',
          internalName: 'IG-Yorum-Turk',
          customerLabel: 'Türk Yorum',
          isDefault: true,
          prices: TURK_YORUM,
        }),
      ],
    },

    // -- 5 · KAYDETME --------------------------------------------------------
    {
      slug: 'kaydetme',
      name: 'Kaydetme',
      shortDescription: 'Gönderinizin kaydedilme sayısını artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'kaydetme',
      ...IG_POST_INPUT,
      variants: [
        presetVariant({
          slug: 'standart',
          internalName: 'IG-Kaydetme',
          customerLabel: 'Kaydetme',
          isDefault: true,
          prices: PAYLASIM_KAYDETME,
        }),
      ],
    },

    // -- 6 · PAYLAŞIM --------------------------------------------------------
    {
      slug: 'paylasim',
      name: 'Paylaşım',
      shortDescription: 'Gönderinizin paylaşılma sayısını artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'paylaşım',
      ...IG_POST_INPUT,
      variants: [
        presetVariant({
          slug: 'standart',
          internalName: 'IG-Paylasim',
          customerLabel: 'Paylaşım',
          isDefault: true,
          prices: PAYLASIM_KAYDETME,
        }),
      ],
    },

    // -- 7 · KEŞFET PAKETİ ---------------------------------------------------
    {
      slug: 'kesfet-paketi',
      name: 'Keşfet Paketi',
      shortDescription: 'Tek gönderi için hazırlanmış karma etkileşim paketi.',
      targetType: 'POST',
      measurementMode: 'MANUAL_COUNT',
      unitLabel: 'paket',
      ...IG_POST_INPUT,
      variants: [
        fixedPackageVariant({
          slug: 'kesfet',
          internalName: 'IG-Kesfet-Paketi',
          customerLabel: 'Instagram Keşfet Paketi',
          isDefault: true,
          packageItems: [
            '500 - 1.500 Türk Beğeni',
            '10 - 35 Türk Yorum',
            '10.000 - 25.000 Görüntülenme',
            '250 - 500 Kaydetme',
            '50 - 150 Paylaşım',
          ],
          priceMinor: 100_000, // 1.000,00 ₺
        }),
      ],
    },

    // -- 8 · AYLIK TÜRK BEĞENİ + YORUM PAKETİ --------------------------------
    {
      slug: 'aylik-begeni-yorum-paketi',
      name: 'Aylık Türk Beğeni + Yorum Paketi',
      shortDescription:
        'Bu pakette 1 ayda maksimum 20 paylaşım yapma hakkınız vardır. Her paylaşımınıza ayrı ayrı belirtilen miktarlarda beğeni, yorum ve görüntülenme gelir.',
      targetType: 'PROFILE',
      measurementMode: 'MANUAL_COUNT',
      unitLabel: 'ay',
      ...IG_PROFILE_INPUT,
      variants: [
        fixedPackageVariant({
          slug: 'paket-1',
          internalName: 'IG-Aylik-Paket-1',
          customerLabel: 'Paket 1',
          description: '1 kere ödeme yapar ve 1 ay kullanırsınız.',
          isDefault: true,
          packageItems: ['100 Beğeni', '1.000 Görüntülenme', '1-5 Yorum', 'Ayda en fazla 20 paylaşım'],
          priceMinor: 125_000, // 1.250,00 ₺
        }),
        fixedPackageVariant({
          slug: 'paket-2',
          internalName: 'IG-Aylik-Paket-2',
          customerLabel: 'Paket 2',
          description: '1 kere ödeme yapar ve 1 ay kullanırsınız.',
          packageItems: ['250 Beğeni', '2.500 Görüntülenme', '5-10 Yorum', 'Ayda en fazla 20 paylaşım'],
          priceMinor: 200_000, // 2.000,00 ₺
        }),
        fixedPackageVariant({
          slug: 'paket-3',
          internalName: 'IG-Aylik-Paket-3',
          customerLabel: 'Paket 3',
          description: '1 kere ödeme yapar ve 1 ay kullanırsınız.',
          packageItems: ['500 Beğeni', '5.000 Görüntülenme', '10-20 Yorum', 'Ayda en fazla 20 paylaşım'],
          priceMinor: 275_000, // 2.750,00 ₺
        }),
        fixedPackageVariant({
          slug: 'paket-4',
          internalName: 'IG-Aylik-Paket-4',
          customerLabel: 'Paket 4',
          description: '1 kere ödeme yapar ve 1 ay kullanırsınız.',
          packageItems: [
            '1.000 Beğeni',
            '10.000 Görüntülenme',
            '20-50 Yorum',
            'Ayda en fazla 20 paylaşım',
          ],
          priceMinor: 500_000, // 5.000,00 ₺
        }),
      ],
    },
  ],
}

/**
 * Fiyat noktası sayıları — testler ve seed özeti bu tablodan doğrulanır.
 * Toplam 63. Buradaki hiçbir sayı elle değiştirilmemeli; katalog değişirse
 * testler kırılmalıdır.
 */
export const EXPECTED_PRICE_POINTS = {
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
} as const

export const TOTAL_PRICE_POINTS = 63
