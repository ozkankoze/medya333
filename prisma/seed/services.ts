/**
 * ⭐ GERÇEK KATALOG — MEDYA 333 (Faz 5)
 *
 * ⚠️ BURADAKİ FİYATLAR GERÇEK SATIŞ FİYATLARIDIR (KDV DAHİL, kuruş).
 *    Aşağıdaki listeler brief'ten BİREBİR alınmıştır ve DEĞİŞTİRİLMEZ.
 *
 * ⚠️ FİYAT MODELİ DEĞİŞTİ — SERBEST MİKTAR (operatör kararı).
 *
 *   ÖLÇÜLEBİLİR HİZMETLER → `FLAT_TIER`
 *     Müşteri 567 gibi herhangi bir miktar seçebilir. Birim fiyat, yukarıdaki
 *     gerçek fiyat listesinden TÜRETİLİR: `round(paket / miktar)`.
 *     Ayrıntı ve tek istisna: `bandTiers()` başlığı.
 *
 *   SABİT PAKETLER (aylık paket, keşfet) → `PACKAGE` — DEĞİŞMEDİ
 *     Miktar her zaman 1'dir; tutar okunur, çarpılmaz.
 *
 * ⚠️ Türetilen birim fiyat çapa noktasında +0,10 ₺ fark üretir. Kaynak fiyat
 *    `TierSeed.sourcePackagePriceMinor` içinde denetim izi olarak durur.
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
  /**
   * ⚠️ YALNIZCA DENETİM İZİ — fiyat hesabında KULLANILMAZ, veritabanına YAZILMAZ.
   *
   * `FLAT_TIER`'a geçerken birim fiyat bu çapa fiyatından türetildi. Kaynağı
   * kademede tutmak iki işe yarar: (1) testler %125 / ×3 gibi katalog
   * değişmezlerini GERÇEK fiyat üzerinden doğrulayabilir — yuvarlanmış birim
   * fiyat üzerinden değil; (2) "bu 65 kuruş nereden geldi?" sorusu kodun
   * içinden cevaplanabilir.
   */
  sourcePackagePriceMinor?: number
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

const YT_CHANNEL_INPUT = {
  inputLabel: 'YouTube kanal bağlantınız',
  inputPlaceholder: '@medya333 veya kanal bağlantısı',
  inputHelpText: 'Kanalın herkese açık olması gerekir. Girdiğiniz hedefi onaylamanız istenecek.',
  inputExample: 'youtube.com/@medya333',
} as const

const YT_VIDEO_INPUT = {
  inputLabel: 'Video bağlantısı',
  inputPlaceholder: 'youtube.com/watch?v=... veya /shorts/...',
  inputHelpText: 'Tarayıcıdaki tam adresi yapıştırın. Videonun herkese açık olması gerekir.',
  inputExample: 'youtube.com/watch?v=dQw4w9WgXcQ',
} as const

const FB_PROFILE_INPUT = {
  inputLabel: 'Facebook sayfa/profil bağlantınız',
  inputPlaceholder: 'facebook.com/medya333',
  inputHelpText: 'Sayfanın herkese açık olması gerekir. Girdiğiniz hedefi onaylamanız istenecek.',
  inputExample: 'facebook.com/medya333',
} as const

const FB_POST_INPUT = {
  inputLabel: 'Gönderi bağlantısı',
  inputPlaceholder: 'facebook.com/medya333/posts/...',
  inputHelpText: 'Tarayıcıdaki tam adresi yapıştırın. Gönderinin herkese açık olması gerekir.',
  inputExample: 'facebook.com/medya333/posts/123456789',
} as const

const FB_VIDEO_INPUT = {
  inputLabel: 'Video bağlantısı',
  inputPlaceholder: 'facebook.com/medya333/videos/...',
  inputHelpText: 'Tarayıcıdaki tam adresi yapıştırın. Videonun herkese açık olması gerekir.',
  inputExample: 'facebook.com/medya333/videos/123456789',
} as const

const TT_PROFILE_INPUT = {
  inputLabel: 'TikTok kullanıcı adınız',
  inputPlaceholder: '@medya333 veya profil bağlantısı',
  inputHelpText: 'Hesabınızın herkese açık olması gerekir. Girdiğiniz hedefi onaylamanız istenecek.',
  inputExample: 'tiktok.com/@medya333',
} as const

