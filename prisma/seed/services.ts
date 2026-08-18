/**
 * HİZMET + VARYANT TOHUM VERİSİ
 *
 * Sistem "takipçi satın alma" mantığına SABİTLENMEMİŞTİR. Her platformun
 * hizmetleri burada tanımlanır ve admin panelden serbestçe eklenip
 * düzenlenebilir. Frontend bu satırlardaki `inputLabel/Placeholder/Help/Example`
 * alanlarını render eder — yeni hizmet eklemek FRONTEND DEĞİŞİKLİĞİ GEREKTİRMEZ.
 *
 * `measurementMode`:
 *   METRIC       → sayılabilir (takipçi, beğeni, görüntülenme, abone)
 *   MANUAL_COUNT → sayılamaz (yorum, profil tanıtımı) — operatör adet girer
 *
 * FİYATLAR KDV DAHİL, KURUŞ cinsindendir.
 */

export type TargetTypeSeed = 'PROFILE' | 'POST' | 'VIDEO' | 'CHANNEL' | 'GROUP'
export type MeasurementModeSeed = 'METRIC' | 'MANUAL_COUNT'

export interface TierSeed {
  minQuantity: number
  maxQuantity: number | null
  /** KDV DAHİL birim fiyat, kuruş */
  unitPriceMinor: number
  setupFeeMinor?: number
}

export interface VariantSeed {
  slug: string
  internalName: string
  customerLabel: string
  tagline?: string
  badge?: string
  isDefault?: boolean
  minQuantity: number
  maxQuantity: number
  quantityStep: number
  presetQuantities: number[]
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
// Yeniden kullanılabilir girdi tanımları
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
  inputHelpText: 'Tarayıcıdaki tam adresi yapıştırın.',
  inputExample: 'instagram.com/p/CxYzAbCdEfG/',
} as const

// ---------------------------------------------------------------------------
// Varyant fabrikaları — kademeler kolay okunsun diye ayrıldı
// ---------------------------------------------------------------------------

function standardVariant(tiers: TierSeed[], o: Partial<VariantSeed> = {}): VariantSeed {
  return {
    slug: 'standart',
    internalName: 'Standart-Havuz-A',
    customerLabel: 'Standart',
    tagline: '0-6 saat içinde başlar',
    isDefault: true,
    minQuantity: 100,
    maxQuantity: 100_000,
    quantityStep: 10,
    presetQuantities: [100, 500, 1000, 5000],
    estimatedStartMinutes: 360,
    estimatedCompleteMinutes: 2880,
    tiers,
    ...o,
  }
}

function premiumVariant(tiers: TierSeed[], o: Partial<VariantSeed> = {}): VariantSeed {
  return {
    slug: 'premium',
    internalName: 'Premium-TR-Havuz-v2',
    customerLabel: 'Premium',
    tagline: '0-1 saat içinde başlar, telafi garantili',
    badge: 'EN ÇOK TERCİH EDİLEN',
    isDefault: false,
    minQuantity: 100,
    maxQuantity: 50_000,
    quantityStep: 10,
    presetQuantities: [100, 500, 1000, 5000],
    estimatedStartMinutes: 60,
    estimatedCompleteMinutes: 1440,
    refillDays: 30,
    tiers,
    ...o,
  }
}

// ---------------------------------------------------------------------------
// KATALOG
// ---------------------------------------------------------------------------

