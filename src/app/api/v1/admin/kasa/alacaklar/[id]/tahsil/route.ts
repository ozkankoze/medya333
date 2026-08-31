import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { settleReceivable } from '@/server/kasa/pending'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/alacaklar/{id}/tahsil — para geldi
 *
 * ⚠️ BAKİYEYİ ARTIRAN YER BURASIDIR. Alacak kaydı açmak bakiyeye
 * dokunmaz; para gerçekten geldiğinde bu uç çağrılır.
 *
 * ⚠️ YAZILACAK KATEGORİ KAYITTAN OKUNUR (`settleCategory`), burada
 * sabitlenmez: satışı zaten ciroya girmiş bir alacak TAHSILAT, yalnızca
 * alacak olarak duran bir satış ise SATIS yazmalıdır.
 */
const schema = z.object({
  accountId: z.string().min(1),
  occurredAt: z.string().min(8),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    const at = new Date(input.occurredAt)
    if (Number.isNaN(at.getTime())) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    try {
      const r = await settleReceivable({
        receivableId: id,
        accountId: input.accountId,
        occurredAt: at,
        createdById: user.id,
      })
      return { id: r.id, settledAt: r.settledAt }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
