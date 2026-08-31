import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { createTransfer, KasaError } from '@/server/kasa'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/transfers — hesaplar arası para taşıma
 *
 * ⚠️ MİNİMUM ROL **SUPERADMIN** (bkz. entries ucundaki gerekçe).
 *
 * ⚠️ İKİ SATIR TEK İŞLEMDE yazılır. Biri yazılıp diğeri yazılamazsa para
 * havada kalırdı: bir hesaptan çıkmış, hiçbirine girmemiş görünürdü ve
 * toplam servet sessizce azalırdı. Sözleşme servis katmanında transaction
 * ile garanti altına alınmıştır.
 */
const schema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  occurredAt: z.string().min(8),
  amountMinor: z.number().int().positive(),
  description: z.string().min(1).max(500),
})

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    const occurredAt = new Date(input.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) {
      return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    }
    try {
      return await createTransfer({ ...input, occurredAt, createdById: user.id })
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
