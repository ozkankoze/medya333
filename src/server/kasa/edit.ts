import 'server-only'

import type { CashCategory, CashDirection } from '@/lib/kasa/calc'
import type { ManualOrderStatus } from '@/lib/kasa/orders'
import { db } from '@/server/db'
import { dayStartUtc, KasaError } from '@/server/kasa'

/**
 * ⭐ PANEL KAYITLARINI DÜZENLEME
 *
 * ⚠️⚠️ TEK KURAL, DÖRT TABLODA AYNI:
 *
 *   METİN ve TARİH her zaman düzenlenebilir.
 *   TUTAR yalnızca o kayda bağlı bir KASA HAREKETİ YOKKEN düzenlenebilir.
 *
 * Sebep bu oturumda kanıtlandı: tahsil edilmiş bir paketin satış tutarı
 * 20.000'den 99.000'e çekildiğinde kasa hareketi 20.000'de kalıyor ve arada
 * 79.000 TL'lik sessiz bir fark oluşuyordu. Hareket gerçeği temsil eder —
 * para o tutarda gelmiştir. Rakam yanlışsa doğru yol düzeltme değil, ters
 * kayıt veya iptal + yeni kayıttır.
 *
 * ⚠️ BURADAKİ KONTROLLER TEK BAŞINA YETMEZ ve yetmediği için veritabanında
 * da tetikleyiciler var (`kasa_paket_tutar_dondur`, `kasa_siparis_...`,
 * `kasa_alacak_...`, `kasa_borc_...`, `kasa_bagli_hareket_dondur`). Buradaki
 * kontrol yalnızca kullanıcıya ANLAŞILIR bir mesaj vermek içindir; uygulama
 * katmanı atlanabilir, tetikleyici atlanamaz.
 *
 * ⚠️ DÜZENLENEBİLİRLİK GİZLENMEZ, SEBEBİ YAZILIR. Donmuş bir alanı ekrandan
 * kaldırmak kullanıcıya "özellik bozuk" hissi verir; kilitli gösterip
 * sebebini yazmak kuralı öğretir.
 */

const FROZEN =
  'Bu kayıttan kasaya hareket yazılmış; tutar artık değiştirilemez. ' +
  'Düzeltme gerekiyorsa tahsilatı geri alın ya da ters kayıt girin.'

// ---------------------------------------------------------------------------
// KASA HAREKETİ
// ---------------------------------------------------------------------------

/**
 * ⚠️ KATEGORİ ↔ YÖN EŞLEŞMESİ. Oluşturmadaki `DIRECTION_OF` kuralının aynısı;
 * düzenlemede atlanırsa "SATIS ama para çıkışı" gibi bir satır üretilebilir
 * ve kâr hesabı sessizce bozulur.
 */
const DIRECTION_OF: Record<CashCategory, CashDirection | 'ANY'> = {
  SATIS: 'IN',
  TAHSILAT: 'IN',
  GIDER: 'OUT',
  MALIYET: 'OUT',
  BORC_ODEME: 'OUT',
  TRANSFER_IN: 'IN',
  TRANSFER_OUT: 'OUT',
  DIGER: 'ANY',
}

export interface UpdateEntryInput {
  entryId: string
  occurredAt?: Date
  accountId?: string
  category?: CashCategory
  direction?: CashDirection
  amountMinor?: number
  description?: string
  customerHandle?: string | null
  costMinor?: number | null
  note?: string | null
}

/** Bir hareketin başka bir kayda bağlı olup olmadığını söyler. */
async function entryLinkedTo(entryId: string): Promise<string | null> {
  const [pkg, order, rec, pay] = await Promise.all([
    db.servicePackage.findFirst({
      where: { OR: [{ paymentEntryId: entryId }, { costEntryId: entryId }] },
      select: { id: true },
    }),
    db.manualOrder.findFirst({
      where: { OR: [{ paymentEntryId: entryId }, { costEntryId: entryId }] },
      select: { id: true },
    }),
    db.receivable.findFirst({ where: { settledEntryId: entryId }, select: { id: true } }),
    db.scheduledPayment.findFirst({ where: { paidEntryId: entryId }, select: { id: true } }),
  ])
  if (pkg) return 'paket'
  if (order) return 'sipariş'
  if (rec) return 'alacak'
  if (pay) return 'borç'
  return null
}

