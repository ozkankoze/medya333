import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../../_handler'
import { yeniMusteriRozetiniAyarla } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/siparisler/{id}/yeni-musteri — rozeti aç/kapat
 *
 * ⚠️ BU UÇ YALNIZCA BİR ETİKETİ DEĞİŞTİRİR. Tutara, duruma, tahsilata ve
 * kasaya dokunmaz; defterdeki hiçbir rakam etkilenmez.
 *
 * ⚠️ "Rozeti geri aç" bir müşteriyi YENİ YAPMAZ, yalnızca elle kapatmayı
 * kaldırır. Hesap (aynı isimle daha eski sipariş var mı) yine çalışır.
 */
const schema = z.object({ gizle: z.boolean() })

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input }) =>
    yeniMusteriRozetiniAyarla(id, input.gizle),
  )(req)
}
