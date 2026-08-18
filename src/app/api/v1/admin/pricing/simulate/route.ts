import { z } from 'zod'
import { cuidSchema, couponCodeSchema, quantitySchema } from '@/lib/validation'
import { adminHandler } from '../../_handler'
import { resolvePrice } from '@/server/pricing/resolve'

export const dynamic = 'force-dynamic'

const schema = z.object({
  serviceVariantId: cuidSchema,
  quantities: z.array(quantitySchema).min(1).max(20),
  couponCode: couponCodeSchema.optional().nullable(),
})

/**
 * POST /api/v1/admin/pricing/simulate
 *
 * Admin, fiyat kademesini KAYDETMEDEN önce "7500 adet kaça gelir" diye
 * deneyebilsin diye. Müşterinin göreceği motoru birebir kullanır.
 */
export const POST = adminHandler({ schema, minimumRole: 'SUPPORT' }, async ({ input }) => {
  const results = []
  for (const quantity of input.quantities) {
    try {
      const { breakdown, variant } = await resolvePrice({
        serviceVariantId: input.serviceVariantId,
        quantity,
        couponCode: input.couponCode ?? null,
      })
      results.push({
        quantity,
        ok: true,
        unitPrice: breakdown.unitPriceMinor,
        unitLabel: variant.unitLabel,
        subtotal: breakdown.subtotalMinor,
        taxRate: breakdown.taxRateBp,
        taxAmount: breakdown.taxAmountMinor,
        total: breakdown.totalMinor,
        appliedTier: {
          id: breakdown.tierId,
          minQuantity: breakdown.tierMinQuantity,
          maxQuantity: breakdown.tierMaxQuantity,
        },
      })
    } catch (e) {
      results.push({ quantity, ok: false, error: (e as Error).message })
    }
  }
  return { results, pricesTaxInclusive: true }
})
