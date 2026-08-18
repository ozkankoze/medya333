import type { NextRequest } from 'next/server'
import { adminPlatformSchema } from '@/lib/validation'
import { adminHandler } from '../../_handler'
import { deletePlatform, updatePlatform } from '@/server/catalog/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema: adminPlatformSchema.partial() }, ({ input, actor }) =>
    updatePlatform(id, input, actor),
  )(req)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'ADMIN' }, ({ actor }) => deletePlatform(id, actor))(req)
}
