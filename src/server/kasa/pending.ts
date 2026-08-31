import 'server-only'

import type { CashCategory } from '@/lib/kasa/calc'
import { db } from '@/server/db'
import { dayStartUtc, KasaError } from '@/server/kasa'

/**
 * ⭐ ÖDENMEMİŞ HAREKETLER — ALACAKLAR VE BORÇLAR
 *
 * ⚠️⚠️ BU MODÜL HİÇBİR `CashEntry` OLUŞTURMADAN KAYIT AÇAR.
 *
 * "Hareket ekle" formundaki ödeme durumu kutusu işaretli DEĞİLSE, satır
 * buraya düşer. Sebep, formda o kutuyu isterken konuşuldu:
 *
 *   `CashEntry` tablosundaki her satır tanımı gereği GERÇEKLEŞMİŞ bir para
 *   hareketidir. Oraya "ödenmedi" bayrağı koymak, bakiyeyi hesaplayan HER
 *   sorguya bir filtre eklemeyi zorunlu kılardı ve birinde unutulduğunda
 *   bakiye sessizce yanlış olurdu — bu oturumda kapatılan hata sınıfının
 *   aynısı.
 *
 * Burada kutu formda duruyor ama veri doğru tabloya gidiyor. Bakiye
 * YAPISAL OLARAK etkilenemez, çünkü ortada bir hareket yoktur.
 *
 * ⚠️ YÖN, HANGİ TABLOYA GİDECEĞİNİ BELİRLER:
 *     giriş (IN)  → `Receivable`       — bize borçlular
 *     çıkış (OUT) → `ScheduledPayment` — biz borçluyuz
 *
 * Para gerçekten hareket ettiğinde `settleReceivable` / `payScheduled`
 * çağrılır; gerçek hareket O AN yazılır ve bakiye o an değişir.
 */

export interface CreatePendingInput {
  /** Alacakta müşteri/kişi, borçta alacaklı taraf. */
  person: string
  amountMinor: number
  /** Arayüzdeki "İşlem". */
  description?: string | null
  /** Beklenen tarih. Alacakta isteğe bağlı, borçta zorunlu. */
  dueDate?: Date | null
  /** Yalnızca satışlarda — bakiyeye girmez, tahsilat hareketine taşınır. */
  costMinor?: number | null
  /**
   * ⚠️ TAHSİL/ÖDEME ANINDA YAZILACAK KATEGORİ. Burada saklanması şart:
   * ödenmemiş bir GİDER ödendiğinde gider olarak sayılmalıdır, hepsini
   * tek kaleme yazmak günlük harcamayı kredi taksitiyle karıştırırdı.
   */
  settleCategory: CashCategory
}

function validate(input: CreatePendingInput) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new KasaError('AMOUNT_INVALID', 'Tutar sıfırdan büyük olmalıdır.')
  }
  if (
    input.costMinor != null &&
    (!Number.isInteger(input.costMinor) || input.costMinor < 0)
  ) {
    throw new KasaError('COST_INVALID', 'Maliyet negatif olamaz.')
  }
  const person = input.person.trim()
  if (!person) throw new KasaError('PERSON_REQUIRED', 'Kişi/kurum adı boş olamaz.')
  return person
}

/** Ödenmemiş GİRİŞ — bize borçlular. Bakiyeye dokunmaz. */
export async function createReceivable(input: CreatePendingInput) {
  const person = validate(input)
  return db.receivable.create({
    data: {
      person,
      amountMinor: input.amountMinor,
      description: input.description?.trim() || null,
      dueDate: input.dueDate ? dayStartUtc(input.dueDate) : null,
      costMinor: input.costMinor ?? null,
      settleCategory: input.settleCategory,
    },
  })
}

/** Ödenmemiş ÇIKIŞ — biz borçluyuz. Bakiyeye dokunmaz. */
export async function createScheduledPayment(input: CreatePendingInput) {
  const person = validate(input)
  if (!input.dueDate) {
    /**
     * ⚠️ BORÇTA TARİH ZORUNLU, ALACAKTA DEĞİL. Bir borcun ne zaman ödeneceği
     * bilinmiyorsa "Yaklaşan ödemeler" listesi sıralanamaz ve liste asıl
     * işini yapamaz. Alacakta tarih çoğu zaman gerçekten belirsizdir.
     */
    throw new KasaError('DUE_DATE_REQUIRED', 'Borç için ödeme tarihi zorunludur.')
  }
  return db.scheduledPayment.create({
    data: {
      creditor: person,
      amountMinor: input.amountMinor,
      description: input.description?.trim() || null,
      dueDate: dayStartUtc(input.dueDate),
      settleCategory: input.settleCategory,
    },
  })
}

// ---------------------------------------------------------------------------