const TT_VIDEO_INPUT = {
  inputLabel: 'Video bağlantısı',
  inputPlaceholder: 'tiktok.com/@medya333/video/...',
  inputHelpText: 'Tarayıcıdaki tam adresi yapıştırın. Videonun herkese açık olması gerekir.',
  inputExample: 'tiktok.com/@medya333/video/7301234567890123456',
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
 * ⭐ SERBEST MİKTAR — TÜRETİLMİŞ BİRİM FİYAT KADEMELERİ
 *
 * ⚠️ BU DÖNÜŞÜM GERÇEK SATIŞ FİYATINI DEĞİŞTİRİR. Bilinçli bir karardır.
 *
 * Önceki model: her miktarın KENDİ sabit toplamı vardı (`PACKAGE`) ve müşteri
 * yalnızca listedeki miktarları alabilirdi. Serbest miktar (567 takipçi) için
 * bir BİRİM fiyat gerekiyor — ve gerçek paket fiyatları tam kuruşa bölünmüyor:
 *
 *     324,90 ₺ / 500 = 64,9800 kuruş   ← tam sayı değil
 *
 * Kural: **birim fiyat = ceil(paket / miktar)**.
 *
 * ⚠️ NEDEN `ceil`, `round` DEĞİL?
 *
 * `round` kesir 0,5'in altındayken AŞAĞI yuvarlar ve o çapada paket fiyatının
 * ALTINA düşen bir toplam üretir. Gerçek örnek:
 *
 *     32.499,90 ₺ / 100.000 = 32,4999 kr → round() = 32 kr
 *     32 kr × 100.000 = 32.000,00 ₺   →  paket fiyatının 499,90 ₺ ALTINDA
 *
 * Bu ticari olarak kabul edilemez. `ceil` ile ölçülen sonuç: 194 ölçülebilir
 * kademenin **hiçbirinde** paket fiyatının altına düşülmüyor.
 *
 * ⚠️ AMA `ceil` TEK BAŞINA YETMEZ — ÇAPADA FAZLA TAHSİLAT ÜRETİR.
 *   `ceil(174,90 ₺ / 5.000) = 4 kr` → 5.000 × 4 = 200,00 ₺ (paket 174,90 ₺).
 *   Bu yüzden gerçek paket fiyatı `packagePriceMinor` alanında ÇAPA olarak
 *   saklanır ve `calculate.ts` toplamı onunla SINIRLAR. Sonuç: çapa
 *   miktarlarında müşteri **tam olarak paket fiyatını** öder — kuruşu kuruşuna.
 *
 * Kademe sınırları: her fiyat noktası, BİR SONRAKİ noktaya kadar geçerli bir
 * bandın alt sınırı olur. Son bandın üst sınırı yoktur (null).
 */
export function derivedUnitPriceMinor([quantity, priceMinor]: PricePoint): number {
  return Math.ceil(priceMinor / quantity)
}

function bandTiers(prices: readonly PricePoint[]): TierSeed[] {
  const sorted = [...prices].sort((a, b) => a[0] - b[0])
  return sorted.map((point, i) => {
    const next = sorted[i + 1]
    return {
      mode: 'FLAT_TIER' as const,
      minQuantity: point[0],
      // Band, bir sonraki çapanın BİR ALTINDA biter. Son band sınırsızdır —
      // ama `variant.maxQuantity` üst sınırı zaten ayrıca dayatıyor.
      maxQuantity: next ? next[0] - 1 : null,
      unitPriceMinor: derivedUnitPriceMinor(point),
      /**
       * ⚠️ `FLAT_TIER`'da bu alan TUTAR OKUMAK İÇİN DEĞİL, TAVAN İÇİN.
       * `calculate.ts` toplamı "daha fazla alıp daha az ödeme" üretmeyecek
       * şekilde bu çapa fiyatıyla sınırlar. Gerçek paket fiyatı BİREBİR budur.
       */
      packagePriceMinor: point[1],
      sourcePackagePriceMinor: point[1],
    }
  })
}

/**
 * ⭐ TÜREV FİYAT — TAM SAYI KURUŞ ARİTMETİĞİ
 *
 * Facebook/TikTok fiyatları Instagram fiyatının %125'idir; YouTube Beğeni
 * Instagram Türk Beğeni'nin %300'ü. Bu çarpım KAYAN NOKTA ile yapılmaz:
 * `4990 * 1.25` JavaScript'te 6237.499999999999 verebilir ve 62,37 ₺'ye
 * yuvarlanırdı. Bunun yerine tam sayı çarpımı + EN YAKIN KURUŞA yuvarlama:
 *
 *     4990 × 125 / 100 = 6237,5  →  6238  (62,38 ₺)
 *
 * ⚠️ Sonuç fiyatlar gerçek `PricingRule` satırı olarak DB'ye yazılır.
 * Çalışma zamanında "Instagram fiyatını oku ve çarp" YAPILMAZ: Instagram
 * fiyatı değişince diğer platformların fiyatı sessizce kaymaz.
 */
function scalePrices(prices: readonly PricePoint[], percent: number): readonly PricePoint[] {
  return prices.map(([quantity, priceMinor]) => {
    const numerator = priceMinor * percent
    // Yarıyı yukarı yuvarla: floor((2n + d) / 2d)
    const scaled = Math.floor((numerator * 2 + 100) / 200)
    return [quantity, scaled] as const
  })
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
  /** ⚠️ YALNIZCA açıkça belirtilen garanti süreleri doldurulur. Tahmin YOK. */
  refillDays?: number
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
    ...(v.refillDays != null ? { refillDays: v.refillDays } : {}),
    /**
     * ⚠️ MİNİMUM, LİSTENİN EN KÜÇÜK ÇAPASIDIR — 100 DEĞİL.
     *
     * Takipçide katalogda 500'ün altında HİÇBİR fiyat noktası yok; oraya bir
     * birim fiyat uydurmak "fiyat uydurma" olurdu. Beğeni 100'den, yorum
     * 10'dan başlıyor ve orada minimum kendiliğinden düşük. Yani slider'ın
     * alt sınırı hizmete göre GERÇEK veriden gelir, sabit yazılmaz.
     */
    minQuantity: Math.min(...quantities),
    maxQuantity: Math.max(...quantities),
    quantityStep: 1,
    /**
     * ⚠️ ARTIK KISITLAYICI DEĞİL — `presetOnly: false`.
     * Liste, slider üzerinde fiyat kırılma noktalarını işaretlemek için
     * kalıyor (UI ipucu). Müşteri 567 gibi herhangi bir miktar seçebilir.
     */
    presetQuantities: quantities,
    presetOnly: false,
    tiers: bandTiers(v.prices),
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
// YOUTUBE FİYAT LİSTELERİ  (Faz 5.1 — KDV DAHİL, kuruş)
// ---------------------------------------------------------------------------

/** 3 fiyat noktası — ⚠️ maksimum 500 abone; üstü için fiyat VERİLMEDİ. */
const YT_TURK_ABONE: readonly PricePoint[] = [
  [100, 100_000], // 1.000,00 ₺
  [250, 225_000], // 2.250,00 ₺
  [500, 400_000], // 4.000,00 ₺
]

/**
 * 7 fiyat noktası.
 * ⚠️ Hizmet üst sınırı 1.000.000 abone olarak duyurulur AMA bu miktar için
 * fiyat verilmemiştir; bu yüzden seçilebilir bir paket olarak ÜRETİLMEZ.
 */
const YT_YABANCI_ABONE: readonly PricePoint[] = [
  [1_000, 250_000], // 2.500,00 ₺
  [2_500, 575_000], // 5.750,00 ₺
  [5_000, 1_050_000], // 10.500,00 ₺
  [10_000, 2_000_000], // 20.000,00 ₺
  [25_000, 4_750_000], // 47.500,00 ₺
  [50_000, 9_000_000], // 90.000,00 ₺
  [100_000, 17_000_000], // 170.000,00 ₺
]

/** 7 fiyat noktası */
const YT_IZLENME: readonly PricePoint[] = [
  [1_000, 40_000], // 400,00 ₺
  [2_500, 90_000], // 900,00 ₺
  [5_000, 160_000], // 1.600,00 ₺
  [10_000, 275_000], // 2.750,00 ₺
  [25_000, 600_000], // 6.000,00 ₺
  [50_000, 1_100_000], // 11.000,00 ₺
  [100_000, 2_000_000], // 20.000,00 ₺
]

/**
 * 10 fiyat noktası — ⚠️ Instagram Türk Beğeni fiyatlarının TAM 3 KATI.
 * Kaynak liste `TURK_BEGENI`; çarpım tam sayı kuruş üzerinden yapılır ve
 * hiçbir noktada yuvarlama gerekmez (49,90 × 3 = 149,70).
 */
const YT_BEGENI: readonly PricePoint[] = scalePrices(TURK_BEGENI, 300)

// ---------------------------------------------------------------------------
// TÜREV KATALOG — FACEBOOK / TIKTOK  (Instagram × %125)
// ---------------------------------------------------------------------------

/** Facebook ve TikTok fiyatları Instagram karşılığının %125'idir. */
const DERIVED_PERCENT = 125

const D_YABANCI_TAKIPCI = scalePrices(YABANCI_TAKIPCI, DERIVED_PERCENT)
/* ⚠️ `D_TURK_TAKIPCI` KALDIRILDI — Facebook/TikTok'ta Türk takipçi tedarik
   edilemiyor (bkz. `derivedFollowerVariants`). Geri gelirse burada yeniden
   türetin: `scalePrices(TURK_TAKIPCI, DERIVED_PERCENT)`. */
const D_TURK_BEGENI = scalePrices(TURK_BEGENI, DERIVED_PERCENT)
const D_IZLENME = scalePrices(VIDEO_IZLENME, DERIVED_PERCENT)
const D_TURK_YORUM = scalePrices(TURK_YORUM, DERIVED_PERCENT)
const D_PAYLASIM_KAYDETME = scalePrices(PAYLASIM_KAYDETME, DERIVED_PERCENT)

/**
 * Instagram'daki takipçi/beğeni/izlenme/yorum varyantlarının başka bir
 * platformdaki karşılığı. Etiketler aynı kalır; fiyatlar türetilir.
 *
 * ⚠️ Açıklamalarda YALNIZCA bileşim bilgisi tekrarlanır ("Takipçiler Türk'tür,
 * düşüş oranı …"). Instagram metnindeki "her gün takip edilir, düşüş aynı gün
 * yüklenir" TELAFİ VAADİ buraya kopyalanmaz: bu platformlarda garanti süresi
 * verilmedi (`refillDays = null`) ve karşılığı olmayan bir söz verilemez.
 */
function derivedFollowerVariants(platformKey: string): VariantSeed[] {
  return [
    presetVariant({
      slug: 'yabanci',
      internalName: `${platformKey}-Takipci-Yabanci`,
      customerLabel: 'Yabancı Takipçi',
      description: 'Takipçiler yabancıdır, düşüş oranı %1 - %5 aralığındadır.',
      isDefault: true,
      prices: D_YABANCI_TAKIPCI,
    }),
    /**
     * ⚠️ "TÜRK TAKİPÇİ" BİLİNÇLİ OLARAK YOK.
     *
     * Bu fonksiyonun İKİ çağıranı var: Facebook ve TikTok. Bu iki platformda
     * Türk takipçi tedarik EDİLEMİYOR; satın alınabilir bir seçenek olarak
     * göstermek teslim edilemeyecek bir söz olurdu. Instagram'ın kendi
     * `turk` varyantı ayrı tanımlıdır ve DURUYOR.
     *
     * ⚠️ Bu varyantı geri eklemeden önce tedarik tarafını doğrulayın; fiyat
     * listesinin nasıl türetileceği `D_TURK_TAKIPCI` notunda yazılı.
     */
  ]
}

// ---------------------------------------------------------------------------
// KATALOG
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
          // ⚠️ AÇIKÇA BELİRTİLEN garanti süresi (Faz 5.1). Tamamlanma anında
          // Fulfillment.guaranteeDays / guaranteeEndsAt olarak snapshot'lanır.
          refillDays: 365,
          prices: YABANCI_TAKIPCI,
        }),
        presetVariant({
          slug: 'turk',
          internalName: 'IG-Takipci-Turk',
          customerLabel: 'Türk Takipçi',
          description:
            'Takipçiler Türk’tür, düşüş oranı %1 - %5 aralığındadır. Profiliniz her gün takip edilir ve herhangi bir düşüş yaşanmışsa aynı gün tekrardan yüklenir.',
          refillDays: 365,
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

  // =========================================================================
  //  YOUTUBE  (Faz 5.1)
  // =========================================================================
  youtube: [
    {
      slug: 'abone',
      name: 'Abone',
      shortDescription: 'Kanalınıza gerçek kullanıcı abonesi kazandırın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'abone',
      ...YT_CHANNEL_INPUT,
      variants: [
        presetVariant({
          slug: 'turk',
          internalName: 'YT-Abone-Turk',
          customerLabel: 'Türk Abone',
          description:
            'Günlük azar azar yavaş miktarlarda yüklenir. Maksimum 500 abone satın alabilirsiniz. Düşüş oranı %0-%10 aralığındadır.',
          isDefault: true,
          // ⚠️ Garanti süresi VERİLMEDİ → refillDays yok (tahmin edilmez).
          prices: YT_TURK_ABONE,
        }),
        presetVariant({
          slug: 'yabanci',
          internalName: 'YT-Abone-Yabanci',
          customerLabel: 'Yabancı Abone',
          description:
            'Günde 25-50 aralığında abone yüklenir. Maksimum 1 Milyon abone satın alabilirsiniz. Düşüş oranı %0-%10 aralığındadır. Günlük takip edilerek düşüşler telafi edilir.',
          prices: YT_YABANCI_ABONE,
        }),
      ],
    },
    {
      slug: 'izlenme',
      name: 'İzlenme',
      shortDescription: 'Videolarınızın izlenme sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'izlenme',
      ...YT_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'standart',
          internalName: 'YT-Izlenme',
          customerLabel: 'YouTube İzlenme',
          description:
            'Genelde düşme olmaz fakat herhangi bir düşüş olması durumunda ücretsiz telafi sağlanmaktadır.',
          isDefault: true,
          prices: YT_IZLENME,
        }),
      ],
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Videolarınıza gerçek kullanıcı beğenisi gelsin.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'beğeni',
      ...YT_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'standart',
          internalName: 'YT-Begeni',
          customerLabel: 'YouTube Beğeni',
          isDefault: true,
          prices: YT_BEGENI,
        }),
      ],
    },
  ],

  // =========================================================================
  //  FACEBOOK  (Faz 5.1 — Instagram × %125)
  //
  //  ⚠️ "Kaydetme" YOK: Facebook'ta kaydetme özel bir işlemdir, gönderide
  //     herkese açık bir sayaç YOKTUR. Ölçülemeyen bir teslimi satmak,
  //     Faz 4'ün metrik tabanlı ilerleme modeliyle de bağdaşmaz.
  //  ⚠️ "Keşfet Paketi" ve "Aylık Türk Beğeni + Yorum Paketi" Instagram'a
  //     özgüdür; kopyalanmadı.
  // =========================================================================
  facebook: [
    {
      slug: 'takipci',
      name: 'Takipçi',
      shortDescription: 'Sayfanıza gerçek kullanıcı takipçisi kazandırın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'takipçi',
      ...FB_PROFILE_INPUT,
      variants: derivedFollowerVariants('FB'),
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Gönderinize gerçek kullanıcı beğenisi gelsin.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'beğeni',
      ...FB_POST_INPUT,
      variants: [
        presetVariant({
          slug: 'turk',
          internalName: 'FB-Begeni-Turk',
          customerLabel: 'Türk Beğeni',
          description: 'Beğeniler tamamen Türk hesaplardan gelir.',
          isDefault: true,
          prices: D_TURK_BEGENI,
        }),
      ],
    },
    {
      slug: 'goruntulenme',
      name: 'Görüntülenme',
      shortDescription: 'Videolarınızın izlenme sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'izlenme',
      ...FB_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'video',
          internalName: 'FB-Izlenme-Video',
          customerLabel: 'Video İzlenme',
          isDefault: true,
          prices: D_IZLENME,
        }),
      ],
    },
    {
      slug: 'yorum',
      name: 'Yorum',
      shortDescription: 'Gönderinize Türk hesaplardan yorum gelsin.',
      targetType: 'POST',
      measurementMode: 'MANUAL_COUNT',
      unitLabel: 'yorum',
      ...FB_POST_INPUT,
      variants: [
        presetVariant({
          slug: 'turk',
          internalName: 'FB-Yorum-Turk',
          customerLabel: 'Türk Yorum',
          isDefault: true,
          prices: D_TURK_YORUM,
        }),
      ],
    },
    {
      slug: 'paylasim',
      name: 'Paylaşım',
      shortDescription: 'Gönderinizin paylaşılma sayısını artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'paylaşım',
      ...FB_POST_INPUT,
      variants: [
        presetVariant({
          slug: 'standart',
          internalName: 'FB-Paylasim',
          customerLabel: 'Paylaşım',
          isDefault: true,
          prices: D_PAYLASIM_KAYDETME,
        }),
      ],
    },
  ],

  // =========================================================================
  //  TIKTOK  (Faz 5.1 — Instagram × %125)
  //
  //  ⚠️ TikTok adapter'ı YALNIZCA PROFILE ve VIDEO hedefi destekler; içerik
  //     zaten videodur. Bu yüzden beğeni/yorum/paylaşım/kaydetme hedefi VIDEO.
  //  ⚠️ "Kaydetme" burada VAR: TikTok'ta favori sayısı videonun üstünde
  //     herkese açık görünür, yani operatör ölçebilir.
  //  ⚠️ Keşfet ve Aylık paketler kopyalanmadı (Instagram'a özgü).
  // =========================================================================
  tiktok: [
    {
      slug: 'takipci',
      name: 'Takipçi',
      shortDescription: 'Profilinize gerçek kullanıcı takipçisi kazandırın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'takipçi',
      ...TT_PROFILE_INPUT,
      variants: derivedFollowerVariants('TT'),
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Videolarınıza Türk hesaplardan beğeni gelsin.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'beğeni',
      ...TT_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'turk',
          internalName: 'TT-Begeni-Turk',
          customerLabel: 'Türk Beğeni',
          description: 'Beğeniler tamamen Türk hesaplardan gelir.',
          isDefault: true,
          prices: D_TURK_BEGENI,
        }),
      ],
    },
    {
      slug: 'goruntulenme',
      name: 'Görüntülenme',
      shortDescription: 'Videolarınızın izlenme sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'izlenme',
      ...TT_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'video',
          internalName: 'TT-Izlenme-Video',
          customerLabel: 'Video İzlenme',
          isDefault: true,
          prices: D_IZLENME,
        }),
      ],
    },
    {
      slug: 'yorum',
      name: 'Yorum',
      shortDescription: 'Videolarınıza Türk hesaplardan yorum gelsin.',
      targetType: 'VIDEO',
      measurementMode: 'MANUAL_COUNT',
      unitLabel: 'yorum',
      ...TT_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'turk',
          internalName: 'TT-Yorum-Turk',
          customerLabel: 'Türk Yorum',
          isDefault: true,
          prices: D_TURK_YORUM,
        }),
      ],
    },
    {
      slug: 'kaydetme',
      name: 'Kaydetme',
      shortDescription: 'Videonuzun favorilere eklenme sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'kaydetme',
      ...TT_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'standart',
          internalName: 'TT-Kaydetme',
          customerLabel: 'Kaydetme',
          isDefault: true,
          prices: D_PAYLASIM_KAYDETME,
        }),
      ],
    },
    {
      slug: 'paylasim',
      name: 'Paylaşım',
      shortDescription: 'Videonuzun paylaşılma sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'paylaşım',
      ...TT_VIDEO_INPUT,
      variants: [
        presetVariant({
          slug: 'standart',
          internalName: 'TT-Paylasim',
          customerLabel: 'Paylaşım',
          isDefault: true,
          prices: D_PAYLASIM_KAYDETME,
        }),
      ],
    },
  ],
}

