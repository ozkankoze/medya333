import type { NextRequest } from 'next/server'
import { adminHandler } from '../../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { cancelPackage } from '@/server/kasa/packages'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/kasa/paketler/{id}/iptal
 *
 * ⚠️ KAYIT SİLİNMEZ, yalnızca `canceledAt` doldurulur. Geçmiş kaybolmamalı;
 * iptal edilen iş de bir bilgidir ve "yenilenmeyen müşteri" analizinde rol
 * oynar.
 *
 * ⚠️ TAHSİL EDİLMİŞ BİR PAKET İPTAL EDİLİRSE kasa hareketi kendiliğinden
 * silinmez. Para gerçekten geldiyse geri ödeme ayrı bir harekettir —
 * kaydı sessizce yok etmek, bankada duran parayı defterde yok saymak olurdu.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'SUPERADMIN' }, async () => {
    try {
      const pkg = await cancelPackage(id)
      return { id: pkg.id, canceledAt: pkg.canceledAt }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
