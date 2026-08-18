import { NextResponse, type NextRequest } from 'next/server'
import { PricingError } from '@/lib/pricing'
import { couponValidateSchema } from '@/lib/validation'
import { getSessionUser } from '@/server/auth'
import { apiError, handleUnexpected, readJsonBody } from '@/server/http'
import { CouponInvalidError, resolvePrice, VariantNotFoundError } from '@/server/pricing/resolve'
import { rateLimit, rateLimitHeaders, rateLimitIdentifier } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/coupons/validate
 *
 * Kuponu doğrular VE indirimi uygulanmış OTORİTE fiyatı döndürür.
 *
 * İndirim TUTARI İSTEMCİDE HESAPLANMAZ: bu endpoint aynı `resolvePrice()`
 * yolunu kullanır, yani `/pricing/quote` ile birebir aynı motor. Böylece
 * "kupon ekranında farklı, ödeme ekranında farklı tutar" sınıfı hatalar
 * yapısal olarak imkânsızdır.
 *
 * Kontrol edilenler (hepsi sunucuda, `resolvePrice` içinde):
 *   aktiflik · tarih aralığı (validFrom/validUntil) · toplam kullanım limiti
 *   · kullanıcı başına limit · minimum sipariş tutarı · platform/hizmet/varyant
 *   kapsamı · indirim tipi (yüzde/sabit) · indirim tavanı
 */
export async function POST(req: NextRequest) {
  // Rate limit yapılandırma hatası (üretimde Redis yok) opak 500 yerine
  // teşhis edilebilir 503 döner.
  let limit
  try {
    limit = await rateLimit('coupons.validate.ip', rateLimitIdentifier(req.headers))
  } catch (err) {
    return handleUnexpected('coupons.validate', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla deneme. Lütfen biraz bekleyin.', 429, {
      headers: rateLimitHeaders(limit),
    })
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = couponValidateSchema.safeParse(body.data)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: parsed.error.flatten().fieldErrors,
      headers: rateLimitHeaders(limit),
    })
  }

  const user = await getSessionUser()

  try {
    // Kuponsuz taban fiyat — indirimin gerçek etkisini göstermek için
    const base = await resolvePrice({
      serviceVariantId: parsed.data.serviceVariantId,
      quantity: parsed.data.quantity,
      applyCoupon: false,
      userId: user?.id ?? null,
    })

    const withCoupon = await resolvePrice({
      serviceVariantId: parsed.data.serviceVariantId,
      quantity: parsed.data.quantity,
      couponCode: parsed.data.code,
      userId: user?.id ?? null,
    })

    const discount = withCoupon.breakdown.couponDiscountMinor

    if (discount <= 0) {
      // Kupon geçerli ama bu sepette indirim üretmiyor (ör. minimum tutar altı)
      return NextResponse.json(
        {
          valid: false,
          code: parsed.data.code,
          reason: 'Bu kupon seçtiğiniz miktarda indirim sağlamıyor.',
          discount: 0,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(limit) } },
      )
    }

    return NextResponse.json(
      {
        valid: true,
        code: parsed.data.code,
        discount,
        totalBeforeCoupon: base.breakdown.totalMinor,
        // Otorite fiyat — istemci bunu yeniden hesaplamaz
        quantity: withCoupon.breakdown.quantity,
        unitPrice: withCoupon.breakdown.unitPriceMinor,
        unitLabel: withCoupon.variant.unitLabel,
        subtotal: withCoupon.breakdown.subtotalMinor,
        taxRate: withCoupon.breakdown.taxRateBp,
        taxAmount: withCoupon.breakdown.taxAmountMinor,
        total: withCoupon.breakdown.totalMinor,
        currency: withCoupon.breakdown.currency,
        pricesTaxInclusive: true,
        appliedTier: {
          id: withCoupon.breakdown.tierId,
          minQuantity: withCoupon.breakdown.tierMinQuantity,
          maxQuantity: withCoupon.breakdown.tierMaxQuantity,
          unitPrice: withCoupon.breakdown.unitPriceMinor,
        },
      },
      { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(limit) } },
    )
  } catch (err) {
    // Kupon reddi bir SUNUCU HATASI değildir — 200 + valid:false ile döner,
    // böylece istemci hata durumu ile geçersiz kupon durumunu ayırmaz zorunda kalmaz.
    if (err instanceof CouponInvalidError) {
      return NextResponse.json(
        { valid: false, code: parsed.data.code, reason: err.message, discount: 0 },
        { status: 200, headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(limit) } },
      )
    }
    if (err instanceof PricingError) {
      return apiError(err.code, err.message, 400, { details: err.details })
    }
    if (err instanceof VariantNotFoundError) return apiError(err.code, err.message, 404)
    return handleUnexpected('coupons.validate', err)
  }
}
