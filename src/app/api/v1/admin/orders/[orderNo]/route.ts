import type { NextRequest } from 'next/server'
import { adminHandler } from '../../_handler'
import { getOrderForAdmin } from '@/server/orders/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orderNo: string }> }

/** GET /api/v1/admin/orders/[orderNo] — sipariş detayı + tam olay geçmişi. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { orderNo } = await ctx.params
  return adminHandler({ minimumRole: 'SUPPORT' }, () => getOrderForAdmin(orderNo))(req)
}
