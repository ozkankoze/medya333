import 'server-only'

import { balancesByAccount, profitOf, tlToUsdMinor, weeklyBuckets } from '@/lib/kasa/calc'
import type { CashCategory, CashDirection, CashMovement } from '@/lib/kasa/calc'
import { db } from '@/server/db'

/**
 * ⭐ KASA — SUNUCU KATMANI
 *
 * ⚠️ BU MODÜL SİPARİŞ SİSTEMİNE DOKUNMAZ. `Order`, `Payment`, `Fulfillment`
 * okunmaz ve yazılmaz. Defter tamamen elle beslenir (bkz. schema başlığı).
 *
 * ⚠️ YETKİ BURADA DEĞİL, UÇTA. Bu dosyadaki fonksiyonlar yetki kontrolü
 * YAPMAZ; çağıran uç `minimumRole: 'SUPERADMIN'` ile korunur. Kontrolü iki
 * yere dağıtmak, birinde unutulduğunda diğerinin koruduğu yanılsaması
 * yaratır. Tek kapı, uçtadır.
 */

/**
 * ⚠️ TARİH GÜN BAŞINA SABİTLENİR.
 *
 * Defter gün bazlıdır: "10 Ağustos'ta 1.100 ₺ girdi". Saat saklamak iki
 * soruna yol açardı — (1) sunucu UTC'de çalıştığı için Türkiye'de gece
 * 02:00'de girilen kayıt bir önceki güne düşerdi, (2) haftalık dağılım
 * ayın gününe baktığı için bu kayma satırı yanlış haftaya taşırdı.
 */
export function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Verilen ayın [başlangıç, bitiş) UTC sınırları. */
export function monthRange(year: number, month1: number): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.UTC(year, month1 - 1, 1)),
    lt: new Date(Date.UTC(year, month1, 1)),
  }
}

// ---------------------------------------------------------------------------
// OKUMA
// ---------------------------------------------------------------------------

export interface KasaAccountRow {
  id: string
  name: string
  owner: string
  openingBalanceMinor: number
  /** ⚠️ TÜRETİLMİŞ. Veritabanında böyle bir sütun yoktur. */
  balanceMinor: number
}

export interface KasaOverview {
  accounts: KasaAccountRow[]
  /** Sahip → hesapları ve toplamı (tablodaki "Özkan Köse" / "Ayhan Köse" blokları) */
  byOwner: Array<{ owner: string; accounts: KasaAccountRow[]; totalMinor: number }>
  grandTotalMinor: number

  month: { year: number; month: number }
  weeks: Array<{ week: number; revenueMinor: number; netMinor: number; usdMinor: number | null }>
  monthRevenueMinor: number
  monthNetMinor: number
  monthRevenueUsdMinor: number | null

  usdRateMinor: number

  receivables: Array<{
    id: string
    person: string
    amountMinor: number
    dueDate: Date | null
    note: string | null
    /** Arayüzdeki "İşlem" — ne için alacaklıyız. */
    description: string | null
  }>
  receivableTotalMinor: number

  upcoming: Array<{
    id: string
    creditor: string
    amountMinor: number
    remainingMinor: number | null
    dueDate: Date
    /** Arayüzdeki "İşlem" — ne için borçluyuz. */
    description: string | null
  }>
  upcomingTotalMinor: number
}

/**
 * Ana sayfa özeti.
 *
 * ⚠️ BAKİYE **TÜM** HAREKETLERDEN HESAPLANIR, seçili aydan değil.
 * "Hesapta ne kadar var?" sorusunun cevabı ayla sınırlanamaz; ağustosa
 * bakarken temmuzdaki parayı yok saymak bakiyeyi olduğundan düşük
 * gösterirdi. Ciro ve kâr ise SEÇİLİ AYA aittir. İki farklı zaman aralığı
 * bilinçlidir.
 */
