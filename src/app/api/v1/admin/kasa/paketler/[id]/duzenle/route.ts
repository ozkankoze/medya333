import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { updatePackage } from '@/server/kasa/edit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/paketler/{id}/duzenle
 *
 * ⚠️ TUTARLAR YALNIZCA BAĞLI HAREKET YOKKEN DEĞİŞİR. Tahsil edilmiş bir
 * paketin satış tutarını değiştirmek, kasa hareketiyle arasında sessiz bir
 * fark açardı — bu oturumda 79.000 TL'lik örneğiyle kanıtlandı.
 * Müşteri adı, hizmet adı, tarihler ve not her zaman düzenlenebilir.
 */
const schema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  serviceName: z.string().min(1).max(200).optional(),
  startDate: z.string().min(8).optional(),
  endDate: z.string().min(8).optional(),
  salePriceMinor: z.number().int().nonnegative().optional(),
  costMinor: z.number().int().nonnegative().optional(),
  note: z.string().max(1000).optional().nullable(),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    const parse = (v?: string) => {
      if (!v) return undefined
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const start = parse(input.startDate)
    const end = parse(input.endDate)
    if (start === null || end === null) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    try {
      const p = await updatePackage({
        packageId: id,
        ...input,
        startDate: start,
        endDate: end,
      })
      return { id: p.id }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
