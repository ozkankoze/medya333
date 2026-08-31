import type { NextRequest } from 'next/server'
import { adminHandler } from '../../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { deleteOrder } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * DELETE /api/v1/admin/kasa/siparisler/{id} — defterden satır siler
 *
 * ⚠️ GERÇEK SİLME. Yanlış girilen bir satır defterde kalmamalı, bu yüzden
 * kayıt işaretlenmez, silinir.
 *
 * ⚠️ KASAYA HAREKET YAZILMIŞSA REDDEDİLİR. Gelir veya gider hareketi
 * oluşmuş bir siparişi silmek o parayı ÖKSÜZ bırakırdı: hareket defterde
 * durur, hangi işe ait olduğu bir daha bilinemez ve bakiye açıklanamaz
 * hâle gelirdi.
 *
 * ⚠️ ASIL ENGEL BU UÇTA DEĞİL, VERİTABANI TETİKLEYİCİSİNDE. Buradaki
 * kontrol yalnızca anlaşılır bir mesaj vermek içindir — uygulama katmanı
 * atlanabilir (elle SQL, ileride bir script), tetikleyici atlanamaz.
 *
 * ⚠️ SİTEDEKİ GERÇEK SİPARİŞLER BU UÇLA SİLİNEMEZ. Bu uç yalnızca
 * `ManualOrder` tablosunu tanır; `Order` tablosuna hiç bakmaz.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return adminHandler({ minimumRole: 'SUPERADMIN' }, async () => {
    try {
      return await deleteOrder(id)
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
