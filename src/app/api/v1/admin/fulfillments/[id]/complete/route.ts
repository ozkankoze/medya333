import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { completeFulfillment } from '@/server/fulfillment/operate'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
  /** Eksik teslimle kapatmak KASITLI bir karardır; açık onay ister. */
  allowPartial: z.boolean().default(false),
})

/**
 * POST .../complete — MANUEL "Tamamla".
 *
 * ⚠️ Teslim sayısı istenen miktara ulaşmış olsa BİLE sistem otomatik
 * tamamlamaz. Bu uç çağrılmadan hiçbir iş COMPLETED olmaz.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'OPERATOR' }, ({ input, actor, user }) =>
    completeFulfillment(
      id,
      { userId: actor.actorId, role: user.role, ipHash: actor.actorIpHash ?? null },
      { note: input.note ?? null, allowPartial: input.allowPartial },
    ),
  )(req)
}
