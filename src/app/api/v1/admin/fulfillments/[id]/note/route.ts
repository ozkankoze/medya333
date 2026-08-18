import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { addNote } from '@/server/fulfillment/operate'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  note: z.string().trim().min(1).max(1000),
  /** true → müşteriye görünür kontrollü not; false → iç operasyon notu */
  customerVisible: z.boolean().default(false),
})

/**
 * POST .../note
 *
 * SUPPORT yalnızca MÜŞTERİ notu yazabilir (durum/ilerleme değiştiremez).
 * İç not için OPERATOR+ ve atama şartı aranır.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPPORT' }, ({ input, actor, user }) =>
    addNote(
      id,
      { userId: actor.actorId, role: user.role, ipHash: actor.actorIpHash ?? null },
      { note: input.note, customerVisible: input.customerVisible },
    ),
  )(req)
}
