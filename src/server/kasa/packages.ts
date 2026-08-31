import 'server-only'

import { derivePackageState, netProfitMinor, retention, summarize } from '@/lib/kasa/packages'
import type { PackageState } from '@/lib/kasa/packages'
import { db } from '@/server/db'
import { dayStartUtc, KasaError } from '@/server/kasa'

/**
 * ⭐ AYLIK MÜŞTERİ PAKETLERİ — SUNUCU KATMANI
 *
 * ⚠️ HİÇBİR OTOMATİK DAVRANIŞ YOKTUR ve eklenmemelidir:
 *   · zamanlanmış iş yok — durumlar tarihten türetilir
 *   · otomatik yenileme yok — yenileme elle açılan yeni kayıttır
 *   · otomatik tahakkuk yok — paket açmak kasaya dokunmaz
 *
 * ⚠️ YETKİ BURADA DEĞİL, UÇTA (`minimumRole: 'SUPERADMIN'`). Kontrolü iki
 * yere dağıtmak, birinde unutulduğunda diğerinin koruduğu yanılsaması
 * yaratır.
 */

export interface PackageRow {
  id: string
  customerName: string
  serviceName: string
  startDate: Date
  endDate: Date
  salePriceMinor: number
  costMinor: number
  /** ⚠️ SAKLANMAZ — hesaplanır. */
  netMinor: number
  /** ⚠️ SAKLANMAZ — tarihlerden türetilir. */
  state: PackageState
  paidAt: Date | null
  paymentEntryId: string | null
  costEntryId: string | null
  note: string | null
}

function toRow(p: {
  id: string
  customerName: string
  serviceName: string
  startDate: Date
  endDate: Date
  salePriceMinor: number
  costMinor: number
  paidAt: Date | null
  canceledAt: Date | null
  paymentEntryId: string | null
  costEntryId: string | null
  note: string | null
}, today: Date): PackageRow {
  return {
    id: p.id,
    customerName: p.customerName,
    serviceName: p.serviceName,
    startDate: p.startDate,
    endDate: p.endDate,
    salePriceMinor: p.salePriceMinor,
    costMinor: p.costMinor,
    netMinor: netProfitMinor(p),
    state: derivePackageState(p, today),
    paidAt: p.paidAt,
    paymentEntryId: p.paymentEntryId,
    costEntryId: p.costEntryId,
    note: p.note,
  }
}

export async function getPackages(year: number, month1: number, today = new Date()) {
  const all = await db.servicePackage.findMany({ orderBy: [{ startDate: 'desc' }] })

  const rows = all.map((p) => toRow(p, today))
  const summary = summarize(all, today, { year, month1 })
  const retentionRows = retention(all, today)

  return {
    rows,
    summary,
    retention: retentionRows,
    /** Uyarı listeleri — dashboard'da ayrı gösterilir. */
    endingSoon: rows.filter((r) => r.state === 'BITIYOR'),
    expired: rows.filter((r) => r.state === 'SURESI_DOLDU'),
    renewed: retentionRows.filter((r) => r.renewed),
    notRenewed: retentionRows.filter((r) => !r.renewed),
  }
}

// ---------------------------------------------------------------------------

export interface CreatePackageInput {
  customerName: string
  serviceName: string
  startDate: Date
  endDate: Date
  salePriceMinor: number
  costMinor: number
  note?: string | null
  createdById?: string | null
}

/**
 * ⚠️ PAKET AÇMAK KASAYA DOKUNMAZ.
 *
 * Hiçbir `CashEntry` oluşturulmaz, hiçbir banka bakiyesi değişmez. Paket
 * bir SATIŞ SÖZÜDÜR; para henüz gelmemiştir. Açılışta gelir yazılsaydı
 * bakiye, tahsil edilmemiş parayı içerir ve "ödeyebilir miyim?" sorusuna
 * yanlış cevap verirdi.
 *
 * Gelir hareketi yalnızca `collectPayment` ile oluşur.
 */
export async function createPackage(input: CreatePackageInput) {
  if (!Number.isInteger(input.salePriceMinor) || input.salePriceMinor < 0) {
    throw new KasaError('SALE_INVALID', 'Satış tutarı negatif olamaz.')
  }
  if (!Number.isInteger(input.costMinor) || input.costMinor < 0) {
    throw new KasaError('COST_INVALID', 'Maliyet negatif olamaz.')
  }

  const start = dayStartUtc(input.startDate)
  const end = dayStartUtc(input.endDate)
  if (end.getTime() < start.getTime()) {
    throw new KasaError('DATE_ORDER', 'Bitiş tarihi başlangıçtan önce olamaz.')
  }

  return db.servicePackage.create({
    data: {
      customerName: input.customerName.trim(),
      serviceName: input.serviceName.trim(),
      startDate: start,
      endDate: end,
      salePriceMinor: input.salePriceMinor,
      costMinor: input.costMinor,
      note: input.note?.trim() || null,
      createdById: input.createdById ?? null,
    },
  })
}

/**
 * "Tahsil edildi" — paketin parasını SEÇİLEN HESABA gelir olarak yazar.
 *
 * ⚠️ TEK İŞLEM (transaction). Ayrı yapılsaydı paket "ödendi" görünürken
 * para hiçbir hesaba girmemiş olabilirdi — ya da tersi, para girip paket
 * ödenmemiş kalırdı.
 *
 * ⚠️ ÇİFT TAHSİLAT ENGELLİ. `paidAt` doluysa reddedilir; ayrıca
 * `paymentEntryId` veritabanında TEKİLDİR, yani aynı hareket iki pakete
 * bağlanamaz.
 */
