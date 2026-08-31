import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { createReceivable, createScheduledPayment } from '@/server/kasa/pending'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/alacaklar — ÖDENMEMİŞ hareket kaydı
 *
 * ⚠️⚠️ BU UÇ HİÇBİR `CashEntry` OLUŞTURMAZ ve banka bakiyesine DOKUNMAZ.
 * "Hareket ekle" formundaki ödeme durumu kutusu işaretli değilse istek
 * buraya gelir. Para henüz hareket etmediği için deftere hareket yazmak
 * yanlış olurdu; kayıt alacak (giriş) veya borç (çıkış) olarak durur.
 *
 * Gerçek hareket `/alacaklar/{id}/tahsil` veya `/borclar/{id}/ode` ile
 * oluşur ve bakiye o an değişir.
 *
 * ⚠️ YÖN TABLOYU BELİRLER — tek uç, iki hedef. Ayrı iki uç yapmak
 * istemciye "hangisini çağıracağım?" kararını yükler ve o karar zaten
 * kategoriden türetilebiliyor.
 */
const schema = z.object({
  person: z.string().min(1).max(200),
  amountMinor: z.number().int().positive(),
  description: z.string().max(500).optional().nullable(),
  /** Beklenen tarih — çıkış (borç) için zorunlu. */
  dueDate: z.string().min(8).optional().nullable(),
  costMinor: z.number().int().nonnegative().optional().nullable(),
  direction: z.enum(['IN', 'OUT']),
  settleCategory: z.enum([
    'SATIS',
    'TAHSILAT',
    'GIDER',
    'MALIYET',
    'BORC_ODEME',
    'DIGER',
  ]),
})

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input }) => {
    let due: Date | null = null
    if (input.dueDate) {
      due = new Date(input.dueDate)
      if (Number.isNaN(due.getTime())) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    }
    try {
      const common = {
        person: input.person,
        amountMinor: input.amountMinor,
        description: input.description ?? null,
        dueDate: due,
        costMinor: input.costMinor ?? null,
        settleCategory: input.settleCategory,
      }
      const row =
        input.direction === 'IN'
          ? await createReceivable(common)
          : await createScheduledPayment(common)
      return { id: row.id, kind: input.direction === 'IN' ? 'alacak' : 'borc' }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
