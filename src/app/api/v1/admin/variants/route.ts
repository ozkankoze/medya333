import { adminVariantSchema } from '@/lib/validation'
import { adminHandler } from '../_handler'
import { createVariant } from '@/server/catalog/admin'
import { db } from '@/server/db'

export const dynamic = 'force-dynamic'

export const GET = adminHandler({ minimumRole: 'SUPPORT' }, async ({ req }) => {
  const serviceId = req.nextUrl.searchParams.get('serviceId')
  const variants = await db.serviceVariant.findMany({
    where: serviceId ? { serviceId } : undefined,
    orderBy: [{ serviceId: 'asc' }, { sortOrder: 'asc' }],
    include: {
      service: { select: { name: true, unitLabel: true, platform: { select: { name: true } } } },
      _count: { select: { pricingRules: true, orders: true } },
    },
  })
  return { variants }
})

export const POST = adminHandler({ schema: adminVariantSchema }, ({ input, actor }) =>
  createVariant(input, actor),
)
