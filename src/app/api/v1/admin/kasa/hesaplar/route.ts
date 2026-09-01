import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { adjustAccountBalance, createAccount } from '@/server/kasa/panel'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/hesaplar — hesap açar VEYA bakiyeyi düzeltir
 *
 * ⚠️⚠️ BAKİYE DOĞRUDAN YAZILMAZ. Bakiye saklanmıyor; açılış bakiyesi artı
 * hareketlerden hesaplanıyor. "Bakiye şu olsun" dendiğinde aradaki FARK
 * kadar bir DÜZELTME hareketi yazılır. Bakiye istenen sayıya gelir ve
 * defterde her kuruşun karşılığında bir satır kalır — üç ay sonra
 * "bu fark nereden çıktı?" sorusunun cevabı görünür olur.
 *
 * ⚠️ MİNİMUM ROL SUPERADMIN. Bakiye düzeltmesi, defterin en hassas
 * yetkisidir: yanlış kullanıldığında hiçbir hata üretmeden rakamları
 * değiştirir.
 */
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('duzelt'),
    accountId: z.string().min(1),
    targetMinor: z.number().int(),
    note: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('ekle'),
    owner: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    openingBalanceMinor: z.number().int(),
  }),
])

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    try {
      if (input.kind === 'ekle') {
        const account = await createAccount({
          owner: input.owner,
          name: input.name,
          openingBalanceMinor: input.openingBalanceMinor,
        })
        return { id: account.id }
      }

      const result = await adjustAccountBalance({
        accountId: input.accountId,
        targetMinor: input.targetMinor,
        occurredAt: new Date(),
        note: input.note ?? null,
        createdById: user.id,
      })
      return result
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
