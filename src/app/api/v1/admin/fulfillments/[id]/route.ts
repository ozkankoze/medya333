import type { NextRequest } from 'next/server'
import { adminHandler } from '../../_handler'
import { getFulfillmentDetail } from '@/server/fulfillment/queue'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/v1/admin/fulfillments/[id] — detay + tam olay geçmişi. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'SUPPORT' }, ({ user }) =>
    getFulfillmentDetail(id, { userId: user.id, role: user.role }),
  )(req)
}
