import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { failFulfillment } from '@/server/fulfillment/operate'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({ reason: z.string().trim().min(3, 'Gerekçe gerekli.').max(500) })

/**
 * POST .../fail — "Sorun Bildir".
 * İş FAILED → REVIEW_REQUIRED olur. Teknik gerekçe İÇ kayıttır; müşteri
 * yalnızca "İşleminiz inceleniyor." mesajını görür.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'OPERATOR' }, ({ input, actor, user }) =>
    failFulfillment(
      id,
      { userId: actor.actorId, role: user.role, ipHash: actor.actorIpHash ?? null },
      input.reason,
    ),
  )(req)
}