export async function getKasaOverview(year: number, month1: number): Promise<KasaOverview> {
  const range = monthRange(year, month1)

  const [accounts, allEntries, monthEntries, setting, receivables, upcoming] = await Promise.all([
    db.cashAccount.findMany({
      where: { isActive: true },
      orderBy: [{ owner: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    // Bakiye için: tarih filtresi YOK (bkz. üst not).
    db.cashEntry.findMany({
      select: { accountId: true, direction: true, category: true, amountMinor: true, costMinor: true, occurredAt: true },
    }),
    db.cashEntry.findMany({
      where: { occurredAt: { gte: range.gte, lt: range.lt } },
      select: { accountId: true, direction: true, category: true, amountMinor: true, costMinor: true, occurredAt: true },
    }),
    db.kasaSetting.findUnique({ where: { id: 'singleton' } }),
    db.receivable.findMany({ where: { settledAt: null }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
    db.scheduledPayment.findMany({ where: { paidAt: null }, orderBy: { dueDate: 'asc' }, take: 20 }),
  ])

  const movements: CashMovement[] = allEntries.map((e) => ({
    accountId: e.accountId,
    occurredAt: e.occurredAt,
    direction: e.direction as CashDirection,
    category: e.category as CashCategory,
    amountMinor: e.amountMinor,
    costMinor: e.costMinor,
  }))
  const monthMovements: CashMovement[] = monthEntries.map((e) => ({
    accountId: e.accountId,
    occurredAt: e.occurredAt,
    direction: e.direction as CashDirection,
    category: e.category as CashCategory,
    amountMinor: e.amountMinor,
    costMinor: e.costMinor,
  }))

  const balances = balancesByAccount(accounts, movements)
  const rows: KasaAccountRow[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    owner: a.owner,
    openingBalanceMinor: a.openingBalanceMinor,
    balanceMinor: balances.get(a.id) ?? a.openingBalanceMinor,
  }))

  const byOwnerMap = new Map<string, KasaAccountRow[]>()
  for (const r of rows) {
    const list = byOwnerMap.get(r.owner) ?? []
    list.push(r)
    byOwnerMap.set(r.owner, list)
  }
  const byOwner = [...byOwnerMap.entries()].map(([owner, list]) => ({
    owner,
    accounts: list,
    totalMinor: list.reduce((n, r) => n + r.balanceMinor, 0),
  }))

  const usdRateMinor = setting?.usdRateMinor ?? 0
  const buckets = weeklyBuckets(monthMovements)
  const profit = profitOf(monthMovements)

  return {
    accounts: rows,
    byOwner,
    grandTotalMinor: rows.reduce((n, r) => n + r.balanceMinor, 0),

    month: { year, month: month1 },
    weeks: buckets.map((b) => ({ ...b, usdMinor: tlToUsdMinor(b.revenueMinor, usdRateMinor) })),
    monthRevenueMinor: profit.revenueMinor,
    monthNetMinor: profit.netMinor,
    monthRevenueUsdMinor: tlToUsdMinor(profit.revenueMinor, usdRateMinor),

    usdRateMinor,

    receivables: receivables.map((r) => ({
      id: r.id,
      person: r.person,
      amountMinor: r.amountMinor,
      dueDate: r.dueDate,
      note: r.note,
      description: r.description,
    })),
    receivableTotalMinor: receivables.reduce((n, r) => n + r.amountMinor, 0),

    upcoming: upcoming.map((p) => ({
      id: p.id,
      creditor: p.creditor,
      amountMinor: p.amountMinor,
      remainingMinor: p.remainingMinor,
      dueDate: p.dueDate,
      description: p.description,
    })),
    upcomingTotalMinor: upcoming.reduce((n, p) => n + p.amountMinor, 0),
  }
}

/** Bir ayın gün gün hareket dökümü — sipariş defteri ekranı. */
export async function listEntries(year: number, month1: number) {
  const range = monthRange(year, month1)
  const rows = await db.cashEntry.findMany({
    where: { occurredAt: { gte: range.gte, lt: range.lt } },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      account: { select: { name: true, owner: true } },
      /**
       * ⚠️ BAĞLILIK TEK SORGUDA ÇEKİLİR. Ekran her satır için "bu hareketin
       * tutarı düzenlenebilir mi?" sorusunu cevaplamak zorunda; satır başına
       * ayrı sorgu atmak, 200 hareketlik bir ayda 800 ek sorgu demekti.
       */
      packagePayment: { select: { id: true } },
      packageCost: { select: { id: true } },
      orderPayment: { select: { id: true } },
      orderCost: { select: { id: true } },
      receivableSettlement: { select: { id: true } },
      paymentSettlement: { select: { id: true } },
    },
  })

  return rows.map((e) => ({
    ...e,
    /**
     * Hangi kayda bağlı — yoksa `null`. Ekranda kilidin SEBEBİ olarak
     * yazılır; asıl engel veritabanı tetikleyicisindedir.
     */
    linkedTo:
      e.packagePayment || e.packageCost
        ? ('paket' as const)
        : e.orderPayment || e.orderCost
          ? ('sipariş' as const)
          : e.receivableSettlement
            ? ('alacak' as const)
            : e.paymentSettlement
              ? ('borç' as const)
              : null,
  }))
}

export async function listAccounts() {
  return db.cashAccount.findMany({
    where: { isActive: true },
    orderBy: [{ owner: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })
}

// ---------------------------------------------------------------------------
// YAZMA
// ---------------------------------------------------------------------------

export class KasaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'KasaError'
  }
}

export interface CreateEntryInput {
  accountId: string
  occurredAt: Date
  direction: CashDirection
  category: CashCategory
  amountMinor: number
  description: string
  customerHandle?: string | null
  costMinor?: number | null
  note?: string | null
  createdById?: string | null
}

/**
 * ⚠️ YÖN İLE KATEGORİ TUTARLI OLMALI.
 *
 * "GİDER ama para GİRİŞİ" gibi bir satır hem bakiyeyi hem kârı ters yönde
 * bozar ve tabloya bakan kimse fark etmez — rakam makul görünür, sadece
 * yanlıştır. Bu yüzden kombinasyon kaydetmeden önce reddedilir.
 */
const DIRECTION_OF: Record<CashCategory, CashDirection | 'ANY'> = {
  SATIS: 'IN',
  TAHSILAT: 'IN',
  TRANSFER_IN: 'IN',
  GIDER: 'OUT',
  MALIYET: 'OUT',
  BORC_ODEME: 'OUT',
  TRANSFER_OUT: 'OUT',
  DIGER: 'ANY',
}

export async function createEntry(input: CreateEntryInput) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new KasaError('AMOUNT_INVALID', 'Tutar sıfırdan büyük olmalıdır.')
  }
  if (input.costMinor != null && (!Number.isInteger(input.costMinor) || input.costMinor < 0)) {
    throw new KasaError('COST_INVALID', 'Maliyet negatif olamaz.')
  }

  const expected = DIRECTION_OF[input.category]
  if (expected !== 'ANY' && expected !== input.direction) {
    throw new KasaError(
      'DIRECTION_MISMATCH',
      `"${input.category}" kategorisi ${expected === 'IN' ? 'para girişi' : 'para çıkışı'} olmalıdır.`,
    )
  }

  /**
   * ⚠️ MALİYET YALNIZCA SATIŞ SATIRINDA ANLAMLIDIR. Bir gider satırına
   * maliyet yazmak kâr hesabında aynı parayı iki kez düşerdi.
   */
  if (input.costMinor != null && input.category !== 'SATIS') {
    throw new KasaError('COST_NOT_ALLOWED', 'Maliyet yalnızca satış satırında girilebilir.')
  }

  const account = await db.cashAccount.findUnique({ where: { id: input.accountId } })
  if (!account || !account.isActive) {
    throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesap bulunamadı veya kullanım dışı.', 404)
  }

  return db.cashEntry.create({
    data: {
      accountId: input.accountId,
      occurredAt: dayStartUtc(input.occurredAt),
      direction: input.direction,
      category: input.category,
      amountMinor: input.amountMinor,
      description: input.description.trim(),
      customerHandle: input.customerHandle?.trim() || null,
      costMinor: input.costMinor ?? null,
      note: input.note?.trim() || null,
      createdById: input.createdById ?? null,
    },
  })
}

/**
 * Hesaplar arası transfer — İKİ SATIR, TEK İŞLEM.
 *
 * ⚠️ TRANSACTION ZORUNLU. Tek satır yazılıp diğeri yazılamazsa para
 * havada kalır: bir hesaptan çıkmış, hiçbirine girmemiş görünür ve
 * toplam servet sessizce azalır. İkisi ya birlikte olur ya hiç olmaz.
 */
export async function createTransfer(params: {
  fromAccountId: string
  toAccountId: string
  occurredAt: Date
  amountMinor: number
  description: string
  createdById?: string | null
}) {
  if (params.fromAccountId === params.toAccountId) {
    throw new KasaError('SAME_ACCOUNT', 'Aynı hesaba transfer yapılamaz.')
  }
  if (!Number.isInteger(params.amountMinor) || params.amountMinor <= 0) {
    throw new KasaError('AMOUNT_INVALID', 'Tutar sıfırdan büyük olmalıdır.')
  }

  const groupId = crypto.randomUUID()
  const at = dayStartUtc(params.occurredAt)

  return db.$transaction(async (tx) => {
    const accounts = await tx.cashAccount.findMany({
      where: { id: { in: [params.fromAccountId, params.toAccountId] }, isActive: true },
    })
    if (accounts.length !== 2) {
      throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesaplardan biri bulunamadı.', 404)
    }

    const common = {
      occurredAt: at,
      amountMinor: params.amountMinor,
      description: params.description.trim(),
      transferGroupId: groupId,
      createdById: params.createdById ?? null,
    }
    await tx.cashEntry.create({
      data: { ...common, accountId: params.fromAccountId, direction: 'OUT', category: 'TRANSFER_OUT' },
    })
    await tx.cashEntry.create({
      data: { ...common, accountId: params.toAccountId, direction: 'IN', category: 'TRANSFER_IN' },
    })
    return { transferGroupId: groupId }
  })
}

/**
 * ⚠️ `settleReceivable` BURADAN TAŞINDI → `src/server/kasa/pending.ts`.
 *
 * Eski hâli her tahsilata sabit `TAHSILAT` kategorisi yazıyordu. Bu, satışı
 * zaten ciroya girmiş alacaklar için doğruydu; ama "Hareket ekle" formundan
 * ödenmemiş olarak giren SATIŞLAR için yanlıştır — o satış ciroda HİÇ
 * görünmezdi. Yeni sürüm kategoriyi kaydın kendisinden okur.
 *
 * ⚠️ İKİ AYNI İSİMLİ FONKSİYON BIRAKILMADI. Biri kullanılırken diğeri
 * güncellenmeden kalır ve hangisinin çalıştığı çağrı yerine göre değişirdi.
 */

