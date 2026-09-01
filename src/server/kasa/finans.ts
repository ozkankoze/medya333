import 'server-only'

import { profitOf, type CashCategory, type CashDirection, type CashMovement } from '@/lib/kasa/calc'
import { db } from '@/server/db'
import { monthRange } from '@/server/kasa'

/**
 * ⭐ GELİR – GİDER EKRANININ VERİSİ
 *
 * ⚠️⚠️ BU EKRAN İKİ FARKLI SAYI GÖSTERİR VE İKİSİ AYNI ŞEY DEĞİLDİR:
 *
 *   KASA AKIŞI (giren − çıkan) → bu ay hesaplara ne girdi, ne çıktı.
 *                                "Param arttı mı?" sorusunu cevaplar.
 *   NET KÂR (ciro − maliyet − gider) → iş para kazandırıyor mu.
 *                                "Devam etmeli miyim?" sorusunu cevaplar.
 *
 * Bir ay bankada para birikmiş olabilir çünkü eski bir alacak tahsil
 * edilmiştir — bu kâr değildir. Ya da para azalmış olabilir çünkü kredi
 * kapatılmıştır — bu zarar değildir. İkisini tek bir "net" altında
 * birleştirmek, bu ayrımı görünmez kılar ve yanlış iş kararı ürettirir.
 * Bu yüzden ayrı hesaplanır ve ekranda ayrı gösterilir.
 */

/**
 * ⚠️ HANGİ KATEGORİLER AKIŞA GİRMEZ:
 *
 *   TRANSFER_*  → kendi hesapların arasında para taşımak. Ne gelirdir ne
 *                 gider; iki hesabın bakiyesini değiştirir, o kadar.
 *                 Sayılsaydı 10.000 TL'yi bir hesaptan diğerine almak,
 *                 ayın gelirini de giderini de 10.000 TL şişirirdi.
 *   DUZELTME    → sayım farkı. Gerçek bir para hareketi değil, defteri
 *                 gerçeğe eşitleyen bir kayıt.
 */
const AKISA_GIRMEZ = new Set<CashCategory>(['TRANSFER_IN', 'TRANSFER_OUT', 'DUZELTME'])

export interface FinansRow {
  id: string
  occurredAt: Date
  direction: CashDirection
  category: CashCategory
  amountMinor: number
  description: string
  accountName: string
  note: string | null
  /** Bir pakete/siparişe/alacağa bağlıysa dolu — o satır serbestçe silinemez. */
  linkedTo: 'paket' | 'sipariş' | 'alacak' | 'borç' | null
}

export async function getFinance(year: number, month1: number) {
  const range = monthRange(year, month1)

  const rows = await db.cashEntry.findMany({
    where: { occurredAt: { gte: range.gte, lt: range.lt } },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      account: { select: { name: true } },
      // ⚠️ Bağlılık TEK SORGUDA — satır başına ayrı sorgu, 200 hareketlik
      //    bir ayda 1.200 ek gidiş-geliş demekti.
      packagePayment: { select: { id: true } },
      packageCost: { select: { id: true } },
      orderPayment: { select: { id: true } },
      orderCost: { select: { id: true } },
      receivableSettlement: { select: { id: true } },
      paymentSettlement: { select: { id: true } },
    },
  })

  const list: FinansRow[] = rows.map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt,
    direction: e.direction as CashDirection,
    category: e.category as CashCategory,
    amountMinor: e.amountMinor,
    description: e.description,
    accountName: e.account.name,
    note: e.note,
    linkedTo:
      e.packagePayment || e.packageCost
        ? 'paket'
        : e.orderPayment || e.orderCost
          ? 'sipariş'
          : e.receivableSettlement
            ? 'alacak'
            : e.paymentSettlement
              ? 'borç'
              : null,
  }))

  let girenMinor = 0
  let cikanMinor = 0
  /** Gider kategorilerinin kendi içinde dağılımı — "para nereye gitti?" */
  const giderDagilimi = new Map<CashCategory, number>()

  for (const r of list) {
    if (AKISA_GIRMEZ.has(r.category)) continue
    if (r.direction === 'IN') {
      girenMinor += r.amountMinor
    } else {
      cikanMinor += r.amountMinor
      giderDagilimi.set(r.category, (giderDagilimi.get(r.category) ?? 0) + r.amountMinor)
    }
  }

  const movements: CashMovement[] = rows.map((e) => ({
    accountId: e.accountId,
    occurredAt: e.occurredAt,
    direction: e.direction as CashDirection,
    category: e.category as CashCategory,
    amountMinor: e.amountMinor,
    costMinor: e.costMinor,
  }))

  return {
    rows: list,
    girenMinor,
    cikanMinor,
    /** ⚠️ KASA AKIŞI — kâr DEĞİL. */
    akisMinor: girenMinor - cikanMinor,
    /** ⚠️ NET KÂR — kasa akışı DEĞİL. */
    profit: profitOf(movements),
    giderDagilimi: [...giderDagilimi.entries()]
      .map(([category, amountMinor]) => ({ category, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
  }
}
