import { adminPricingRuleSchema } from '@/lib/validation'
import { adminHandler } from '../_handler'
import { createPricingRule } from '@/server/catalog/admin'
import { db } from '@/server/db'

export const dynamic = 'force-dynamic'

export const GET = adminHandler({ minimumRole: 'SUPPORT' }, async ({ req }) => {
  const serviceVariantId = req.nextUrl.searchParams.get('serviceVariantId')
  const rules = await db.pricingRule.findMany({
    where: serviceVariantId ? { serviceVariantId } : undefined,
    orderBy: [{ serviceVariantId: 'asc' }, { minQuantity: 'asc' }],
  })
  return { rules, pricesTaxInclusive: true }
})

export const POST = adminHandler({ schema: adminPricingRuleSchema }, ({ input, actor }) =>
  createPricingRule(input, actor),
)
