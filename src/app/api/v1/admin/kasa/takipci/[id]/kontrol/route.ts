import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { kontrolIsaretle } from '@/server/kasa/takipci'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/takipci/{id}/kontrol — bir günü işaretler/kaldırır
 *
 * ⚠️ İSTEK FİKİRSİZDİR (idempotent): aynı gün iki kez işaretlenirse hata
 * dönmez. Izgarada çift tıklama ve yavaş bağlantıda tekrarlanan istek
 * olağandır; bunlar hata ekranı üretmemeli.
 *
 * ⚠️ GÜN `YYYY-AA-GG` biçiminde gelir ve sunucuda UTC gün başına
 * sabitlenir. Saat taşınsaydı, aynı güne iki ayrı işaret düşebilirdi.
 */
const schema = z.object({
  gun: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isaretli: z.boolean(),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    try {
      return await kontrolIsaretle({
        orderId: id,
        gun: new Date(`${input.gun}T00:00:00.000Z`),
        isaretli: input.isaretli,
        createdById: user.id,
      })
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
