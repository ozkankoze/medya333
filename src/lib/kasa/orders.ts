/**
 * ⭐ ELLE GİRİLEN GÜNLÜK SİPARİŞ DEFTERİ — SAF MANTIK
 *
 * ⚠️⚠️ BU MODÜL SİTEDEKİ SİPARİŞLERLE İLGİLİ DEĞİLDİR.
 *
 * Gerçek müşteri siparişi `Order` tablosundadır: ödeme akışı üretir,
 * denetim izi taşır, silinemez ve `/yonetim/fulfillment` altında yönetilir.
 * Buradaki kayıtlar işletmenin kendi defteridir — elle girilir, elle
 * silinir, yalnızca SUPERADMIN görür.
 *
 * Aynı ekranda birleştirmek istenmedi ve doğrusu buydu: gerçek bir
 * siparişte "maliyet" alanı yoktur ve silinebilir bir defteri müşteri
 * kayıtlarıyla karıştırmak, bir gün yanlış satırın silinmesiyle biterdi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ İKİ AYRI DURUM VARDIR VE BİRBİRİNE KARIŞTIRILMAZ:
 *
 *   İŞ DURUMU    → `status` (bekliyor / devam ediyor / tamamlandı / iptal)
 *   ÖDEME DURUMU → `paidAt` dolu mu, değil mi
 *
 * Sitedeki `OrderStatus` ikisini tek listede topluyor ("Ödeme Bekleniyor",
 * "Ödeme Alındı", "Tamamlandı"…). Burada öyle yapılmadı, çünkü tamamlanmış
 * ama tahsil edilmemiş bir sipariş bu defterde OLAĞAN bir durumdur ve tek
 * bir alanla ifade edilemez. Tek alan olsaydı, "Tamamlandı" seçildiğinde
 * paranın gelip gelmediği bilinemezdi.
 */

export type ManualOrderStatus = 'BEKLIYOR' | 'DEVAM_EDIYOR' | 'TAMAMLANDI' | 'IPTAL'

export const ORDER_STATUS_LABEL: Record<ManualOrderStatus, string> = {
  BEKLIYOR: 'Bekliyor',
  DEVAM_EDIYOR: 'Devam ediyor',
  TAMAMLANDI: 'Tamamlandı',
  IPTAL: 'İptal',
}

/** Formdaki sıralama — ekranda da bu sırayla görünür. */
export const ORDER_STATUSES: readonly ManualOrderStatus[] = [
  'BEKLIYOR',
  'DEVAM_EDIYOR',
  'TAMAMLANDI',
  'IPTAL',
]

export interface OrderLike {
  occurredAt: Date
  salePriceMinor: number
  costMinor: number
  status: ManualOrderStatus
  paidAt: Date | null
}

/**
 * ⚠️ NET KÂR SAKLANMAZ, HESAPLANIR.
 * Saklansaydı satış veya maliyet düzeltildiğinde güncellenmeyi unutabilir
 * ve üç alan birbiriyle çelişirdi.
 */
export function netProfitMinor(o: Pick<OrderLike, 'salePriceMinor' | 'costMinor'>): number {
  return o.salePriceMinor - o.costMinor
}

export type PaymentState = 'ODENDI' | 'BEKLIYOR'

/**
 * ⚠️ ÖDEME DURUMU DA SAKLANMAZ. `paidAt` doludur ya da değildir. Ayrı bir
 * `isPaid` bayrağı + tarih tutmak er geç ayrışır: bayrak true kalır, tarih
 * boşalır ve hangisinin doğru olduğu bilinemez.
 */
export function paymentStateOf(o: Pick<OrderLike, 'paidAt'>): PaymentState {
  return o.paidAt ? 'ODENDI' : 'BEKLIYOR'
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  ODENDI: 'Tahsil edildi',
  BEKLIYOR: 'Tahsil edilmedi',
}

/** Gün başına indirger — saat farkı ay kararını değiştirmemeli. */
function day(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export interface OrderSummary {
  /** Seçili ayda GİRİLEN sipariş adedi (iptaller dahil — kaç satır var) */
  monthCount: number
  monthSaleMinor: number
  monthCostMinor: number
  monthNetMinor: number
  /** Seçili ayda tahsil EDİLMEMİŞ satış toplamı — "ne kadar param dışarıda?" */
  monthUnpaidMinor: number
  /** İptal edilmiş satır sayısı (tutarları toplamlara girmez) */
  monthCanceledCount: number
}

/**
 * ⚠️ AYLIK TOPLAMLAR SİPARİŞİN TARİHİNE GÖRE HESAPLANIR — tahsil tarihine
 * göre değil. İki farklı soru vardır ve bu ekran birincisini yanıtlar:
 *
 *   "Bu ay ne kadar iş yaptım?"   → sipariş tarihi (BURASI)
 *   "Bu ay kasaya ne kadar girdi?" → tahsil tarihi (Kasa sekmesi)
 *
 * İkisini karıştırmak, geçen ayın işini bu ayın cirosu gibi göstermeye yol
 * açardı. Kasa sekmesindeki rakamla bu sayfa bilerek FARKLI olabilir ve
 * başlıklarda hangi aralığın geçerli olduğu yazılıdır.
 *
 * ⚠️ İPTAL EDİLEN SİPARİŞ CİROYA GİRMEZ. Girseydi, yapılmayan işin parası
 * kazanılmış gibi görünürdü. Satır sayısında ayrıca gösterilir ki iptaller
 * gözden kaybolmasın.
 */
export function summarizeOrders(
  orders: readonly OrderLike[],
  month: { year: number; month1: number },
): OrderSummary {
  const monthStart = Date.UTC(month.year, month.month1 - 1, 1)
  const monthEnd = Date.UTC(month.year, month.month1, 1)

  let monthCount = 0
  let monthSaleMinor = 0
  let monthCostMinor = 0
  let monthUnpaidMinor = 0
  let monthCanceledCount = 0

  for (const o of orders) {
    const d = day(o.occurredAt)
    if (d < monthStart || d >= monthEnd) continue

    monthCount += 1

    if (o.status === 'IPTAL') {
      monthCanceledCount += 1
      continue
    }

    monthSaleMinor += o.salePriceMinor
    monthCostMinor += o.costMinor
    if (!o.paidAt) monthUnpaidMinor += o.salePriceMinor
  }

  return {
    monthCount,
    monthSaleMinor,
    monthCostMinor,
    monthNetMinor: monthSaleMinor - monthCostMinor,
    monthUnpaidMinor,
    monthCanceledCount,
  }
}
