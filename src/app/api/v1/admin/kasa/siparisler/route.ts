import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../_handler'
import { apiError } from '@/server/http'
import { KasaError } from '@/server/kasa'
import { cozumleOdeme, createOrder, uygulaOdeme } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/kasa/siparisler — elle sipariş kaydı ekler
 *
 * ⚠️ MİNİMUM ROL **SUPERADMIN** (kasa modülünün tamamı gibi). Banka
 * bakiyesi ve kâr verisi ADMIN'e bile açılmaz.
 *
 * ⚠️ BU UÇ SİTEDEKİ `Order` TABLOSUNA DOKUNMAZ. Gerçek müşteri siparişi
 * oluşturmaz, mevcut hiçbir siparişi değiştirmez. Yalnızca işletmenin
 * kendi defterine (`ManualOrder`) satır yazar.
 *
 * ⚠️ BU UÇ KASAYA DA DOKUNMAZ. Hiçbir `CashEntry` üretmez, hiçbir bakiye
 * değişmez. Gelir hareketi yalnızca `/tahsil` ucuyla oluşur.
 */
const schema = z.object({
  customerName: z.string().min(1).max(200),
  /**
   * ⚠️ ZORUNLU — arayüzde "Sipariş içeriği".
   * `.optional()` YAPILMAMALI: alan isteğe bağlı olsaydı pratikte çoğu satır
   * boş kalır ve defter birkaç hafta sonra okunamaz hâle gelirdi. Sınır 300
   * karakter: bir satırlık açıklama için fazlasıyla yeterli, tabloyu bozacak
   * kadar uzun değil.
   */
  description: z.string().min(1).max(300),
  occurredAt: z.string().min(8),
  salePriceMinor: z.number().int().nonnegative(),
  costMinor: z.number().int().nonnegative(),
  status: z.enum(['BEKLIYOR', 'DEVAM_EDIYOR', 'TAMAMLANDI', 'IPTAL']).optional(),
  /**
   * ⚠️ TEK KUTU, İKİ ANLAM — tabloda "Ödeme".
   *   "12.09.2026" → para beklenİyor, o gün alacak olarak görünür
   *   "yapıkredi"  → para geldi, o hesaba gelir yazılır
   * Ayrım `odemeCozumle` içinde kesin kurallara bağlı; burada serbest
   * metindir çünkü kullanıcı ikisinden birini yazar.
   */
  odeme: z.string().max(60).optional(),
})

export async function POST(req: NextRequest) {
  return adminHandler({ schema, minimumRole: 'SUPERADMIN' }, async ({ input, user }) => {
    const at = new Date(input.occurredAt)
    if (Number.isNaN(at.getTime())) return apiError('DATE_INVALID', 'Geçersiz tarih.', 400)
    try {
      const order = await createOrder({
        customerName: input.customerName,
        description: input.description,
        occurredAt: at,
        salePriceMinor: input.salePriceMinor,
        costMinor: input.costMinor,
        status: input.status,
        createdById: user.id,
      })
      /**
       * ⚠️ ÖDEME KUTUSU SİPARİŞ YAZILDIKTAN SONRA UYGULANIR ve hatası
       * AYRI raporlanır. Aynı işleme sokulsaydı, tanınmayan bir hesap adı
       * yüzünden doğru girilmiş sipariş de kaybolurdu — kullanıcı satırı
       * baştan yazmak zorunda kalırdı.
       */
      let odeme: Awaited<ReturnType<typeof uygulaOdeme>> | null = null
      let odemeHatasi: string | null = null
      if (input.odeme?.trim()) {
        try {
          odeme = await uygulaOdeme({
            orderId: order.id,
            girdi: await cozumleOdeme(input.odeme),
            bugun: new Date(),
            createdById: user.id,
          })
        } catch (err) {
          if (err instanceof KasaError) odemeHatasi = err.message
          else throw err
        }
      }

      return { id: order.id, odeme, odemeHatasi }
    } catch (err) {
      if (err instanceof KasaError) return apiError(err.code, err.message, err.status)
      throw err
    }
  })(req)
}
