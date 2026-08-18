import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { updateProgress } from '@/server/fulfillment/operate'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

/**
 * ⚠️ ŞEMADA `remaining` VE `percent` YOKTUR.
 * İlerleme yüzdesi ve kalan miktar sunucuda hesaplanır; istemciden gelen
 * değer kabul edilmez (Faz 4 kuralı 14 ve 16).
 */
const schema = z
  .object({
    currentMetric: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
    deliveredQuantity: z.number().int().min(0).max(10_000_000).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.currentMetric != null || v.deliveredQuantity != null, {
    message: 'Güncel ölçüm veya teslim adedi girilmelidir.',
  })

/** POST .../progress — MANUEL ilerleme kaydı. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'OPERATOR' }, ({ input, actor, user }) =>
    updateProgress(
      {
        fulfillmentId: id,
        currentMetric: input.currentMetric ?? null,
        deliveredQuantity: input.deliveredQuantity ?? null,
        note: input.note ?? null,
      },
      { userId: actor.actorId, role: user.role, ipHash: actor.actorIpHash ?? null },
    ),
  )(req)
}
