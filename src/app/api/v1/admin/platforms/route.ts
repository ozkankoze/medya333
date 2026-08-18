import { adminPlatformSchema } from '@/lib/validation'
import { adminHandler } from '../_handler'
import { createPlatform } from '@/server/catalog/admin'
import { db } from '@/server/db'
import { listAdapterKeys } from '@/server/platforms/registry'

export const dynamic = 'force-dynamic'

/** GET /api/v1/admin/platforms — admin listesi (iç alanlar DAHİL, yetkili kullanıcı) */
export const GET = adminHandler({ minimumRole: 'SUPPORT' }, async () => {
  const platforms = await db.platform.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { services: true, orders: true } } },
  })
  return { platforms, availableAdapters: listAdapterKeys() }
})

/** POST /api/v1/admin/platforms */
export const POST = adminHandler({ schema: adminPlatformSchema }, ({ input, actor }) =>
  createPlatform(input, actor),
)
