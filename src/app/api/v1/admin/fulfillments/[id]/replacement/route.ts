import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { REPLACEMENT_STATUS, type ReplacementStatus } from '@/lib/enums'
import { adminHandler } from '../../../_handler'
import { advanceReplacement, createReplacementCase } from '@/server/fulfillment/replacement'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

const createSchema = z.object({
  reason: z.string().trim().min(3, 'Gerekçe gerekli.').max(500),
  replacementQuantity: z.number().int().positive('Telafi adedi sıfırdan büyük olmalıdır.'),
  currentMetric: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
})

const advanceSchema = z.object({
  replacementId: z.string().trim().min(20).max(40),
  status: z.enum(REPLACEMENT_STATUS as unknown as [string, ...string[]]),
  note: z.string().trim().max(300).optional().nullable(),
})

const schema = z.union([createSchema, advanceSchema])

/**
 * POST .../replacement — garanti telafisi.
 *
 * ⚠️ TAMAMEN MANUEL. Sistem düşüş görüp kendiliğinden telafi başlatmaz.
 * Gövde `replacementId` taşıyorsa mevcut vaka ilerletilir, taşımıyorsa
 * yeni vaka açılır. `APPROVED` yalnızca ADMIN+ tarafından verilir.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'OPERATOR' }, ({ input, actor, user }) => {
    const who = { userId: actor.actorId, role: user.role, ipHash: actor.actorIpHash ?? null }

    if ('replacementId' in input) {
      return advanceReplacement(
        input.replacementId,
        input.status as ReplacementStatus,
        who,
        input.note ?? null,
      )
    }
    return createReplacementCase(
      {
        fulfillmentId: id,
        reason: input.reason,
        replacementQuantity: input.replacementQuantity,
        currentMetric: input.currentMetric ?? null,
      },
      who,
    )
  })(req)
}
