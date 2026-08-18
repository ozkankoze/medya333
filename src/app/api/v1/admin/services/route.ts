import { adminServiceSchema } from '@/lib/validation'
import { adminHandler } from '../_handler'
import { createService } from '@/server/catalog/admin'
import { db } from '@/server/db'
import { SUGGESTED_UNIT_LABELS } from '@/lib/units'

export const dynamic = 'force-dynamic'

export const GET = adminHandler({ minimumRole: 'SUPPORT' }, async ({ req }) => {
  const platformId = req.nextUrl.searchParams.get('platformId')
  const services = await db.service.findMany({
    where: platformId ? { platformId } : undefined,
    orderBy: [{ platformId: 'asc' }, { sortOrder: 'asc' }],
    include: {
      platform: { select: { slug: true, name: true } },
      _count: { select: { variants: true, orders: true } },
    },
  })
  return { services, suggestedUnitLabels: SUGGESTED_UNIT_LABELS }
})

export const POST = adminHandler({ schema: adminServiceSchema }, ({ input, actor }) =>
  createService(input, actor),
)
