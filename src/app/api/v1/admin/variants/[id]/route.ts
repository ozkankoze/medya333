import type { NextRequest } from 'next/server'
import { adminVariantSchema } from '@/lib/validation'
import { adminHandler } from '../../_handler'
import { deleteVariant, updateVariant } from '@/server/catalog/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  // .partial() refine'ı düşürdüğü için min/max kontrolü servis katmanında tekrar yapılır
  return adminHandler({ schema: adminVariantSchema.innerType().partial() }, ({ input, actor }) =>
    updateVariant(id, input, actor),
  )(req)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'ADMIN' }, ({ actor }) => deleteVariant(id, actor))(req)
}