export async function collectPayment(params: {
  packageId: string
  accountId: string
  occurredAt: Date
  createdById?: string | null
}) {
  return db.$transaction(async (tx) => {
    const pkg = await tx.servicePackage.findUnique({ where: { id: params.packageId } })
    if (!pkg) throw new KasaError('NOT_FOUND', 'Paket bulunamadı.', 404)
    if (pkg.paidAt) throw new KasaError('ALREADY_PAID', 'Bu paketin ödemesi zaten alınmış.')
    if (pkg.canceledAt) throw new KasaError('CANCELED', 'İptal edilmiş paket tahsil edilemez.')

    const account = await tx.cashAccount.findFirst({
      where: { id: params.accountId, isActive: true },
    })
    if (!account) throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesap bulunamadı.', 404)

    const entry = await tx.cashEntry.create({
      data: {
        accountId: params.accountId,
        occurredAt: dayStartUtc(params.occurredAt),
        direction: 'IN',
        // ⚠️ SATIS: bu gerçek bir satış geliridir ve ciroya girer.
        //    TAHSILAT değildir — o, daha önce ciroya yazılmış bir alacağın
        //    parasının gelmesi içindir. Paket satışı ilk kez burada sayılır.
        category: 'SATIS',
        amountMinor: pkg.salePriceMinor,
        description: `${pkg.serviceName} — ${pkg.customerName}`,
        customerHandle: pkg.customerName,
        // ⚠️ Maliyet BURAYA yazılmaz: paket kârı zaten paket kaydında
        //    hesaplanıyor. Buraya da yazmak aynı maliyeti iki kez düşerdi.
        createdById: params.createdById ?? null,
      },
    })

    return tx.servicePackage.update({
      where: { id: params.packageId },
      data: { paidAt: dayStartUtc(params.occurredAt), paymentEntryId: entry.id },
    })
  })
}

/**
 * Paketin maliyetini GERÇEK bir kasa çıkışına dönüştürür.
 *
 * ⚠️ İSTEĞE BAĞLIDIR. Maliyet paket kaydında zaten kâr hesabına giriyor;
 * bu işlem yalnızca parayı fiilen ödediğinde, banka bakiyesinin de düşmesi
 * için yapılır. Zorunlu tutulsaydı, henüz ödenmemiş bir tedarikçi borcu
 * bakiyeden düşülmüş görünürdü.
 *
 * ⚠️ Oluşan hareketin kategorisi `MALIYET`tir ve kasanın kâr hesabında
 * gider olarak sayılır. Paket özetindeki maliyetle aynı parayı temsil
 * ederler; ekranda iki ayrı bakış olduğu yazılıdır.
 */
export async function recordCostExpense(params: {
  packageId: string
  accountId: string
  occurredAt: Date
  createdById?: string | null
}) {
  return db.$transaction(async (tx) => {
    const pkg = await tx.servicePackage.findUnique({ where: { id: params.packageId } })
    if (!pkg) throw new KasaError('NOT_FOUND', 'Paket bulunamadı.', 404)
    if (pkg.costEntryId) throw new KasaError('ALREADY_RECORDED', 'Bu paketin maliyeti zaten işlendi.')
    if (pkg.costMinor <= 0) throw new KasaError('NO_COST', 'Pakette maliyet girilmemiş.')

    const account = await tx.cashAccount.findFirst({
      where: { id: params.accountId, isActive: true },
    })
    if (!account) throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesap bulunamadı.', 404)

    const entry = await tx.cashEntry.create({
      data: {
        accountId: params.accountId,
        occurredAt: dayStartUtc(params.occurredAt),
        direction: 'OUT',
        category: 'MALIYET',
        amountMinor: pkg.costMinor,
        description: `Maliyet — ${pkg.serviceName} · ${pkg.customerName}`,
        createdById: params.createdById ?? null,
      },
    })

    return tx.servicePackage.update({
      where: { id: params.packageId },
      data: { costEntryId: entry.id },
    })
  })
}

/**
 * ⚠️ İPTAL, KAYDI SİLMEZ. Geçmiş kaybolmamalı; iptal edilen iş de bir
 * bilgidir ve "yenilenmeyen müşteri" analizinde rol oynar.
 *
 * ⚠️ TAHSİL EDİLMİŞ PAKET İPTAL EDİLİRSE KASA HAREKETİ KENDİLİĞİNDEN
 * SİLİNMEZ. Para gerçekten geldiyse geri ödeme ayrı bir harekettir ve
 * elle girilir — kaydı sessizce yok etmek, bankada duran parayı defterde
 * yok saymak olurdu.
 */
export async function cancelPackage(packageId: string) {
  const pkg = await db.servicePackage.findUnique({ where: { id: packageId } })
  if (!pkg) throw new KasaError('NOT_FOUND', 'Paket bulunamadı.', 404)
  if (pkg.canceledAt) throw new KasaError('ALREADY_CANCELED', 'Paket zaten iptal edilmiş.')

  return db.servicePackage.update({
    where: { id: packageId },
    data: { canceledAt: new Date() },
  })
}
