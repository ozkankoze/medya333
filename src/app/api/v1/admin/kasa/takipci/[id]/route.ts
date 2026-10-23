import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { takipciDuzenle, takipciSil } from '@/server/kasa/takipci'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST   /api/v1/admin/kasa/takipci/{id} — kullanıcı adı, bitiş sayısı,
 *                                          not ve arşiv durumunu düzenler
 * DELETE /api/v1/admin/kasa/takipci/{id} — satırı siler
 *
 * ⚠️ SİLMEK KONTROL GEÇMİŞİNİ DE SİLER (veritabanında cascade). İşi biten
 * satır için doğru hareket arşivlemektir; arayüzde de önce o sunulur.
 */
const schema = z.object({
  username: z.string().min(1).max(120).optional(),
  endCount: z.number().int().nonnegative().max(100_000_000).optional(),
  note: z.string().max(300).optional().nullable(),
  isArchived: z.boolean().optional(),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    try {
      return await takipciDuzenle({ id, ...input })
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'SUPERADMIN' }, async () => {
    await takipciSil(id)
    return { id }
  })(req)
}
