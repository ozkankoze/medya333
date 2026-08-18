import { z } from 'zod'
import { cuidSchema } from '@/lib/validation'
import { adminHandler } from '../../_handler'
import { reorderPlatforms } from '@/server/catalog/admin'

export const dynamic = 'force-dynamic'

const schema = z.object({
  order: z
    .array(z.object({ id: cuidSchema, sortOrder: z.number().int().min(0).max(9999) }))
    .min(1)
    .max(100),
})

export const POST = adminHandler({ schema }, ({ input, actor }) =>
  reorderPlatforms(input.order, actor),
)
