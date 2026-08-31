import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { apiError } from '@/server/http'
import { archiveOrder, unarchiveOrder, OrderArchiveError } from '@/server/orders/archive'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orderNo: string }> }

/**
 * POST /api/v1/admin/orders/{orderNo}/arsiv — siparişi kuyruktan kaldırır
 *
 * ⚠️ HİÇBİR ŞEY SİLMEZ. Kayıt, ödeme geçmişi ve olay dökümü yerinde kalır;
 * sipariş yalnızca İş Kuyruğu'nda görünmez olur. Geri alınabilir
 * (`{ "archived": false }`).
 *
 * ⚠️ MİNİMUM ROL **ADMIN**. Arşivleme geri alınabilir olduğu için silmeden
 * daha geniş bir kapıdır; ama yine de operatöre açılmaz — kuyruktan iş
 * kaldırmak operasyonel bir karardır, operatörün görevi kuyruğu işlemektir.
 */
const schema = z.object({
  /** true → arşivle, false → arşivden çıkar */
  archived: z.boolean(),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  const { orderNo } = await ctx.params
  return adminHandler({ schema, minimumRole: 'ADMIN' }, async ({ input, actor }) => {
    try {
      return input.archived
        ? await archiveOrder(orderNo, actor)
        : await unarchiveOrder(orderNo, actor)
    } catch (err) {
      if (err instanceof OrderArchiveError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
