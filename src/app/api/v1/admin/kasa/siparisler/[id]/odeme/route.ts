import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { cozumleOdeme, uygulaOdeme } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/siparisler/[id]/odeme — "Ödeme" kutusunu uygular
 *
 * Mevcut bir satırın ödeme kutusuna sonradan yazılan değeri işler:
 *   "12.09.2026" → beklenen ödeme günü (ALACAK)
 *   "yapıkredi"  → o hesaba gelir yazılır (TAHSİLAT, bakiye artar)
 *   boş          → beklenen gün silinir
 *
 * ⚠️ BOŞ GÖNDERMEK TAHSİLATI GERİ ALMAZ. Yalnızca beklenen tarihi siler.
 * Yazılmış bir gelir hareketini bu uçtan geri almak, bakiyeyi sessizce
 * düşürürdü; tahsilatın iptali kasa dökümünden, hareketin kendisi
 * silinerek yapılır ve orada ne olduğu görünür.
 *
 * ⚠️ MİNİMUM ROL SUPERADMIN — kasa modülünün tamamı gibi.
 */
const schema = z.object({
  odeme: z.string().max(60),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    try {
      const sonuc = await uygulaOdeme({
        orderId: id,
        girdi: await cozumleOdeme(input.odeme),
        bugun: new Date(),
        createdById: user.id,
      })
      return { ok: true, odeme: sonuc }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
