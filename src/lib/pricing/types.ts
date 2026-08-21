import type { DiscountType, PricingMode } from '@/lib/enums'

/**
 * Bir fiyat kademesi. `unitPriceMinor` KDV DAHİL brüt birim fiyattır.
 *
 * `mode === 'PACKAGE'` ise `unitPriceMinor` ANLAMSIZDIR (0) ve tutar
 * `packagePriceMinor` alanından OLDUĞU GİBİ okunur. Gerçek satış fiyatları
 * (500 takipçi = 324,90 ₺) birim fiyata bölünebilir değildir:
 * 32490 / 500 = 64,98 kuruş. Bölüp çarpmak kuruş kaybı demektir.
 */
export interface PricingTier {
  id: string
  mode: PricingMode
  minQuantity: number
  /** null = sınırsız */
  maxQuantity: number | null
  unitPriceMinor: number
  /** SADECE `mode === 'PACKAGE'` — KDV DAHİL sabit toplam, kuruş */
  packagePriceMinor?: number | null
  setupFeeMinor: number
  priority: number
}

export interface QuantityConstraints {
  minQuantity: number
  maxQuantity: number
  quantityStep: number
  /** Hazır miktar seçenekleri. `presetOnly` ile birlikte KISITLAYICIDIR. */
  presetQuantities?: readonly number[]
  /** true ⇒ yalnızca `presetQuantities` içindeki miktarlar kabul edilir. */
  presetOnly?: boolean
}

export interface DiscountSpec {
  id?: string
  code?: string
  type: DiscountType
  /** PERCENTAGE → basis point (%10 = 1000) · FIXED_AMOUNT → kuruş */
  value: number
  maxDiscountMinor?: number | null
  minOrderMinor?: number | null
}

export interface CalculatePriceInput {
  quantity: number
  /** Aktif + tarih aralığındaki kademeler. Filtreleme çağıran tarafın işi. */
  tiers: PricingTier[]
  constraints: QuantityConstraints
  /** KDV oranı, basis point. %20 → 2000 */
  taxRateBp: number
  campaign?: DiscountSpec | null
  /** Sadece SUNUCU doldurur — kupon kuralları gizli veridir. */
  coupon?: DiscountSpec | null
  /** Kampanya ve kupon üst üste binebilir mi? */
  allowStacking?: boolean
  currency?: string
}

export interface BreakdownLine {
  key: string
  label: string
  amountMinor: number
  /** Bilgi amaçlı satır mı (toplama dahil değil)? */
  informational?: boolean
}

export interface NextTierHint {
  minQuantity: number
  unitPriceMinor: number
  /** Bir sonraki kademeye çıkılırsa birim fiyattaki düşüş (kuruş) */
  unitSavingMinor: number
  /** O miktardaki toplam tutar — "500 alsan 285 ₺" demek için */
  totalAtNextTierMinor: number
}

/**
 * KDV DAHİL fiyat kırılımı.
 *
 *   listSubtotalMinor  = unitPrice * quantity + setupFee   (KDV dahil, indirim öncesi)
 *   discountMinor      = kampanya + kupon                   (KDV dahil)
 *   totalMinor         = listSubtotal - discount            (ÖDENEN, KDV dahil)
 *   taxAmountMinor     = totalMinor içinden ayrıştırılan KDV
 *   subtotalMinor      = totalMinor - taxAmountMinor        (net matrah)
 */
export interface PriceBreakdown {
  currency: string
  quantity: number

  /** Uygulanan fiyat modeli — `PACKAGE` ise birim fiyat gösterilmez. */
  pricingMode: PricingMode
  /** SADECE `PACKAGE` — uygulanan sabit paket fiyatı (KDV dahil, kuruş) */
  packagePriceMinor: number | null

  tierId: string
  tierMinQuantity: number
  tierMaxQuantity: number | null
  unitPriceMinor: number
  /**
   * Gerçekte ödenen birim fiyat (kuruş, KESİRLİ olabilir).
   *
   * ⚠️ MÜŞTERİYE GÖSTERİLECEK OLAN BUDUR. Çapa tavanı devreye girdiğinde
   *    kademenin ilan ettiği `unitPriceMinor`'dan küçüktür; kademe fiyatını
   *    göstermek "birim × miktar ≠ toplam" gibi tutarsız bir kart üretirdi.
   */
  effectiveUnitPriceMinor: number
  /**
   * Tavanı sağlayan çapa miktarı. `null` = tavan uygulanmadı ya da müşteri
   * zaten tam çapadadır. Dolu ise UI "X adede kadar aynı fiyat" diyebilir.
   */
  anchorQuantity: number | null

  listSubtotalMinor: number
  setupFeeMinor: number
  campaignDiscountMinor: number
  couponDiscountMinor: number
  discountMinor: number
  totalMinor: number

  taxRateBp: number
  taxAmountMinor: number
  subtotalMinor: number

  nextTier: NextTierHint | null
  lines: BreakdownLine[]
}

export type PricingErrorCode =
  | 'BELOW_MINIMUM'
  | 'ABOVE_MAXIMUM'
  | 'INVALID_STEP'
  | 'NO_PRICING_RULE'
  | 'INVALID_QUANTITY'
  | 'INVALID_TAX_RATE'
  /** Hazır miktar listesi dışında bir miktar seçildi (7.342 gibi) */
  | 'QUANTITY_NOT_ALLOWED'
  /** `mode = PACKAGE` ama `packagePriceMinor` yok/geçersiz — veri hatası */
  | 'INVALID_PACKAGE_PRICE'

export class PricingError extends Error {
  readonly code: PricingErrorCode
  readonly details: Record<string, unknown>

  constructor(code: PricingErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'PricingError'
    this.code = code
    this.details = details
  }
}
