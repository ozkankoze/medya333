import { z } from 'zod'
import { TARGET_TYPE } from '@/lib/enums'

/**
 * PAYLAŞILAN ZOD ŞEMALARI
 *
 * Hem istemci formu hem sunucu route'u AYNI şemayı kullanır — istemci
 * doğrulaması UX içindir, sunucu doğrulaması güvenlik içindir; ikisi asla
 * ayrışamaz çünkü tek tanım vardır.
 */

export const cuidSchema = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i, 'Geçersiz kimlik')

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Geçerli bir e-posta adresi girin.')
  .max(254)

export const passwordSchema = z
  .string()
  .min(10, 'Şifre en az 10 karakter olmalıdır.')
  .max(200, 'Şifre çok uzun.')

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+90|0)?5\d{9}$/, 'Geçerli bir cep telefonu girin.')
  .optional()

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, 'Kupon kodu geçersiz karakter içeriyor.')

export const quantitySchema = z.coerce
  .number()
  .int('Miktar tam sayı olmalıdır.')
  .positive('Miktar sıfırdan büyük olmalıdır.')
  .max(10_000_000)

export const targetInputSchema = z
  .string()
  .trim()
  .min(1, 'Lütfen bir hedef girin.')
  .max(512, 'Girdi çok uzun.')

// ---------------------------------------------------------------------------
// API girdi şemaları
// ---------------------------------------------------------------------------

export const pricingQuoteSchema = z.object({
  serviceVariantId: cuidSchema,
  quantity: quantitySchema,
  couponCode: couponCodeSchema.optional().nullable(),
})
export type PricingQuoteInput = z.infer<typeof pricingQuoteSchema>

export const targetResolveSchema = z.object({
  platformSlug: z.string().trim().min(1).max(64),
  serviceId: cuidSchema,
  input: targetInputSchema,
})
export type TargetResolveInput = z.infer<typeof targetResolveSchema>

export const couponValidateSchema = z.object({
  code: couponCodeSchema,
  serviceVariantId: cuidSchema,
  quantity: quantitySchema,
})

const nameSchema = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter olmalıdır.')
  .max(60)
  .regex(/^[\p{L}\p{M}'\- .]+$/u, 'Yalnızca harf, boşluk, tire ve kesme işareti kullanılabilir.')

/**
 * SİPARİŞ OLUŞTURMA GİRDİSİ
 *
 * ⚠️ FİYAT ALANLARI BİLEREK YOK: `unitPrice`, `subtotal`, `tax`, `total`
 * kabul EDİLMEZ. Şema `.strict()` olmadığı için fazladan alanlar sessizce
 * atılır ve hiçbir şekilde fiyat hesabına giremez.
 * `clientTotalMinor` yalnızca KARŞILAŞTIRMA içindir (PriceChangedError).
 */
export const createOrderSchema = z.object({
  serviceVariantId: cuidSchema,
  quantity: quantitySchema,
  targetId: cuidSchema,
  /** UNVERIFIED hedeflerde zorunlu — kullanıcı "Bu hedef doğru" onayı verdi mi */
  targetConfirmed: z.boolean().default(false),
  couponCode: couponCodeSchema.optional().nullable(),

  // --- Müşteri bilgileri ---
  customerFirstName: nameSchema,
  customerLastName: nameSchema,
  /** Misafir siparişinde zorunlu; oturum açıksa oturum e-postası kullanılır */
  guestEmail: emailSchema.optional(),
  guestPhone: phoneSchema,
  customerNote: z.string().trim().max(1000).optional(),

  /** Sadece KARŞILAŞTIRMA için — sipariş bu değerle YAZILMAZ */
  clientTotalMinor: z.number().int().nonnegative().optional(),

  // --- Sözleşme onayları: üçü de ZORUNLU ---
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Hizmet / Satış Sözleşmesi\'ni onaylamanız gerekir.' }),
  }),
  acceptedRefund: z.literal(true, {
    errorMap: () => ({ message: 'İptal ve iade koşullarını onaylamanız gerekir.' }),
  }),
  acceptedPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'KVKK / Gizlilik metnini onaylamanız gerekir.' }),
  }),
})
export type CreateOrderInput = z.infer<typeof createOrderSchema>

/** Misafir sipariş sorgusu: sipariş no + e-posta İKİSİ BİRDEN gerekir. */
export const orderLookupSchema = z.object({
  orderNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^M333-[0-9A-HJKMNP-TV-Z]{8}$/, 'Sipariş numarası geçersiz.'),
  email: emailSchema,
})

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(2).max(120).optional(),
  acceptedTerms: z.literal(true),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
})

// ---------------------------------------------------------------------------
// Admin şemaları
// ---------------------------------------------------------------------------

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Slug yalnızca küçük harf, rakam ve tire içerebilir.')