export async function updateEntry(input: UpdateEntryInput) {
  const entry = await db.cashEntry.findUnique({ where: { id: input.entryId } })
  if (!entry) throw new KasaError('NOT_FOUND', 'Hareket bulunamadı.', 404)

  const linkedTo = await entryLinkedTo(input.entryId)

  /**
   * ⚠️ BAĞLI HAREKETTE TUTAR VE HESAP DONAR — ama açıklama, tarih ve not
   * serbesttir. Hepsini kilitlemek gereksiz katılık olurdu: bir yazım
   * hatasını düzeltmek parayı bozmaz.
   */
  const changesAmount =
    input.amountMinor !== undefined && input.amountMinor !== entry.amountMinor
  const changesAccount = input.accountId !== undefined && input.accountId !== entry.accountId
  if (linkedTo && (changesAmount || changesAccount)) {
    throw new KasaError(
      'ENTRY_LINKED',
      `Bu hareket bir ${linkedTo} kaydına bağlı; tutarı ve hesabı değiştirilemez. ` +
        `Önce o kayıttaki tahsilatı geri alın.`,
    )
  }

  const category = input.category ?? (entry.category as CashCategory)
  const direction = input.direction ?? (entry.direction as CashDirection)
  const expected = DIRECTION_OF[category]
  if (expected !== 'ANY' && expected !== direction) {
    throw new KasaError(
      'DIRECTION_MISMATCH',
      `"${category}" kategorisi ${expected === 'IN' ? 'para girişi' : 'para çıkışı'} olmalıdır.`,
    )
  }

  const amount = input.amountMinor ?? entry.amountMinor
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new KasaError('AMOUNT_INVALID', 'Tutar sıfırdan büyük olmalıdır.')
  }

  const cost = input.costMinor === undefined ? entry.costMinor : input.costMinor
  if (cost != null && (!Number.isInteger(cost) || cost < 0)) {
    throw new KasaError('COST_INVALID', 'Maliyet negatif olamaz.')
  }
  // ⚠️ Maliyet yalnızca satış satırında anlamlıdır — oluşturmadaki kuralın aynısı.
  if (cost != null && category !== 'SATIS') {
    throw new KasaError('COST_NOT_ALLOWED', 'Maliyet yalnızca satış satırında girilebilir.')
  }

  if (input.accountId && input.accountId !== entry.accountId) {
    const account = await db.cashAccount.findUnique({ where: { id: input.accountId } })
    if (!account || !account.isActive) {
      throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesap bulunamadı veya kullanım dışı.', 404)
    }
  }

  const description = (input.description ?? entry.description).trim()
  if (!description) throw new KasaError('DESCRIPTION_REQUIRED', 'İşlem açıklaması boş olamaz.')

  return db.cashEntry.update({
    where: { id: input.entryId },
    data: {
      ...(input.occurredAt ? { occurredAt: dayStartUtc(input.occurredAt) } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      category,
      direction,
      amountMinor: amount,
      description,
      customerHandle:
        input.customerHandle === undefined
          ? entry.customerHandle
          : input.customerHandle?.trim() || null,
      costMinor: cost,
      note: input.note === undefined ? entry.note : input.note?.trim() || null,
    },
  })
}

/**
 * ⚠️ BAĞLI HAREKET SİLİNEMEZ. Silinseydi bağlı kayıt "tahsil edildi"
 * görünürken karşılığında hiçbir para olmazdı. Asıl engel veritabanındaki
 * ON DELETE RESTRICT; buradaki kontrol anlaşılır mesaj içindir.
 */
export async function deleteEntry(entryId: string) {
  const entry = await db.cashEntry.findUnique({ where: { id: entryId } })
  if (!entry) throw new KasaError('NOT_FOUND', 'Hareket bulunamadı.', 404)

  const linkedTo = await entryLinkedTo(entryId)
  if (linkedTo) {
    throw new KasaError(
      'ENTRY_LINKED',
      `Bu hareket bir ${linkedTo} kaydına bağlı; silinemez. Önce o kayıttaki tahsilatı geri alın.`,
    )
  }

  /**
   * ⚠️ TRANSFERİN İKİ BACAĞI BİRLİKTE SİLİNİR. Yalnızca biri silinseydi
   * para bir hesaptan çıkmış ama diğerine hiç girmemiş görünürdü — toplam
   * bakiye sessizce değişirdi.
   */
  if (entry.transferGroupId) {
    const { count } = await db.cashEntry.deleteMany({
      where: { transferGroupId: entry.transferGroupId },
    })
    return { deleted: count, transfer: true }
  }

  await db.cashEntry.delete({ where: { id: entryId } })
  return { deleted: 1, transfer: false }
}