/**
 * Fiyat noktası sayıları — testler ve seed özeti bu tablodan doğrulanır.
 * Buradaki hiçbir sayı elle değiştirilmemeli; katalog değişirse testler
 * kırılmalıdır.
 */
export const EXPECTED_PRICE_POINTS = {
  // --- Instagram (Faz 5) — 63 ---
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
  // --- YouTube (Faz 5.1) — 27 ---
  'youtube/abone/turk': 3,
  'youtube/abone/yabanci': 7,
  'youtube/izlenme/standart': 7,
  'youtube/begeni/standart': 10,
  // --- Facebook (Faz 5.1, Instagram × %125) — 43 ---
  // ⚠️ 'facebook/takipci/turk' KALDIRILDI (tedarik yok) — platform toplamı 51 → 43.
  'facebook/takipci/yabanci': 10,
  'facebook/begeni/turk': 10,
  'facebook/goruntulenme/video': 9,
  'facebook/yorum/turk': 7,
  'facebook/paylasim/standart': 7,
  // --- TikTok (Faz 5.1, Instagram × %125) — 50 ---
  // ⚠️ 'tiktok/takipci/turk' KALDIRILDI (tedarik yok) — platform toplamı 58 → 50.
  'tiktok/takipci/yabanci': 10,
  'tiktok/begeni/turk': 10,
  'tiktok/goruntulenme/video': 9,
  'tiktok/yorum/turk': 7,
  'tiktok/kaydetme/standart': 7,
  'tiktok/paylasim/standart': 7,
} as const

/** Platform bazında toplam fiyat noktası. */
export const PRICE_POINTS_BY_PLATFORM = {
  instagram: 63,
  youtube: 27,
  facebook: 43,
  tiktok: 50,
} as const

export const TOTAL_PRICE_POINTS = 183
