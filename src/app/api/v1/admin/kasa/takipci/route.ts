import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { takipciEkle } from '@/server/kasa/takipci'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/takipci — takip listesine satır ekler
 *
 * ⚠️ MİNİMUM ROL SUPERADMIN — kasa modülünün tamamındaki kural.
 *
 * ⚠️ BU UÇ PARAYLA İLGİLİ HİÇBİR ŞEYE DOKUNMAZ: ne `ManualOrder` ne
 * `CashEntry`. Yalnızca takip listesine satır yazar.
 */
const schema = z.object({
  username: z.string().min(1).max(120),
  /** Bitiş sayısı ADETTİR, kuruş değil. */
  endCount: z.number().int().nonnegative().max(100_000_000),
  note: z.string().max(300).optional().nullable(),
})

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    try {
      return await takipciEkle({ ...input, createdById: user.id })
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
