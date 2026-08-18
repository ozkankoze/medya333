/**
 * ⭐ PRICING ENGINE — TEK KAYNAK
 *
 * Bu fonksiyon SAF'tır: ağ yok, DB yok, tarih yok, yan etki yok.
 * TARAYICIDA  → snapshot'taki kademelerle çalışır → slider'da 0 ms canlı fiyat
 * SUNUCUDA    → DB'den taze çekilen kademelerle çalışır → OTORİTE fiyat
 *
 * İki ayrı hesaplama kodu olmadığı için frontend/backend fiyat tutarsızlığı
 * sınıfındaki hatalar yapısal olarak imkânsızdır.
 *
 * KDV: Tüm girdi fiyatları KDV DAHİL'dir. Vergi toplamdan geriye ayrıştırılır.
 */

import { divRoundHalfUp, extractTaxFromGross } from '@/lib/money'
import {
  PricingError,
  type BreakdownLine,
  type CalculatePriceInput,
  type DiscountSpec,
  type NextTierHint,
  type PriceBreakdown,
  type PricingTier,
} from './types'

// ---------------------------------------------------------------------------
// Miktar doğrulama — AYNI kural hem istemcide hem sunucuda çalışır
// ---------------------------------------------------------------------------

export function validateQuantity(
  quantity: number,
  c: { minQuantity: number; maxQuantity: number; quantityStep: number },
): void {
  if (!Number.isInteger(quantity)) {
    throw new PricingError('INVALID_QUANTITY', 'Miktar tam sayı olmalıdır.', { quantity })
  }
  if (quantity <= 0) {
    throw new PricingError('INVALID_QUANTITY', 'Miktar sıfırdan büyük olmalıdır.', { quantity })
  }
  if (quantity < c.minQuantity) {
    throw new PricingError(
      'BELOW_MINIMUM',
      `Bu hizmet için en az ${c.minQuantity} adet sipariş verebilirsiniz.`,
      { quantity, minQuantity: c.minQuantity },
    )
  }
  if (quantity > c.maxQuantity) {
    throw new PricingError(
      'ABOVE_MAXIMUM',
      `Bu hizmet için en fazla ${c.maxQuantity} adet sipariş verebilirsiniz.`,
      { quantity, maxQuantity: c.maxQuantity },
    )
  }
  const step = c.quantityStep > 0 ? c.quantityStep : 1
  if ((quantity - c.minQuantity) % step !== 0) {
    throw new PricingError('INVALID_STEP', `Miktar ${step} adetlik adımlarla artmalıdır.`, {
      quantity,
      quantityStep: step,
      minQuantity: c.minQuantity,
    })
  }
}

// ---------------------------------------------------------------------------
// Kademe seçimi
// ---------------------------------------------------------------------------

function tierCovers(tier: PricingTier, quantity: number): boolean {
  return quantity >= tier.minQuantity && (tier.maxQuantity === null || quantity <= tier.maxQuantity)
}

/**
 * Kademe seçimi: önce `priority` (büyük kazanır), eşitse daha dar/yüksek
 * `minQuantity` kazanır. Böylece admin geçici bir kampanya kademesini yüksek
 * priority ile ekleyip mevcut yapıyı bozmadan üzerine yazabilir.
 */
export function selectTier(tiers: PricingTier[], quantity: number): PricingTier {
  const matching = tiers.filter((t) => tierCovers(t, quantity))
  if (matching.length === 0) {
    throw new PricingError(
      'NO_PRICING_RULE',
      'Bu miktar için tanımlı fiyat bulunamadı. Lütfen farklı bir miktar deneyin.',
      { quantity, tierCount: tiers.length },
    )
  }
  return matching.reduce((best, t) => {
    if (t.priority !== best.priority) return t.priority > best.priority ? t : best
    return t.minQuantity > best.minQuantity ? t : best
  })
}

/**
 * GRADUATED (kademeli) toplam.
 *
 * Kademeler artan sırada gezilir; her kademeye düşen adet kendi fiyatıyla
 * çarpılır. En düşük kademenin alt sınırı 0 kabul edilir — aksi halde
 * variant.minQuantity altındaki adetler hiçbir kademeye düşmez ve toplam
 * miktar tutmaz.
 */
function graduatedTotal(tiers: PricingTier[], quantity: number): number {
  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity)
  let prevUpper = 0
  let total = 0

  for (const tier of sorted) {
    const upper = tier.maxQuantity ?? Number.MAX_SAFE_INTEGER
    const unitsInBand = Math.max(0, Math.min(quantity, upper) - prevUpper)
    total += unitsInBand * tier.unitPriceMinor
    prevUpper = Math.max(prevUpper, Math.min(upper, quantity))
    if (quantity <= upper) break
  }
  return total
}

// ---------------------------------------------------------------------------
// İndirimler
// ---------------------------------------------------------------------------

