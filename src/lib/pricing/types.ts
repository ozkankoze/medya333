import type { DiscountType, PricingMode } from '@/lib/enums'

/** Bir fiyat kademesi. `unitPriceMinor` KDV DAHİL brüt birim fiyattır. */
export interface PricingTier {
  id: string
  mode: PricingMode
  minQuantity: number
  /** null = sınırsız */
  maxQuantity: number | null
  unitPriceMinor: number
  setupFeeMinor: number
  priority: number
}

export interface QuantityConstraints {
  minQuantity: number
  maxQuantity: number
  quantityStep: number
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

  tierId: string
  tierMinQuantity: number
  tierMaxQuantity: number | null
  unitPriceMinor: number

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
