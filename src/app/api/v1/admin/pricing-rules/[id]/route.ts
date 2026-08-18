import type { NextRequest } from 'next/server'
import { adminPricingRuleSchema } from '@/lib/validation'
import { adminHandler } from '../../_handler'
import { deletePricingRule, updatePricingRule } from '@/server/catalog/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler(
    { schema: adminPricingRuleSchema.innerType().partial() },
    ({ input, actor }) => updatePricingRule(id, input, actor),
  )(req)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'ADMIN' }, ({ actor }) => deletePricingRule(id, actor))(req)
}
