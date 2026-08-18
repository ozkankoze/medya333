import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { assignFulfillment } from '@/server/fulfillment/operate'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({ userId: z.string().trim().min(20).max(40) })

/**
 * POST .../assign — operatör ataması.
 * ADMIN+ herkesi atayabilir; OPERATOR yalnızca atanmamış bir işi kendine alır.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'OPERATOR' }, ({ input, actor, user }) =>
    assignFulfillment(id, input.userId, {
      userId: actor.actorId,
      role: user.role,
      ipHash: actor.actorIpHash ?? null,
    }),
  )(req)
}