export const SERVICES: Record<string, ServiceSeed[]> = {
  instagram: [
    {
      slug: 'takipci',
      name: 'Takipçi',
      shortDescription: 'Profilinizi gerçek kullanıcılara tanıtarak takipçi kazanın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      ...IG_PROFILE_INPUT,
      variants: [
        standardVariant([
          { minQuantity: 100, maxQuantity: 499, unitPriceMinor: 45 },
          { minQuantity: 500, maxQuantity: 999, unitPriceMinor: 38 },
          { minQuantity: 1000, maxQuantity: 4999, unitPriceMinor: 30 },
          { minQuantity: 5000, maxQuantity: null, unitPriceMinor: 24 },
        ]),
        premiumVariant([
          { minQuantity: 100, maxQuantity: 499, unitPriceMinor: 62 },
          { minQuantity: 500, maxQuantity: 999, unitPriceMinor: 54 },
          { minQuantity: 1000, maxQuantity: 4999, unitPriceMinor: 44 },
          { minQuantity: 5000, maxQuantity: null, unitPriceMinor: 36 },
        ]),
      ],
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Gönderinizin etkileşimini gerçek kullanıcılarla artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      ...IG_POST_INPUT,
      variants: [
        standardVariant(
          [
            { minQuantity: 50, maxQuantity: 499, unitPriceMinor: 22 },
            { minQuantity: 500, maxQuantity: 4999, unitPriceMinor: 17 },
            { minQuantity: 5000, maxQuantity: null, unitPriceMinor: 13 },
          ],
          { minQuantity: 50, quantityStep: 10, presetQuantities: [50, 250, 1000, 5000] },
        ),
      ],
    },
    {
      slug: 'goruntulenme',
      name: 'Görüntülenme',
      shortDescription: 'Reel ve video gönderilerinizin izlenme sayısını artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      ...IG_POST_INPUT,
      variants: [
        standardVariant(
          [
            { minQuantity: 500, maxQuantity: 9999, unitPriceMinor: 4 },
            { minQuantity: 10_000, maxQuantity: 99_999, unitPriceMinor: 3 },
            { minQuantity: 100_000, maxQuantity: null, unitPriceMinor: 2 },
          ],
          {
            minQuantity: 500,
            maxQuantity: 1_000_000,
            quantityStep: 100,
            presetQuantities: [1000, 10_000, 50_000, 100_000],
          },
        ),
      ],
    },
    {
      slug: 'yorum',
      name: 'Yorum',
      shortDescription: 'Gönderinize gerçek kullanıcılardan Türkçe yorum kazandırın.',
      targetType: 'POST',
      // Yorum sayısı güvenilir ölçülemez → operatör teslim adedini elle girer
      measurementMode: 'MANUAL_COUNT',
      unitLabel: 'yorum',
      ...IG_POST_INPUT,
      variants: [
        standardVariant(
          [
            { minQuantity: 5, maxQuantity: 49, unitPriceMinor: 480 },
            { minQuantity: 50, maxQuantity: null, unitPriceMinor: 390 },
          ],
          {
            slug: 'turkce',
            internalName: 'Yorum-TR-Manuel',
            customerLabel: 'Türkçe yorum',
            tagline: 'Gerçek kullanıcılar tarafından yazılır',
            minQuantity: 5,
            maxQuantity: 500,
            quantityStep: 5,
            presetQuantities: [5, 25, 50, 100],
            estimatedStartMinutes: 720,
            estimatedCompleteMinutes: 4320,
          },
        ),
      ],
    },
    {
      slug: 'profil-tanitimi',
      name: 'Profil Tanıtımı',
      shortDescription: 'Hedef kitlenize yönelik manuel profil tanıtım çalışması.',
      targetType: 'PROFILE',
      measurementMode: 'MANUAL_COUNT',
      // Paket başına 1 haftalık çalışma → miktar birimi "hafta"
      unitLabel: 'hafta',
      ...IG_PROFILE_INPUT,
      variants: [
        standardVariant(
          [
            { minQuantity: 1, maxQuantity: 4, unitPriceMinor: 29_900, setupFeeMinor: 0 },
            { minQuantity: 5, maxQuantity: null, unitPriceMinor: 24_900 },
          ],
          {
            slug: 'haftalik',
            internalName: 'Profil-Tanitim-Haftalik',
            customerLabel: 'Haftalık tanıtım',
            tagline: 'Her paket 1 haftalık manuel tanıtım çalışmasıdır',
            minQuantity: 1,
            maxQuantity: 52,
            quantityStep: 1,
            presetQuantities: [1, 2, 4, 8],
            estimatedStartMinutes: 1440,
            estimatedCompleteMinutes: 10_080,
          },
        ),
      ],
    },
  ],

  tiktok: [
    {
      slug: 'takipci',
      name: 'Takipçi',
      shortDescription: 'TikTok profilinizi gerçek kullanıcılara tanıtın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'TikTok kullanıcı adınız',
      inputPlaceholder: '@medya333 veya profil bağlantısı',
      inputHelpText: 'Hesabınızın herkese açık olması gerekir.',
      inputExample: 'tiktok.com/@medya333',
      variants: [
        standardVariant([
          { minQuantity: 100, maxQuantity: 999, unitPriceMinor: 40 },
          { minQuantity: 1000, maxQuantity: 9999, unitPriceMinor: 32 },
          { minQuantity: 10_000, maxQuantity: null, unitPriceMinor: 26 },
        ]),
      ],
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Videolarınızın beğeni sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Video bağlantısı',
      inputPlaceholder: 'tiktok.com/@kullanici/video/...',
      inputHelpText: 'Videonun herkese açık olması gerekir.',
      inputExample: 'tiktok.com/@medya333/video/7301234567890123456',
      variants: [
        standardVariant(
          [
            { minQuantity: 50, maxQuantity: 999, unitPriceMinor: 18 },
            { minQuantity: 1000, maxQuantity: null, unitPriceMinor: 13 },
          ],
          { minQuantity: 50, quantityStep: 10, presetQuantities: [50, 250, 1000, 5000] },
        ),
      ],
    },
    {
      slug: 'goruntulenme',
      name: 'Görüntülenme',
      shortDescription: 'Videolarınızın izlenme sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Video bağlantısı',
      inputPlaceholder: 'tiktok.com/@kullanici/video/...',
      inputHelpText: 'Videonun herkese açık olması gerekir.',
      inputExample: 'tiktok.com/@medya333/video/7301234567890123456',
      variants: [
        standardVariant(
          [
            { minQuantity: 1000, maxQuantity: 49_999, unitPriceMinor: 3 },
            { minQuantity: 50_000, maxQuantity: null, unitPriceMinor: 2 },
          ],
          {
            minQuantity: 1000,
            maxQuantity: 5_000_000,
            quantityStep: 500,
            presetQuantities: [1000, 10_000, 100_000, 500_000],
          },
        ),
      ],
    },
  ],

  youtube: [
    {
      slug: 'abone',
      name: 'Abone',
      shortDescription: 'Kanalınızı gerçek izleyicilere tanıtarak abone kazanın.',
      targetType: 'CHANNEL',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Kanal bağlantısı veya @handle',
      inputPlaceholder: '@medya333 veya youtube.com/@medya333',
      inputHelpText: 'Kanalınızın herkese açık olması gerekir.',
      inputExample: 'youtube.com/@medya333',
      variants: [
        standardVariant(
          [
            { minQuantity: 50, maxQuantity: 499, unitPriceMinor: 220 },
            { minQuantity: 500, maxQuantity: 4999, unitPriceMinor: 180 },
            { minQuantity: 5000, maxQuantity: null, unitPriceMinor: 150 },
          ],
          { minQuantity: 50, quantityStep: 10, presetQuantities: [50, 250, 1000, 5000] },
        ),
      ],
    },
    {
      slug: 'goruntulenme',
      name: 'Görüntülenme',
      shortDescription: 'Videolarınızın izlenme sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Video bağlantısı',
      inputPlaceholder: 'youtube.com/watch?v=... veya youtu.be/...',
      inputHelpText: 'Video herkese açık veya liste dışı olabilir.',
      inputExample: 'youtube.com/watch?v=dQw4w9WgXcQ',
      variants: [
        standardVariant(
          [
            { minQuantity: 1000, maxQuantity: 24_999, unitPriceMinor: 9 },
            { minQuantity: 25_000, maxQuantity: null, unitPriceMinor: 7 },
          ],
          {
            minQuantity: 1000,
            maxQuantity: 1_000_000,
            quantityStep: 500,
            presetQuantities: [1000, 5000, 25_000, 100_000],
          },
        ),
      ],
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Videolarınızın beğeni sayısını artırın.',
      targetType: 'VIDEO',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Video bağlantısı',
      inputPlaceholder: 'youtube.com/watch?v=...',
      inputHelpText: 'Videonun beğenilere açık olması gerekir.',
      inputExample: 'youtube.com/watch?v=dQw4w9WgXcQ',
      variants: [
        standardVariant(
          [
            { minQuantity: 50, maxQuantity: 999, unitPriceMinor: 32 },
            { minQuantity: 1000, maxQuantity: null, unitPriceMinor: 25 },
          ],
          { minQuantity: 50, quantityStep: 10, presetQuantities: [50, 250, 1000, 5000] },
        ),
      ],
    },
  ],

  x: [
    {
      slug: 'takipci',
      name: 'Takipçi',
      shortDescription: 'X hesabınızı gerçek kullanıcılara tanıtın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'X kullanıcı adınız',
      inputPlaceholder: '@medya333 veya x.com/medya333',
      inputHelpText: 'Hesabınızın herkese açık olması gerekir.',
      inputExample: 'x.com/medya333',
      variants: [
        standardVariant([
          { minQuantity: 100, maxQuantity: 999, unitPriceMinor: 58 },
          { minQuantity: 1000, maxQuantity: null, unitPriceMinor: 46 },
        ]),
      ],
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Gönderilerinizin etkileşimini artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Gönderi bağlantısı',
      inputPlaceholder: 'x.com/kullanici/status/...',
      inputHelpText: 'Gönderinin herkese açık olması gerekir.',
      inputExample: 'x.com/medya333/status/1730000000000000000',
      variants: [
        standardVariant(
          [
            { minQuantity: 50, maxQuantity: 999, unitPriceMinor: 26 },
            { minQuantity: 1000, maxQuantity: null, unitPriceMinor: 20 },
          ],
          { minQuantity: 50, quantityStep: 10, presetQuantities: [50, 250, 1000, 5000] },
        ),
      ],
    },
  ],

  facebook: [
    {
      slug: 'takipci',
      name: 'Takipçi',
      shortDescription: 'Facebook sayfanızın takipçi sayısını artırın.',
      targetType: 'PROFILE',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Sayfa bağlantısı',
      inputPlaceholder: 'facebook.com/sayfaadi',
      inputHelpText: 'Sayfanın herkese açık olması gerekir.',
      inputExample: 'facebook.com/medya333',
      variants: [
        standardVariant([
          { minQuantity: 100, maxQuantity: 999, unitPriceMinor: 48 },
          { minQuantity: 1000, maxQuantity: null, unitPriceMinor: 38 },
        ]),
      ],
    },
    {
      slug: 'begeni',
      name: 'Beğeni',
      shortDescription: 'Gönderilerinizin beğeni sayısını artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Gönderi bağlantısı',
      inputPlaceholder: 'facebook.com/sayfaadi/posts/...',
      inputHelpText: 'Gönderinin herkese açık olması gerekir.',
      inputExample: 'facebook.com/medya333/posts/123456789',
      variants: [
        standardVariant(
          [
            { minQuantity: 50, maxQuantity: 999, unitPriceMinor: 24 },
            { minQuantity: 1000, maxQuantity: null, unitPriceMinor: 19 },
          ],
          { minQuantity: 50, quantityStep: 10, presetQuantities: [50, 250, 1000, 5000] },
        ),
      ],
    },
  ],

  telegram: [
    {
      slug: 'uye',
      name: 'Kanal Üyesi',
      shortDescription: 'Telegram kanalınıza gerçek kullanıcı katılımı sağlayın.',
      targetType: 'CHANNEL',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Kanal bağlantısı',
      inputPlaceholder: 't.me/kanaladi',
      inputHelpText: 'Kanalın herkese açık olması gerekir.',
      inputExample: 't.me/medya333',
      variants: [
        standardVariant([
          { minQuantity: 100, maxQuantity: 999, unitPriceMinor: 52 },
          { minQuantity: 1000, maxQuantity: null, unitPriceMinor: 41 },
        ]),
      ],
    },
    {
      slug: 'goruntulenme',
      name: 'Gönderi Görüntülenme',
      shortDescription: 'Kanal gönderilerinizin görüntülenme sayısını artırın.',
      targetType: 'POST',
      measurementMode: 'METRIC',
      unitLabel: 'adet',
      inputLabel: 'Gönderi bağlantısı',
      inputPlaceholder: 't.me/kanaladi/145',
      inputHelpText: 'Gönderinin herkese açık olması gerekir.',
      inputExample: 't.me/medya333/145',
      variants: [
        standardVariant(
          [
            { minQuantity: 500, maxQuantity: 9999, unitPriceMinor: 5 },
            { minQuantity: 10_000, maxQuantity: null, unitPriceMinor: 3 },
          ],
          {
            minQuantity: 500,
            maxQuantity: 500_000,
            quantityStep: 100,
            presetQuantities: [500, 2500, 10_000, 50_000],
          },
        ),
      ],
    },
  ],
}
