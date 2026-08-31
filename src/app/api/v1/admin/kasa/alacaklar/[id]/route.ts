import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { deletePending, updatePending } from '@/server/kasa/edit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/v1/admin/kasa/alacaklar/{id} — alacak/borç düzenler
 * DELETE /api/v1/admin/kasa/alacaklar/{id} — alacak/borç siler
 *
 * ⚠️ `kind` ZORUNLU: aynı uç iki tabloya hizmet eder (alacak · borç).
 * Kimlikler farklı tablolarda olduğu için hangisine bakılacağı istekten
 * gelmelidir; tahmin etmek yanlış tabloda arayıp "bulunamadı" demekle
 * biterdi.
 *
 * ⚠️ TAHSİL/ÖDEME YAPILMIŞSA tutar donar ve kayıt silinemez.
 */
const patchSchema = z.object({
  kind: z.enum(['alacak', 'borc']),
  person: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  dueDate: z.string().min(8).optional().nullable(),
  amountMinor: z.number().int().positive().optional(),
  costMinor: z.number().int().nonnegative().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
})

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema: patchSchema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    let due: Date | null | undefined
    if (input.dueDate === null) due = null
    else if (input.dueDate) {
      due = new Date(input.dueDate)
      if (Number.isNaN(due.getTime())) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    }
    try {
      const row = await updatePending({ id, ...input, dueDate: due })
      return { id: row.id }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}

const deleteSchema = z.object({ kind: z.enum(['alacak', 'borc']) })

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema: deleteSchema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    try {
      return await deletePending(id, input.kind)
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
