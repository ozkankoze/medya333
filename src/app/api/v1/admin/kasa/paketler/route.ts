import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { createPackage } from '@/server/kasa/packages'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/paketler — aylık müşteri paketi oluşturur
 *
 * ⚠️ MİNİMUM ROL **SUPERADMIN** (kasa modülünün tamamı gibi).
 *
 * ⚠️ BU UÇ KASAYA DOKUNMAZ. Hiçbir `CashEntry` üretmez, hiçbir bakiye
 * değişmez. Paket bir satış SÖZÜDÜR; para henüz gelmemiştir. Gelir
 * hareketi yalnızca `/tahsil` ucuyla oluşur.
 */
const schema = z.object({
  customerName: z.string().min(1).max(200),
  serviceName: z.string().min(1).max(200),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  salePriceMinor: z.number().int().nonnegative(),
  costMinor: z.number().int().nonnegative(),
  note: z.string().max(1000).optional().nullable(),
})

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    }
    try {
      const pkg = await createPackage({
        customerName: input.customerName,
        serviceName: input.serviceName,
        startDate: start,
        endDate: end,
        salePriceMinor: input.salePriceMinor,
        costMinor: input.costMinor,
        note: input.note ?? null,
        createdById: user.id,
      })
      return { id: pkg.id }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
