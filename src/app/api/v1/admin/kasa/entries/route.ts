import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { createEntry, KasaError } from '@/server/kasa'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/entries — deftere hareket ekler
 *
 * ⚠️ MİNİMUM ROL **SUPERADMIN**, ADMIN DEĞİL.
 * Bu uç banka bakiyelerini, borçları ve alacakları taşır; operatör veya
 * yönetici rolündeki bir hesabın finans defterine yazabilmesi için hiçbir
 * sebep yok. Kapı, ihtiyaç duyulan en dar yerde durur.
 *
 * ⚠️ TUTAR KURUŞ CİNSİNDEN TAM SAYI OLARAK ALINIR. İstemciden "1234.56"
 * gibi ondalıklı bir sayı kabul edilseydi, kayan nokta yuvarlaması
 * yüzünden 1 kuruşluk sapmalar birikirdi. Çevrim istemcide yapılır ve
 * sunucu yalnızca tam sayı kabul eder.
 */
const schema = z.object({
  accountId: z.string().min(1),
  /** ISO tarih — saat kısmı yok sayılır, gün başına sabitlenir. */
  occurredAt: z.string().min(8),
  direction: z.enum(['IN', 'OUT']),
  category: z.enum([
    'SATIS',
    'TAHSILAT',
    'GIDER',
    'MALIYET',
    'BORC_ODEME',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'DIGER',
  ]),
  amountMinor: z.number().int().positive(),
  description: z.string().min(1).max(500),
  customerHandle: z.string().max(200).optional().nullable(),
  costMinor: z.number().int().nonnegative().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
})

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    const occurredAt = new Date(input.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) {
      return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    }
    try {
      const entry = await createEntry({
        accountId: input.accountId,
        occurredAt,
        direction: input.direction,
        category: input.category,
        amountMinor: input.amountMinor,
        description: input.description,
        customerHandle: input.customerHandle ?? null,
        costMinor: input.costMinor ?? null,
        note: input.note ?? null,
        createdById: user.id,
      })
      return { id: entry.id }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