// ---------------------------------------------------------------------------
// AYLIK PAKET
// ---------------------------------------------------------------------------

export interface UpdatePackageInput {
  packageId: string
  customerName?: string
  serviceName?: string
  startDate?: Date
  endDate?: Date
  salePriceMinor?: number
  costMinor?: number
  note?: string | null
}

export async function updatePackage(input: UpdatePackageInput) {
  const pkg = await db.servicePackage.findUnique({ where: { id: input.packageId } })
  if (!pkg) throw new KasaError('NOT_FOUND', 'Paket bulunamadı.', 404)

  if (
    pkg.paymentEntryId &&
    input.salePriceMinor !== undefined &&
    input.salePriceMinor !== pkg.salePriceMinor
  ) {
    throw new KasaError('SALE_FROZEN', FROZEN)
  }
  if (pkg.costEntryId && input.costMinor !== undefined && input.costMinor !== pkg.costMinor) {
    throw new KasaError('COST_FROZEN', FROZEN)
  }

  const sale = input.salePriceMinor ?? pkg.salePriceMinor
  const cost = input.costMinor ?? pkg.costMinor
  if (!Number.isInteger(sale) || sale < 0) {
    throw new KasaError('SALE_INVALID', 'Satış tutarı negatif olamaz.')
  }
  if (!Number.isInteger(cost) || cost < 0) {
    throw new KasaError('COST_INVALID', 'Maliyet negatif olamaz.')
  }

  const start = input.startDate ? dayStartUtc(input.startDate) : pkg.startDate
  const end = input.endDate ? dayStartUtc(input.endDate) : pkg.endDate
  if (end.getTime() < start.getTime()) {
    throw new KasaError('DATE_ORDER', 'Bitiş tarihi başlangıçtan önce olamaz.')
  }

  const customerName = (input.customerName ?? pkg.customerName).trim()
  const serviceName = (input.serviceName ?? pkg.serviceName).trim()
  if (!customerName) throw new KasaError('NAME_REQUIRED', 'Müşteri adı boş olamaz.')
  if (!serviceName) throw new KasaError('SERVICE_REQUIRED', 'Hizmet adı boş olamaz.')

  return db.servicePackage.update({
    where: { id: input.packageId },
    data: {
      customerName,
      serviceName,
      startDate: start,
      endDate: end,
      salePriceMinor: sale,
      costMinor: cost,
      note: input.note === undefined ? pkg.note : input.note?.trim() || null,
    },
  })
}

// ---------------------------------------------------------------------------
// ELLE GİRİLEN SİPARİŞ
// ---------------------------------------------------------------------------

export interface UpdateOrderInput {
  orderId: string
  customerName?: string
  description?: string
  occurredAt?: Date
  salePriceMinor?: number
  costMinor?: number
  status?: ManualOrderStatus
}

export async function updateManualOrder(input: UpdateOrderInput) {
  const order = await db.manualOrder.findUnique({ where: { id: input.orderId } })
  if (!order) throw new KasaError('NOT_FOUND', 'Sipariş bulunamadı.', 404)

  if (
    order.paymentEntryId &&
    input.salePriceMinor !== undefined &&
    input.salePriceMinor !== order.salePriceMinor
  ) {
    throw new KasaError('SALE_FROZEN', FROZEN)
  }
  if (order.costEntryId && input.costMinor !== undefined && input.costMinor !== order.costMinor) {
    throw new KasaError('COST_FROZEN', FROZEN)
  }

  const sale = input.salePriceMinor ?? order.salePriceMinor
  const cost = input.costMinor ?? order.costMinor
  if (!Number.isInteger(sale) || sale < 0) {
    throw new KasaError('SALE_INVALID', 'Sipariş tutarı negatif olamaz.')
  }
  if (!Number.isInteger(cost) || cost < 0) {
    throw new KasaError('COST_INVALID', 'Maliyet negatif olamaz.')
  }

  const customerName = (input.customerName ?? order.customerName).trim()
  const description = (input.description ?? order.description).trim()
  if (!customerName) throw new KasaError('NAME_REQUIRED', 'Kullanıcı adı boş olamaz.')
  if (!description) throw new KasaError('DESCRIPTION_REQUIRED', 'Sipariş içeriği boş olamaz.')

  return db.manualOrder.update({
    where: { id: input.orderId },
    data: {
      customerName,
      description,
      ...(input.occurredAt ? { occurredAt: dayStartUtc(input.occurredAt) } : {}),
      salePriceMinor: sale,
      costMinor: cost,
      ...(input.status ? { status: input.status } : {}),
    },
  })
}

