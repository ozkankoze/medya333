import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { createOrder } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/siparisler — elle sipariş kaydı ekler
 *
 * ⚠️ MİNİMUM ROL **SUPERADMIN** (kasa modülünün tamamı gibi). Banka
 * bakiyesi ve kâr verisi ADMIN'e bile açılmaz.
 *
 * ⚠️ BU UÇ SİTEDEKİ `Order` TABLOSUNA DOKUNMAZ. Gerçek müşteri siparişi
 * oluşturmaz, mevcut hiçbir siparişi değiştirmez. Yalnızca işletmenin
 * kendi defterine (`ManualOrder`) satır yazar.
 *
 * ⚠️ BU UÇ KASAYA DA DOKUNMAZ. Hiçbir `CashEntry` üretmez, hiçbir bakiye
 * değişmez. Gelir hareketi yalnızca `/tahsil` ucuyla oluşur.
 */
const schema = z.object({
  customerName: z.string().min(1).max(200),
  occurredAt: z.string().min(8),
  salePriceMinor: z.number().int().nonnegative(),
  costMinor: z.number().int().nonnegative(),
  status: z.enum(['BEKLIYOR', 'DEVAM_EDIYOR', 'TAMAMLANDI', 'IPTAL']).optional(),
})

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    const at = new Date(input.occurredAt)
    if (Number.isNaN(at.getTime())) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    try {
      const order = await createOrder({
        customerName: input.customerName,
        occurredAt: at,
        salePriceMinor: input.salePriceMinor,
        costMinor: input.costMinor,
        status: input.status,
        createdById: user.id,
      })
      return { id: order.id }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