export const adminPlatformSchema = z.object({
  name: z.string().trim().min(2).max(64),
  slug: slugSchema,
  adapterKey: z.string().trim().min(2).max(64).default('generic'),
  iconSlug: z.string().trim().max(64).optional().nullable(),
  iconUrl: z.string().url().max(512).optional().nullable(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB biçiminde olmalıdır.')
    .optional()
    .nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
})

export const adminServiceSchema = z.object({
  platformId: cuidSchema,
  name: z.string().trim().min(2).max(64),
  slug: slugSchema,
  shortDescription: z.string().trim().max(200).optional().nullable(),
  targetType: z.enum(TARGET_TYPE),
  measurementMode: z.enum(['METRIC', 'MANUAL_COUNT']).default('METRIC'),
  /** Gösterim birimi — serbest metin; admin "paket", "hafta" vb. girebilir */
  unitLabel: z.string().trim().min(1).max(24).default('adet'),
  inputLabel: z.string().trim().min(2).max(120),
  inputPlaceholder: z.string().trim().min(2).max(160),
  inputHelpText: z.string().trim().max(300).optional().nullable(),
  inputExample: z.string().trim().min(2).max(200),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
})

/**
 * Varyantın ham alanları. `.refine()` zinciri PATCH'te `.partial()` ile
 * kullanılabilsin diye AYRI tutulur (ZodEffects üzerinde `.partial()` yoktur).
 * Kısmi güncellemede düşen çapraz kurallar servis katmanında tekrar uygulanır.
 */
export const adminVariantBaseSchema = z
  .object({
    serviceId: cuidSchema,
    slug: slugSchema,
    internalName: z.string().trim().min(2).max(120),
    customerLabel: z.string().trim().min(1).max(48),
    tagline: z.string().trim().max(120).optional().nullable(),
    description: z.string().trim().max(600).optional().nullable(),
    badge: z.string().trim().max(32).optional().nullable(),
    isDefault: z.boolean().default(false),
    isVisible: z.boolean().default(true),
    /** Sabit paketin içerik maddeleri — müşteriye gösterilir */
    packageItems: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    minQuantity: z.number().int().positive(),
    maxQuantity: z.number().int().positive(),
    quantityStep: z.number().int().positive().default(1),
    presetQuantities: z.array(z.number().int().positive()).max(32).default([]),
    /** true ⇒ SADECE presetQuantities seçilebilir (slider kapalı) */
    presetOnly: z.boolean().default(false),
    estimatedStartMinutes: z.number().int().min(0).optional().nullable(),
    estimatedCompleteMinutes: z.number().int().min(0).optional().nullable(),
    refillDays: z.number().int().min(0).max(365).optional().nullable(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })

export const adminVariantSchema = adminVariantBaseSchema
  .refine((v) => v.maxQuantity >= v.minQuantity, {
    message: 'Maksimum miktar minimumdan küçük olamaz.',
    path: ['maxQuantity'],
  })
  .refine((v) => !v.presetOnly || v.presetQuantities.length > 0, {
    message: 'Yalnızca hazır miktar seçilebilen varyantta en az bir hazır miktar tanımlanmalıdır.',
    path: ['presetQuantities'],
  })

export const adminVariantPatchSchema = adminVariantBaseSchema.partial()

export const adminPricingRuleBaseSchema = z
  .object({
    serviceVariantId: cuidSchema,
    mode: z.enum(['FLAT_TIER', 'GRADUATED', 'PACKAGE']).default('FLAT_TIER'),
    minQuantity: z.number().int().positive(),
    maxQuantity: z.number().int().positive().optional().nullable(),
    /**
     * KDV DAHİL birim fiyat, kuruş. FLAT_TIER/GRADUATED'de sıfır/negatif
     * reddedilir (parmak hatası). PACKAGE modunda kullanılmaz → 0 kabul edilir.
     */
    unitPriceMinor: z.number().int().min(0),
    /** ⚠️ SADECE PACKAGE — KDV DAHİL sabit toplam, kuruş. */
    packagePriceMinor: z.number().int().positive().optional().nullable(),
    setupFeeMinor: z.number().int().min(0).default(0),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional().nullable(),
    priority: z.number().int().min(0).max(1000).default(0),
    isActive: z.boolean().default(true),
  })

export const adminPricingRuleSchema = adminPricingRuleBaseSchema
  .refine((v) => v.maxQuantity == null || v.maxQuantity >= v.minQuantity, {
    message: 'Üst sınır alt sınırdan küçük olamaz.',
    path: ['maxQuantity'],
  })
  .refine((v) => v.mode !== 'PACKAGE' || (v.packagePriceMinor ?? 0) > 0, {
    message: 'Sabit paket fiyatı sıfırdan büyük olmalıdır.',
    path: ['packagePriceMinor'],
  })
  .refine((v) => v.mode === 'PACKAGE' || v.unitPriceMinor > 0, {
    message: 'Birim fiyat sıfırdan büyük olmalıdır.',
    path: ['unitPriceMinor'],
  })
  .refine((v) => v.mode !== 'PACKAGE' || v.maxQuantity === v.minQuantity, {
    // Sabit paket TEK miktara kilitlidir: 500 için tanımlı fiyat 501'i kapsayamaz.
    message: 'Sabit paket kademesinde alt ve üst sınır aynı miktar olmalıdır.',
    path: ['maxQuantity'],
  })

export const adminPricingRulePatchSchema = adminPricingRuleBaseSchema.partial()

export const adminOrderStatusSchema = z.object({
  status: z.enum([
    'DRAFT',
    'PENDING_PAYMENT',
    'PAID',
    'PROCESSING',
    'STARTED',
    'IN_PROGRESS',
    'PARTIAL',
    'COMPLETED',
    'CANCELLED',
    'REFUNDED',
    'FAILED',
  ]),
  reason: z.string().trim().max(500).optional(),
})

export const adminProgressSchema = z
  .object({
    /** METRIC modunda: hedefin şu anki değeri */
    currentCount: z.number().int().min(0).optional(),
    /** MANUAL_COUNT modunda: doğrudan teslim edilen adet */
    deliveredQuantity: z.number().int().min(0).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.currentCount != null || v.deliveredQuantity != null, {
    message: 'Mevcut değer veya teslim adedi girilmelidir.',
  })