// ---------------------------------------------------------------------------
// ALACAK / BORÇ
// ---------------------------------------------------------------------------

export interface UpdatePendingInput {
  id: string
  kind: 'alacak' | 'borc'
  person?: string
  description?: string | null
  dueDate?: Date | null
  amountMinor?: number
  costMinor?: number | null
  note?: string | null
}

export async function updatePending(input: UpdatePendingInput) {
  if (input.kind === 'alacak') {
    const r = await db.receivable.findUnique({ where: { id: input.id } })
    if (!r) throw new KasaError('NOT_FOUND', 'Alacak bulunamadı.', 404)
    if (r.settledEntryId && input.amountMinor !== undefined && input.amountMinor !== r.amountMinor) {
      throw new KasaError('AMOUNT_FROZEN', FROZEN)
    }
    const amount = input.amountMinor ?? r.amountMinor
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new KasaError('AMOUNT_INVALID', 'Tutar sıfırdan büyük olmalıdır.')
    }
    const person = (input.person ?? r.person).trim()
    if (!person) throw new KasaError('PERSON_REQUIRED', 'Kişi/kurum adı boş olamaz.')

    return db.receivable.update({
      where: { id: input.id },
      data: {
        person,
        amountMinor: amount,
        description:
          input.description === undefined ? r.description : input.description?.trim() || null,
        dueDate: input.dueDate === undefined ? r.dueDate : input.dueDate ? dayStartUtc(input.dueDate) : null,
        costMinor: input.costMinor === undefined ? r.costMinor : input.costMinor,
        note: input.note === undefined ? r.note : input.note?.trim() || null,
      },
    })
  }

  const p = await db.scheduledPayment.findUnique({ where: { id: input.id } })
  if (!p) throw new KasaError('NOT_FOUND', 'Borç kaydı bulunamadı.', 404)
  if (p.paidEntryId && input.amountMinor !== undefined && input.amountMinor !== p.amountMinor) {
    throw new KasaError('AMOUNT_FROZEN', FROZEN)
  }
  const amount = input.amountMinor ?? p.amountMinor
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new KasaError('AMOUNT_INVALID', 'Tutar sıfırdan büyük olmalıdır.')
  }
  const creditor = (input.person ?? p.creditor).trim()
  if (!creditor) throw new KasaError('PERSON_REQUIRED', 'Alacaklı adı boş olamaz.')
  // ⚠️ Borçta tarih zorunlu — oluşturmadaki kuralın aynısı.
  const due = input.dueDate === undefined ? p.dueDate : input.dueDate
  if (!due) throw new KasaError('DUE_DATE_REQUIRED', 'Borç için ödeme tarihi zorunludur.')

  return db.scheduledPayment.update({
    where: { id: input.id },
    data: {
      creditor,
      amountMinor: amount,
      description:
        input.description === undefined ? p.description : input.description?.trim() || null,
      dueDate: dayStartUtc(due),
      note: input.note === undefined ? p.note : input.note?.trim() || null,
    },
  })
}

/**
 * ⚠️ TAHSİL/ÖDEME YAPILMAMIŞ alacak veya borç SİLİNEBİLİR.
 * Yapılmışsa silme reddedilir: bağlı hareket öksüz kalır ve bakiye
 * açıklanamaz hâle gelirdi (veritabanı da RESTRICT ile engeller).
 */
export async function deletePending(id: string, kind: 'alacak' | 'borc') {
  if (kind === 'alacak') {
    const r = await db.receivable.findUnique({ where: { id } })
    if (!r) throw new KasaError('NOT_FOUND', 'Alacak bulunamadı.', 404)
    if (r.settledEntryId) {
      throw new KasaError('SETTLED', 'Tahsil edilmiş alacak silinemez.')
    }
    await db.receivable.delete({ where: { id } })
    return { id }
  }
  const p = await db.scheduledPayment.findUnique({ where: { id } })
  if (!p) throw new KasaError('NOT_FOUND', 'Borç kaydı bulunamadı.', 404)
  if (p.paidEntryId) throw new KasaError('PAID', 'Ödenmiş borç silinemez.')
  await db.scheduledPayment.delete({ where: { id } })
  return { id }
}
