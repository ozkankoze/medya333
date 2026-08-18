import 'server-only'

import { calculatePrice, type PriceBreakdown } from '@/lib/pricing'
import type { DiscountSpec, PricingTier } from '@/lib/pricing/types'
import { env } from '@/env'
import { db } from '@/server/db'

/**
 * OTORİTE FİYAT ÇÖZÜMLEYİCİ
 *
 * DB'den TAZE kademeleri çeker ve `lib/pricing/calculate.ts`'e verir —
 * tarayıcının kullandığı AYNI saf fonksiyon. İki hesaplama kodu yoktur.
 *
 * Sipariş oluşturulurken istemcinin gönderdiği fiyat KULLANILMAZ; sadece
 * karşılaştırılır ve fark varsa sipariş reddedilip loglanır.
 */

export class VariantNotFoundError extends Error {
  readonly code = 'VARIANT_NOT_FOUND'
  constructor() {
    super('Seçilen hizmet bulunamadı veya artık aktif değil.')
  }
}

export class CouponInvalidError extends Error {
  readonly code = 'COUPON_INVALID'
  constructor(message: string) {
    super(message)
  }
}

export interface ResolvePriceInput {
  serviceVariantId: string
  quantity: number
  couponCode?: string | null
  userId?: string | null
  /** Kupon doğrulaması yapılsın mı? Salt fiyat gösteriminde false olabilir. */
  applyCoupon?: boolean
}

export interface ResolvedPrice {
  breakdown: PriceBreakdown
  variant: {
    id: string
    serviceId: string
    platformId: string
    customerLabel: string
    platformName: string
    serviceName: string
    /** SADECE gösterim — fiyat hesabına girmez */
    unitLabel: string
  }
  couponId: string | null
  campaignId: string | null
}

export async function getDefaultTaxRateBp(): Promise<number> {
  const row = await db.taxRate.findFirst({
    where: { isActive: true, isDefault: true },
    select: { rateBp: true },
  })
  return row?.rateBp ?? env.DEFAULT_TAX_RATE_BP
}

export async function resolvePrice(input: ResolvePriceInput): Promise<ResolvedPrice> {
  const now = new Date()

  const variant = await db.serviceVariant.findFirst({
    where: { id: input.serviceVariantId, isActive: true },
    include: {
      service: { include: { platform: true } },
      pricingRules: {
        where: {
          isActive: true,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        },
      },
    },
  })

  if (!variant || !variant.service.isActive || !variant.service.platform.isActive) {
    throw new VariantNotFoundError()
  }

  const tiers: PricingTier[] = variant.pricingRules.map((r) => ({
    id: r.id,
    mode: r.mode,
    minQuantity: r.minQuantity,
    maxQuantity: r.maxQuantity,
    unitPriceMinor: r.unitPriceMinor,
    packagePriceMinor: r.packagePriceMinor,
    setupFeeMinor: r.setupFeeMinor,
    priority: r.priority,
  }))

  // --- Kampanya ---
  const campaign = await db.campaign.findFirst({
    where: {
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      OR: [
        { platformIds: { has: variant.service.platformId } },
        { variantIds: { has: variant.id } },
        { AND: [{ platformIds: { isEmpty: true } }, { variantIds: { isEmpty: true } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
  })

  const campaignSpec: DiscountSpec | null = campaign
    ? { id: campaign.id, type: campaign.discountType, value: campaign.discountValue }
    : null

  // --- Kupon (SADECE sunucuda doğrulanır) ---
  let couponSpec: DiscountSpec | null = null
  let couponId: string | null = null

  if (input.applyCoupon !== false && input.couponCode) {
    const code = input.couponCode.trim().toUpperCase()
    const coupon = await db.coupon.findUnique({ where: { code } })

    if (!coupon || !coupon.isActive) throw new CouponInvalidError('Kupon kodu geçersiz.')
    if (coupon.validFrom > now) throw new CouponInvalidError('Bu kupon henüz geçerli değil.')
    if (coupon.validUntil && coupon.validUntil < now) {
      throw new CouponInvalidError('Bu kuponun süresi dolmuş.')
    }
    if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) {
      throw new CouponInvalidError('Bu kuponun kullanım hakkı dolmuş.')
    }

    const scoped =
      (coupon.platformIds.length === 0 && coupon.serviceIds.length === 0 && coupon.variantIds.length === 0) ||
      coupon.platformIds.includes(variant.service.platformId) ||
      coupon.serviceIds.includes(variant.serviceId) ||
      coupon.variantIds.includes(variant.id)
    if (!scoped) throw new CouponInvalidError('Bu kupon seçtiğiniz hizmette geçerli değil.')

    if (input.userId && coupon.maxRedemptionsPerUser != null) {
      const used = await db.couponRedemption.count({
        where: { couponId: coupon.id, userId: input.userId },
      })
      if (used >= coupon.maxRedemptionsPerUser) {
        throw new CouponInvalidError('Bu kuponu daha önce kullandınız.')
      }
    }

    couponId = coupon.id
    couponSpec = {
      id: coupon.id,
      code: coupon.code,
      type: coupon.discountType,
      value: coupon.discountValue,
      maxDiscountMinor: coupon.maxDiscountMinor,
      minOrderMinor: coupon.minOrderMinor,
    }
  }

  const taxRateBp = await getDefaultTaxRateBp()

  const breakdown = calculatePrice({
    quantity: input.quantity,
    tiers,
    constraints: {
      minQuantity: variant.minQuantity,
      maxQuantity: variant.maxQuantity,
      quantityStep: variant.quantityStep,
      // ⚠️ Hazır miktar kilidi SUNUCUDA da uygulanır: istemci 7.342 gönderse
      // bile buradan geçemez.
      presetQuantities: variant.presetQuantities,
      presetOnly: variant.presetOnly,
    },
    taxRateBp,
    campaign: campaignSpec,
    coupon: couponSpec,
    allowStacking: campaign?.isStackableWithCoupon ?? false,
  })

  return {
    breakdown,
    variant: {
      id: variant.id,
      serviceId: variant.serviceId,
      platformId: variant.service.platformId,
      customerLabel: variant.customerLabel,
      platformName: variant.service.platform.name,
      serviceName: variant.service.name,
      unitLabel: variant.service.unitLabel,
    },
    couponId: breakdown.couponDiscountMinor > 0 ? couponId : null,
    campaignId: breakdown.campaignDiscountMinor > 0 ? (campaign?.id ?? null) : null,
  }
}