function computeDiscount(baseMinor: number, spec: DiscountSpec | null | undefined): number {
  if (!spec) return 0
  if (spec.minOrderMinor != null && baseMinor < spec.minOrderMinor) return 0

  let discount =
    spec.type === 'PERCENTAGE'
      ? divRoundHalfUp(baseMinor * spec.value, 10_000)
      : Math.max(0, spec.value)

  if (spec.maxDiscountMinor != null) discount = Math.min(discount, spec.maxDiscountMinor)
  // İndirim tutarı hiçbir zaman tabanı aşamaz — negatif toplam oluşamaz.
  return Math.min(discount, baseMinor)
}

// ---------------------------------------------------------------------------
// Upsell göstergesi
// ---------------------------------------------------------------------------

function findNextTier(
  tiers: PricingTier[],
  quantity: number,
  currentUnitPrice: number,
): NextTierHint | null {
  const candidates = tiers
    .filter((t) => t.minQuantity > quantity && t.unitPriceMinor < currentUnitPrice)
    .sort((a, b) => a.minQuantity - b.minQuantity)

  const next = candidates[0]
  if (!next) return null

  return {
    minQuantity: next.minQuantity,
    unitPriceMinor: next.unitPriceMinor,
    unitSavingMinor: currentUnitPrice - next.unitPriceMinor,
    totalAtNextTierMinor: next.unitPriceMinor * next.minQuantity + next.setupFeeMinor,
  }
}

// ---------------------------------------------------------------------------
// ANA FONKSİYON
// ---------------------------------------------------------------------------

export function calculatePrice(input: CalculatePriceInput): PriceBreakdown {
  const {
    quantity,
    tiers,
    constraints,
    taxRateBp,
    campaign = null,
    coupon = null,
    allowStacking = false,
    currency = 'TRY',
  } = input

  if (!Number.isInteger(taxRateBp) || taxRateBp < 0) {
    throw new PricingError('INVALID_TAX_RATE', 'Geçersiz KDV oranı.', { taxRateBp })
  }

  // 1) Miktar doğrulama
  validateQuantity(quantity, constraints)

  // 2) Kademe seçimi
  const tier = selectTier(tiers, quantity)

  // 3) Taban tutar (KDV DAHİL)
  const goodsMinor =
    tier.mode === 'GRADUATED' ? graduatedTotal(tiers, quantity) : tier.unitPriceMinor * quantity
  const listSubtotalMinor = goodsMinor + tier.setupFeeMinor

  // 4) İndirimler — kampanya önce, kupon sonra
  const campaignDiscountMinor = computeDiscount(listSubtotalMinor, campaign)
  const afterCampaign = listSubtotalMinor - campaignDiscountMinor

  let couponDiscountMinor = 0
  if (coupon) {
    const stackingBlocked = campaignDiscountMinor > 0 && !allowStacking
    if (!stackingBlocked) {
      couponDiscountMinor = computeDiscount(afterCampaign, coupon)
    }
  }

  const discountMinor = campaignDiscountMinor + couponDiscountMinor
  const totalMinor = listSubtotalMinor - discountMinor

  // 5) KDV — brüt toplamdan geriye ayrıştırılır (checkout'ta üzerine EKLENMEZ)
  const { taxAmountMinor, netMinor } = extractTaxFromGross(totalMinor, taxRateBp)

  // 6) Kırılım satırları
  const lines: BreakdownLine[] = [
    {
      key: 'goods',
      label: `${quantity} × birim fiyat`,
      amountMinor: goodsMinor,
    },
  ]
  if (tier.setupFeeMinor > 0) {
    lines.push({ key: 'setup_fee', label: 'Hizmet bedeli', amountMinor: tier.setupFeeMinor })
  }
  if (campaignDiscountMinor > 0) {
    lines.push({
      key: 'campaign',
      label: 'Kampanya indirimi',
      amountMinor: -campaignDiscountMinor,
    })
  }
  if (couponDiscountMinor > 0) {
    lines.push({
      key: 'coupon',
      label: coupon?.code ? `Kupon (${coupon.code})` : 'Kupon indirimi',
      amountMinor: -couponDiscountMinor,
    })
  }
  lines.push({ key: 'total', label: 'Toplam (KDV dahil)', amountMinor: totalMinor })
  lines.push({
    key: 'tax',
    label: `Dahil KDV (%${taxRateBp / 100})`,
    amountMinor: taxAmountMinor,
    informational: true,
  })

  return {
    currency,
    quantity,
    tierId: tier.id,
    tierMinQuantity: tier.minQuantity,
    tierMaxQuantity: tier.maxQuantity,
    unitPriceMinor: tier.unitPriceMinor,
    listSubtotalMinor,
    setupFeeMinor: tier.setupFeeMinor,
    campaignDiscountMinor,
    couponDiscountMinor,
    discountMinor,
    totalMinor,
    taxRateBp,
    taxAmountMinor,
    subtotalMinor: netMinor,
    nextTier: findNextTier(tiers, quantity, tier.unitPriceMinor),
    lines,
  }
}
