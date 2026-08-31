import type { NextRequest } from 'next/server'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { getOrderForAdmin } from '@/server/orders/admin'
import { deleteOrder, OrderArchiveError } from '@/server/orders/archive'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orderNo: string }> }

/** GET /api/v1/admin/orders/[orderNo] — sipariş detayı + tam olay geçmişi. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { orderNo } = await ctx.params
  return adminHandler({ minimumRole: 'SUPPORT' }, () => getOrderForAdmin(orderNo))(req)
}

/**
 * DELETE /api/v1/admin/orders/{orderNo} — siparişi GERÇEKTEN siler
 *
 * ⚠️⚠️ GERİ ALINAMAZ ve yalnızca ÖDEME KAYDI OLMAYAN siparişlerde çalışır.
 *
 * Ödemesi olan sipariş silinemez — bu bir tercih değil, veritabanı kuralı:
 * `Payment` ve `Refund` yabancı anahtarları ON DELETE RESTRICT. Servis
 * katmanı aynı kontrolü önceden yapıp anlaşılır bir mesaj döndürür.
 *
 * ⚠️ SİLME ŞUNLARI DA GÖTÜRÜR (CASCADE): sipariş kalemi, TÜM olay geçmişi,
 * fulfillment kaydı ve bildirim kayıtları. Müşterinin takip linki 404 olur.
 * Ödemesiz (terk edilmiş) bir sipariş için bunlar zaten değersizdir.
 *
 * ⚠️ MİNİMUM ROL **SUPERADMIN** — arşivden (ADMIN) DAHA DAR.
 * En yıkıcı işlem en dar kapıda durur. Silme geri alınamaz; arşiv alınabilir.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { orderNo } = await ctx.params
  return adminHandler({ minimumRole: 'SUPERADMIN' }, async ({ actor }) => {
    try {
      return await deleteOrder(orderNo, actor)
    } catch (err) {
      if (err instanceof OrderArchiveError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
