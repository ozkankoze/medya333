import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { recordOrderCostExpense } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/siparisler/{id}/maliyet — maliyeti gerçek kasa
 * çıkışına dönüştürür
 *
 * ⚠️ İSTEĞE BAĞLIDIR. Maliyet sipariş kaydında zaten net kâra giriyor; bu
 * işlem yalnızca parayı fiilen ödediğinde banka bakiyesinin de düşmesi
 * için yapılır. Zorunlu olsaydı, henüz ödenmemiş bir tedarikçi borcu
 * bakiyeden düşülmüş görünürdü.
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
      const order = await recordOrderCostExpense({
        orderId: id,
        accountId: input.accountId,
        occurredAt: at,
        createdById: user.id,
      })
      return { id: order.id, costEntryId: order.costEntryId }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
