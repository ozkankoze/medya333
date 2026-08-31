import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { payScheduled } from '@/server/kasa/pending'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/borclar/{id}/ode — borç ödendi
 *
 * ⚠️ BAKİYEYİ DÜŞÜREN YER BURASIDIR. Borç kaydı açmak bakiyeye dokunmaz;
 * para gerçekten çıktığında bu uç çağrılır.
 *
 * ⚠️ YAZILACAK KATEGORİ KAYITTAN OKUNUR (`settleCategory`): ödenmemiş bir
 * GİDER ödendiğinde gider olarak sayılmalıdır, hepsini BORC_ODEME saymak
 * günlük harcamayı kredi taksitiyle aynı kaleme yazmak olurdu.
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
      const r = await payScheduled({
        paymentId: id,
        accountId: input.accountId,
        occurredAt: at,
        createdById: user.id,
      })
      return { id: r.id, paidAt: r.paidAt }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
