import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { collectPayment } from '@/server/kasa/packages'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/paketler/{id}/tahsil — "ödeme geldi"
 *
 * ⚠️ BANKA BAKİYESİNİ ARTIRAN TEK YER BURASIDIR. Paket oluşturmak
 * bakiyeye dokunmaz; para gerçekten geldiğinde bu uç çağrılır.
 *
 * ⚠️ ÇİFT TAHSİLAT ENGELLİ: servis katmanı `paidAt` doluysa reddeder,
 * ayrıca `paymentEntryId` veritabanında tekildir.
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
      const pkg = await collectPayment({
        packageId: id,
        accountId: input.accountId,
        occurredAt: at,
        createdById: user.id,
      })
      return { id: pkg.id, paidAt: pkg.paidAt }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
