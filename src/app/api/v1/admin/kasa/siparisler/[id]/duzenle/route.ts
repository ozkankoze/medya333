import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { updateManualOrder } from '@/server/kasa/edit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/siparisler/{id}/duzenle
 *
 * ⚠️ Kullanıcı adı, sipariş içeriği, tarih ve durum her zaman düzenlenir.
 * Tutar ve maliyet yalnızca o kayda bağlı bir kasa hareketi YOKKEN.
 */
const schema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(300).optional(),
  occurredAt: z.string().min(8).optional(),
  salePriceMinor: z.number().int().nonnegative().optional(),
  costMinor: z.number().int().nonnegative().optional(),
  status: z.enum(['BEKLIYOR', 'DEVAM_EDIYOR', 'TAMAMLANDI', 'IPTAL']).optional(),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    let at: Date | undefined
    if (input.occurredAt) {
      at = new Date(input.occurredAt)
      if (Number.isNaN(at.getTime())) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    }
    try {
      const o = await updateManualOrder({ orderId: id, ...input, occurredAt: at })
      return { id: o.id }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
