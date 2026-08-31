import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { setOrderStatus } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/siparisler/{id}/durum — İŞ durumunu değiştirir
 *
 * ⚠️ ÖDEME DURUMUNA DOKUNMAZ ve dokunmamalıdır. "Tamamlandı" işaretlemek
 * parayı geldi saymaz; tahsilat ayrı bir işlemdir. Aksi hâlde işi
 * bitirmek banka bakiyesini artırır ve bakiye gelmemiş parayı içerirdi.
 *
 * ⚠️ TAHSİL EDİLMİŞ BİR SİPARİŞ "İPTAL"E ÇEKİLEBİLİR, ama kasa hareketi
 * kendiliğinden silinmez — para gerçekten geldiyse iade AYRI bir
 * harekettir. Ekranda bu uyarı gösterilir.
 */
const schema = z.object({
  status: z.enum(['BEKLIYOR', 'DEVAM_EDIYOR', 'TAMAMLANDI', 'IPTAL']),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    try {
      const order = await setOrderStatus(id, input.status)
      return { id: order.id, status: order.status }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
