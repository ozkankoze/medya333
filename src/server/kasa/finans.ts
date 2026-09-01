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

export interface IsSatiri {
  id: string
  kaynak: 'sipariş' | 'paket'
  tarih: Date
  kisi: string
  islem: string
  saleMinor: number
  costMinor: number
  netMinor: number
  /** Tahsil edildiyse hesap adı + tarih; edilmediyse null. */
  tahsilat: { accountName: string | null; at: Date } | null
  /** Beklenen ödeme günü (yalnızca siparişte, tahsil edilmemişse). */
  dueDate: Date | null
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

  /**
   * ⚠️⚠️ BU AYIN İŞLERİ, PARA HAREKETLERİNDEN AYRI HESAPLANIR.
   *
   * Sipariş girmek kasaya dokunmaz; para ancak tahsil edilince girer. Bu
   * yüzden "bu ay ne kadar iş yaptım?" ile "bu ay kasaya ne girdi?"
   * farklı sayılardır ve ekranda ayrı bloklarda gösterilir.
   *
   * ⚠️ İKİSİ TOPLANMAZ. Toplansaydı, tahsil edilen bir sipariş HEM iş
   * cirosunda HEM kasa girişinde sayılır — yani aynı satış iki kez
   * görünürdü.
   */
  const [orders, packages] = await Promise.all([
    db.manualOrder.findMany({
      where: { occurredAt: { gte: range.gte, lt: range.lt }, status: { not: 'IPTAL' } },
      orderBy: [{ occurredAt: 'desc' }],
      include: { paymentEntry: { select: { account: { select: { name: true } } } } },
    }),
    // ⚠️ Paketler AYDA BAŞLAYANA göre — paket sayfasındaki özetle aynı kural.
    db.servicePackage.findMany({
      where: { startDate: { gte: range.gte, lt: range.lt }, canceledAt: null },
      orderBy: [{ startDate: 'desc' }],
      include: { paymentEntry: { select: { account: { select: { name: true } } } } },
    }),
  ])

  const isler: IsSatiri[] = [
    ...orders.map((o) => ({
      id: o.id,
      kaynak: 'sipariş' as const,
      tarih: o.occurredAt,
      kisi: o.customerName,
      islem: o.description,
      saleMinor: o.salePriceMinor,
      costMinor: o.costMinor,
      netMinor: o.salePriceMinor - o.costMinor,
      tahsilat: o.paidAt
        ? { accountName: o.paymentEntry?.account.name ?? null, at: o.paidAt }
        : null,
      dueDate: o.paidAt ? null : o.dueDate,
    })),
    ...packages.map((p) => ({
      id: p.id,
      kaynak: 'paket' as const,
      tarih: p.startDate,
      kisi: p.customerName,
      islem: p.serviceName,
      saleMinor: p.salePriceMinor,
      costMinor: p.costMinor,
      netMinor: p.salePriceMinor - p.costMinor,
      tahsilat: p.paidAt
        ? { accountName: p.paymentEntry?.account.name ?? null, at: p.paidAt }
        : null,
      dueDate: null,
    })),
  ].sort((a, b) => b.tarih.getTime() - a.tarih.getTime())

  const isCiroMinor = isler.reduce((n, i) => n + i.saleMinor, 0)
  const isMaliyetMinor = isler.reduce((n, i) => n + i.costMinor, 0)
  /**
   * ⚠️ TAHSİL EDİLMEYEN TUTAR AYRI GÖSTERİLİR. Ciroya bakıp "bu para
   * bende" sanmak, bu ekranda yapılabilecek en pahalı yanlış okumadır.
   */
  const tahsilEdilmeyenMinor = isler
    .filter((i) => i.tahsilat === null)
    .reduce((n, i) => n + i.saleMinor, 0)

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
    isler,
    isCiroMinor,
    isMaliyetMinor,
    isNetMinor: isCiroMinor - isMaliyetMinor,
    tahsilEdilmeyenMinor,
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