/**
 * ⚠️⚠️ SATIR KİLİDİ. Paketlerde bir denetimde kanıtlandı: düz `SELECT`
 * hiçbir kilit almaz ve iki eşzamanlı "tahsil et" isteği kaydı AYNI ANDA
 * ödenmemiş görüp iki ayrı hareket yazabilir. Tek alacak için defterde iki
 * gelir — hiçbir hata düşmeden.
 */
async function lockRow<T>(
  tx: Pick<typeof db, '$queryRawUnsafe'>,
  table: 'Receivable' | 'ScheduledPayment',
  id: string,
): Promise<T | null> {
  // ⚠️ Tablo adı SABİT bir birlikten gelir, kullanıcı girdisinden değil.
  //    Kimlik parametre olarak geçirilir, dizeye gömülmez.
  const rows = await tx.$queryRawUnsafe<T[]>(
    `SELECT * FROM "${table}" WHERE "id" = $1 FOR UPDATE`,
    id,
  )
  return rows[0] ?? null
}

interface LockedReceivable {
  id: string
  person: string
  amountMinor: number
  costMinor: number | null
  description: string | null
  settleCategory: CashCategory
  settledAt: Date | null
  settledEntryId: string | null
}

/**
 * Alacağı tahsil eder: gerçek kasa hareketini yazar ve bağlar.
 *
 * ⚠️ TEK İŞLEM. Ayrı yapılsaydı alacak "tahsil edildi" görünürken para
 * hiçbir hesaba girmemiş olabilirdi — ya da tersi.
 *
 * ⚠️ KATEGORİ KAYITTAN GELİR, SABİT DEĞİLDİR. Eski kod her tahsilata
 * `TAHSILAT` yazıyordu; bu, satışı zaten ciroya girmiş alacaklar için
 * doğru ama "Hareket ekle" formundan ödenmemiş olarak giren SATIŞLAR için
 * yanlıştır — o satış ciroda hiç görünmezdi.
 */
export async function settleReceivable(params: {
  receivableId: string
  accountId: string
  occurredAt: Date
  createdById?: string | null
}) {
  return db.$transaction(async (tx) => {
    const r = await lockRow<LockedReceivable>(tx, 'Receivable', params.receivableId)
    if (!r) throw new KasaError('NOT_FOUND', 'Alacak bulunamadı.', 404)
    if (r.settledAt) throw new KasaError('ALREADY_SETTLED', 'Bu alacak zaten tahsil edilmiş.')

    const account = await tx.cashAccount.findFirst({
      where: { id: params.accountId, isActive: true },
    })
    if (!account) throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesap bulunamadı.', 404)

    const entry = await tx.cashEntry.create({
      data: {
        accountId: params.accountId,
        occurredAt: dayStartUtc(params.occurredAt),
        direction: 'IN',
        category: r.settleCategory,
        amountMinor: r.amountMinor,
        description: r.description ? `${r.description} — ${r.person}` : `Tahsilat — ${r.person}`,
        customerHandle: r.person,
        // Maliyet kâr hesabına burada girer; alacak satırında beklerken
        // hiçbir yere yazılmamıştı.
        costMinor: r.costMinor,
        createdById: params.createdById ?? null,
      },
    })

    return tx.receivable.update({
      where: { id: params.receivableId },
      data: { settledAt: new Date(), settledEntryId: entry.id },
    })
  })
}

interface LockedPayment {
  id: string
  creditor: string
  amountMinor: number
  description: string | null
  settleCategory: CashCategory
  paidAt: Date | null
  paidEntryId: string | null
}

/** Borcu öder: gerçek kasa çıkışını yazar ve bağlar. */
export async function payScheduled(params: {
  paymentId: string
  accountId: string
  occurredAt: Date
  createdById?: string | null
}) {
  return db.$transaction(async (tx) => {
    const p = await lockRow<LockedPayment>(tx, 'ScheduledPayment', params.paymentId)
    if (!p) throw new KasaError('NOT_FOUND', 'Borç kaydı bulunamadı.', 404)
    if (p.paidAt) throw new KasaError('ALREADY_PAID', 'Bu borç zaten ödenmiş.')

    const account = await tx.cashAccount.findFirst({
      where: { id: params.accountId, isActive: true },
    })
    if (!account) throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesap bulunamadı.', 404)

    const entry = await tx.cashEntry.create({
      data: {
        accountId: params.accountId,
        occurredAt: dayStartUtc(params.occurredAt),
        direction: 'OUT',
        category: p.settleCategory,
        amountMinor: p.amountMinor,
        description: p.description ? `${p.description} — ${p.creditor}` : `Ödeme — ${p.creditor}`,
        createdById: params.createdById ?? null,
      },
    })

    return tx.scheduledPayment.update({
      where: { id: params.paymentId },
      data: { paidAt: new Date(), paidEntryId: entry.id },
    })
  })
}
