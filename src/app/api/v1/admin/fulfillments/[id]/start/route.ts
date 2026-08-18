import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { startFulfillment } from '@/server/fulfillment/operate'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  /** METRIC modunda hedefin işe başlarken ölçülen değeri */
  initialMetric: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
})

/**
 * POST .../start — MANUEL "İşleme Başlat".
 *
 * ⚠️ Bu uç olmadan hiçbir iş başlamaz. Sistem, webhook veya cron
 * fulfillment başlatamaz (lib/fulfillment/status.ts → MANUAL_ONLY_TRANSITIONS).
 *
 * READY → PROCESSING → STARTED, tek transaction zincirinde.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'OPERATOR' }, ({ input, actor, user }) =>
    startFulfillment(
      {
        fulfillmentId: id,
        initialMetric: input.initialMetric ?? null,
        note: input.note ?? null,
      },
      { userId: actor.actorId, role: user.role, ipHash: actor.actorIpHash ?? null },
    ),
  )(req)
}
