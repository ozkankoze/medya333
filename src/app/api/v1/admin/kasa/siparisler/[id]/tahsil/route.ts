import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { collectOrderPayment } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/siparisler/{id}/tahsil — "ödeme geldi"
 *
 * ⚠️ SİPARİŞ DEFTERİNDE BANKA BAKİYESİNİ ARTIRAN TEK YER BURASIDIR.
 * Sipariş girmek bakiyeye dokunmaz; para gerçekten geldiğinde bu uç
 * çağrılır ve seçilen hesaba `SATIS` kategorisinde gelir yazılır.
 *
 * ⚠️ ÇİFT TAHSİLAT ENGELLİ: servis katmanı satırı `FOR UPDATE` ile
 * kilitler ve `paidAt` doluysa reddeder; ayrıca `paymentEntryId`
 * veritabanında tekildir.
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
      const order = await collectOrderPayment({
        orderId: id,
        accountId: input.accountId,
        occurredAt: at,
        createdById: user.id,
      })
      return { id: order.id, paidAt: order.paidAt }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
