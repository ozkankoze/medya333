import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { deleteEntry, updateEntry } from '@/server/kasa/edit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/v1/admin/kasa/entries/{id} — kasa hareketini düzenler
 * DELETE /api/v1/admin/kasa/entries/{id} — kasa hareketini siler
 *
 * ⚠️ BAĞLI HAREKETTE TUTAR VE HESAP DONAR. Bir pakete, siparişe, alacağa
 * veya borca bağlı hareketin tutarı değiştirilirse o kayıtla kasa arasında
 * sessiz bir fark oluşurdu. Açıklama, tarih ve not serbesttir — yazım
 * hatası düzeltmek parayı bozmaz.
 *
 * ⚠️ SİLME DE BAĞLIYSA REDDEDİLİR: bağlı kayıt "tahsil edildi" görünürken
 * karşılığında hiçbir para olmazdı. Asıl engel veritabanının RESTRICT
 * kısıtıdır; buradaki kontrol anlaşılır mesaj içindir.
 */
const schema = z.object({
  occurredAt: z.string().min(8).optional(),
  accountId: z.string().min(1).optional(),
  category: z
    .enum(['SATIS', 'TAHSILAT', 'GIDER', 'MALIYET', 'BORC_ODEME', 'TRANSFER_IN', 'TRANSFER_OUT', 'DIGER'])
    .optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
  amountMinor: z.number().int().positive().optional(),
  description: z.string().min(1).max(500).optional(),
  customerHandle: z.string().max(200).optional().nullable(),
  costMinor: z.number().int().nonnegative().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
})

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    let at: Date | undefined
    if (input.occurredAt) {
      at = new Date(input.occurredAt)
      if (Number.isNaN(at.getTime())) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    }
    try {
      const e = await updateEntry({ entryId: id, ...input, occurredAt: at })
      return { id: e.id }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'SUPERADMIN' }, async () => {
    try {
      return await deleteEntry(id)
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
