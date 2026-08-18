import { NextResponse, type NextRequest } from 'next/server'
import { PricingError } from '@/lib/pricing'
import { pricingQuoteSchema } from '@/lib/validation'
import { getSessionUser } from '@/server/auth'
import { apiError, handleUnexpected, readJsonBody } from '@/server/http'
import { CouponInvalidError, resolvePrice, VariantNotFoundError } from '@/server/pricing/resolve'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/pricing/quote
 *
 * OTORİTE FİYAT. İstemciden gelen unitPrice / subtotal / tax / total
 * değerlerine ASLA güvenilmez — hiçbiri girdi şemasında bile kabul edilmez.
 * Sunucu, veritabanındaki güncel PricingRule'ları okuyup `lib/pricing/calculate.ts`
 * ile yeniden hesaplar.
 *
 * KDV DAHİL: `total` ödenecek tutardır; vergi ondan geriye ayrıştırılır.
 */
export async function POST(req: NextRequest) {
  // Rate limit yapılandırma hatası (üretimde Redis yok) opak 500 yerine
  // teşhis edilebilir 503 döner.
  let limit
  try {
    limit = await rateLimit('pricing.quote.ip', rateLimitIdentifier(req.headers))
  } catch (err) {
    return handleUnexpected('pricing.quote', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla istek. Lütfen biraz bekleyin.', 429, {
      headers: rateLimitHeaders(limit),
    })
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = pricingQuoteSchema.safeParse(body.data)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: parsed.error.flatten().fieldErrors,
      headers: rateLimitHeaders(limit),
    })
  }

  const user = await getSessionUser()

  try {
    const { breakdown, variant, couponId, campaignId } = await resolvePrice({
      serviceVariantId: parsed.data.serviceVariantId,
      quantity: parsed.data.quantity,
      couponCode: parsed.data.couponCode ?? null,
      userId: user?.id ?? null,
    })

    return NextResponse.json(
      {
        quantity: breakdown.quantity,
        /** ⚠️ PACKAGE modunda birim fiyat YOKTUR (0) — `packagePrice` kullanılır. */
        pricingMode: breakdown.pricingMode,
        packagePrice: breakdown.packagePriceMinor,
        unitPrice: breakdown.unitPriceMinor,
        unitLabel: variant.unitLabel,

        subtotal: breakdown.subtotalMinor,
        taxRate: breakdown.taxRateBp,
        taxAmount: breakdown.taxAmountMinor,
        total: breakdown.totalMinor,
        currency: breakdown.currency,

        // Gösterim için ek alanlar (KDV dahil, indirim öncesi/sonrası)
        listSubtotal: breakdown.listSubtotalMinor,
        discount: breakdown.discountMinor,
        pricesTaxInclusive: true,

        appliedTier: {
          id: breakdown.tierId,
          mode: breakdown.pricingMode,
          minQuantity: breakdown.tierMinQuantity,
          maxQuantity: breakdown.tierMaxQuantity,
          unitPrice: breakdown.unitPriceMinor,
          packagePrice: breakdown.packagePriceMinor,
        },
        nextTier: breakdown.nextTier,

        appliedCouponId: couponId,
        appliedCampaignId: campaignId,

        service: {
          platformName: variant.platformName,
          serviceName: variant.serviceName,
          variantLabel: variant.customerLabel,
        },
      },
      { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(limit) } },
    )
  } catch (err) {
    if (err instanceof PricingError) {
      return apiError(err.code, err.message, 400, { details: err.details })
    }
    if (err instanceof CouponInvalidError) return apiError(err.code, err.message, 400)
    if (err instanceof VariantNotFoundError) return apiError(err.code, err.message, 404)
    return handleUnexpected('pricing.quote', err)
  }
}
