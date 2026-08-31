import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { recordCostExpense } from '@/server/kasa/packages'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/paketler/{id}/maliyet — maliyeti gerçek gidere çevirir
 *
 * ⚠️ İSTEĞE BAĞLI. Maliyet paket kaydında zaten kâr hesabına giriyor; bu
 * uç yalnızca parayı fiilen ödediğinde banka bakiyesinin de düşmesi için
 * çağrılır. Zorunlu olsaydı, henüz ödenmemiş tedarikçi borcu bakiyeden
 * düşülmüş görünürdü.
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
      const pkg = await recordCostExpense({
        packageId: id,
        accountId: input.accountId,
        occurredAt: at,
        createdById: user.id,
      })
      return { id: pkg.id, costEntryId: pkg.costEntryId }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
