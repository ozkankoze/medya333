import type { NextRequest } from 'next/server'
import { adminOrderStatusSchema } from '@/lib/validation'
import { adminHandler } from '../../../_handler'
import { adminTransitionOrder } from '@/server/orders/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orderNo: string }> }

/**
 * POST /api/v1/admin/orders/[orderNo]/status
 *
 * İzinler:
 *   • `PENDING_PAYMENT → CANCELLED` SERBEST
 *   • `PENDING_PAYMENT → PROCESSING` REDDEDİLİR (409 FULFILLMENT_BEFORE_PAYMENT)
 *     Ödeme alınmayan hiçbir sipariş işleme alınamaz — admin yetkisi bu kuralı aşmaz.
 *
 * Minimum rol: OPERATOR (SUPPORT yalnızca okuyabilir).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { orderNo } = await ctx.params
  return adminHandler(
    { schema: adminOrderStatusSchema, minimumRole: 'OPERATOR' },
    ({ input, actor }) =>
      adminTransitionOrder({
        orderNoOrId: orderNo,
        to: input.status,
        reason: input.reason ?? null,
        actorId: actor.actorId,
        actorIpHash: actor.actorIpHash ?? null,
      }),
  )(req)
}
