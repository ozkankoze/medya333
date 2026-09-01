import 'server-only'

import { accountBalance, balancesByAccount } from '@/lib/kasa/calc'
import { db } from '@/server/db'
import { dayStartUtc, KasaError } from '@/server/kasa'

/**
 * ⭐ PANEL ANA SAYFASI + ELLE BAKİYE DÜZELTMESİ
 *
 * İki iş yapar:
 *   · ana sayfanın verisi — hesap bakiyeleri ve ALACAKLAR
 *   · "bakiye şu olsun" — farkı bir DÜZELTME hareketi olarak yazar
 */

// ---------------------------------------------------------------------------
// ANA SAYFA
// ---------------------------------------------------------------------------

export interface PanelAccount {
  id: string
  name: string
  owner: string
  /** ⚠️ TÜRETİLMİŞ — veritabanında böyle bir sütun yoktur. */
  balanceMinor: number
}

export interface PanelReceivable {
  id: string
  /** 'siparis' | 'alacak' — hangi tablodan geldiği; düzenleme bağlantısı buna göre kurulur. */
  source: 'siparis' | 'alacak'
  person: string
  description: string
  amountMinor: number
  dueDate: Date | null
  /** Vadeye kalan gün; geçmişse negatif. `dueDate` yoksa null. */
  daysLeft: number | null
}

/**
 * ⚠️ ALACAK İKİ YERDEN GELİR ve ikisi de gösterilmelidir:
 *
 *   1) Ödeme tarihi yazılmış ama tahsil edilmemiş SİPARİŞLER
 *      — sipariş defterine "12.09.2026" yazınca oluşan alacak budur
 *   2) Kasadaki bağımsız ALACAK kayıtları
 *      — "Hareket ekle" formundan "ödenmedi" ile girilenler
 *
 * Yalnızca birini göstermek, ekranın "toplam alacağım" sorusuna eksik
 * cevap vermesi demekti; eksik bir toplam, yanlış bir toplamdan daha
 * tehlikelidir çünkü doğru görünür.
 */
export async function getPanelHome(today: Date) {
  const t0 = dayStartUtc(today).getTime()
  const gunFarki = (d: Date | null) =>
    d === null ? null : Math.round((dayStartUtc(d).getTime() - t0) / 86_400_000)

  const [accounts, entries, orders, receivables, payables] = await Promise.all([
    db.cashAccount.findMany({
      where: { isActive: true },
      orderBy: [{ owner: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    /**
     * ⚠️ BAKİYE İÇİN TÜM HAREKETLER OKUNUR, seçili ay değil. "Hesapta ne
     * kadar var?" sorusunun cevabı ayla sınırlanamaz. Yalnızca bakiyeye
     * giren alanlar seçilir — açıklama ve not taşımak boşuna trafik.
     */
    db.cashEntry.findMany({ select: { accountId: true, direction: true, amountMinor: true } }),
    db.manualOrder.findMany({
      where: { paidAt: null, dueDate: { not: null }, status: { not: 'IPTAL' } },
      orderBy: [{ dueDate: 'asc' }],
      select: {
        id: true,
        customerName: true,
        description: true,
        salePriceMinor: true,
        dueDate: true,
      },
    }),
    db.receivable.findMany({
      where: { settledAt: null },
      orderBy: [{ dueDate: 'asc' }],
      select: { id: true, person: true, description: true, amountMinor: true, dueDate: true },
    }),
    db.scheduledPayment.findMany({
      where: { paidAt: null },
      orderBy: [{ dueDate: 'asc' }],
      select: { id: true, creditor: true, description: true, amountMinor: true, dueDate: true },
    }),
  ])

  // ⚠️ Tek geçişte hesap → bakiye. Hesap başına ayrı filtreleme, 8
  //    hesapta 8 kez tüm hareket listesini dolaşmak olurdu.
  const bakiyeler = balancesByAccount(accounts, entries)

  const panelAccounts: PanelAccount[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    owner: a.owner,
    balanceMinor: bakiyeler.get(a.id) ?? a.openingBalanceMinor,
  }))

  const alacaklar: PanelReceivable[] = [
    ...orders.map((o) => ({
      id: o.id,
      source: 'siparis' as const,
      person: o.customerName,
      description: o.description,
      amountMinor: o.salePriceMinor,
      dueDate: o.dueDate,
      daysLeft: gunFarki(o.dueDate),
    })),
    ...receivables.map((r) => ({
      id: r.id,
      source: 'alacak' as const,
      person: r.person,
      description: r.description ?? '—',
      amountMinor: r.amountMinor,
      dueDate: r.dueDate,
      daysLeft: gunFarki(r.dueDate),
    })),
  ].sort((a, b) => {
    /**
     * ⚠️ TARİHSİZ ALACAKLAR EN ALTA. `null`ı 0 sayan bir sıralama onları
     * "1970" gibi görüp en üste taşırdı; en acil satırların yerini,
     * hakkında hiçbir tarih bilinmeyen satırlar kapardı.
     */
    if (a.dueDate === null) return b.dueDate === null ? 0 : 1
    if (b.dueDate === null) return -1
    return a.dueDate.getTime() - b.dueDate.getTime()
  })

  return {
    accounts: panelAccounts,
    grandTotalMinor: panelAccounts.reduce((s, a) => s + a.balanceMinor, 0),
    alacaklar,
    alacakToplamMinor: alacaklar.reduce((s, a) => s + a.amountMinor, 0),
    borclar: payables.map((p) => ({
      id: p.id,
      creditor: p.creditor,
      description: p.description ?? '—',
      amountMinor: p.amountMinor,
      dueDate: p.dueDate,
      daysLeft: gunFarki(p.dueDate),
    })),
    borcToplamMinor: payables.reduce((s, p) => s + p.amountMinor, 0),
  }
}

// ---------------------------------------------------------------------------
// ELLE BAKİYE DÜZELTMESİ
// ---------------------------------------------------------------------------

/**
 * "Bu hesabın bakiyesi şu olsun."
 *
 * ⚠️⚠️ BAKİYE DOĞRUDAN YAZILMAZ, ÇÜNKÜ SAKLANMIYOR. Bakiye, açılış bakiyesi
 * artı bütün hareketlerden HESAPLANIYOR. Yazılabilir bir sütun olsaydı
 * defterle bakiye ilk fırsatta ayrışır ve hangisinin doğru olduğu
 * bilinemezdi.
 *
 * Bunun yerine aradaki FARK kadar bir DÜZELTME hareketi yazılır. Sonuç
 * kullanıcı açısından aynıdır — bakiye istediği sayıya gelir — ama defterde
 * her kuruşun karşılığında hâlâ bir satır vardır. Üç ay sonra "bu 3.000 TL
 * nereden çıktı?" diye soran kişi cevabı görebilir.
 *
 * ⚠️ TEK İŞLEM VE SATIR KİLİDİ. Kilit olmasaydı iki eşzamanlı düzeltme
 * aynı "mevcut bakiye"yi okur, ikisi de kendi farkını yazar ve bakiye
 * hedefin iki katı kadar kayardı.
 */
export async function adjustAccountBalance(params: {
  accountId: string
  targetMinor: number
  occurredAt: Date
  note?: string | null
  createdById?: string | null
}) {
  if (!Number.isInteger(params.targetMinor)) {
    throw new KasaError('TARGET_INVALID', 'Hedef bakiye tam sayı kuruş olmalıdır.')
  }

  return db.$transaction(async (tx) => {
    // ⚠️ `FOR UPDATE` hesabı kilitler; ikinci düzeltme birincinin
    //    commit'ini bekler ve GÜNCEL bakiyeyi okur.
    const locked = await tx.$queryRaw<Array<{ id: string; openingBalanceMinor: number; name: string }>>`
      SELECT "id", "openingBalanceMinor", "name"
      FROM "CashAccount"
      WHERE "id" = ${params.accountId} AND "isActive" = true
      FOR UPDATE
    `
    const account = locked[0]
    if (!account) throw new KasaError('ACCOUNT_NOT_FOUND', 'Hesap bulunamadı.', 404)

    const entries = await tx.cashEntry.findMany({
      where: { accountId: account.id },
      select: { accountId: true, direction: true, amountMinor: true },
    })
    const current = accountBalance(account, entries)
    const diff = params.targetMinor - current

    /**
     * ⚠️ FARK SIFIRSA HAREKET YAZILMAZ. Sıfır tutarlı bir hareket
     * `createEntry`'nin "tutar sıfırdan büyük olmalı" kuralına da takılırdı;
     * ama asıl sebep defteri anlamsız satırlarla doldurmamak.
     */
    if (diff === 0) {
      return { changed: false, currentMinor: current, diffMinor: 0, entryId: null as string | null }
    }

    const entry = await tx.cashEntry.create({
      data: {
        accountId: account.id,
        occurredAt: dayStartUtc(params.occurredAt),
        direction: diff > 0 ? 'IN' : 'OUT',
        category: 'DUZELTME',
        amountMinor: Math.abs(diff),
        // ⚠️ Açıklama SEBEBİ taşır: dökümde "Düzeltme" tek başına, üç ay
        //    sonra bakan kişiye hiçbir şey anlatmazdı.
        description: params.note?.trim()
          ? `Bakiye düzeltmesi — ${params.note.trim()}`
          : 'Bakiye düzeltmesi (elle)',
        createdById: params.createdById ?? null,
      },
    })

    return {
      changed: true,
      currentMinor: params.targetMinor,
      diffMinor: diff,
      entryId: entry.id,
    }
  })
}

// ---------------------------------------------------------------------------

/**
 * Yeni hesap açar.
 *
 * ⚠️ AÇILIŞ BAKİYESİ BİR HAREKET DEĞİLDİR ve olmamalıdır. Hesabı açarken
 * "içinde 5.000 TL var" demek, o parayı bir gelir gibi yazmak olurdu ve
 * ciroya karışırdı. Açılış bakiyesi hesabın kendi alanıdır; bakiye
 * hesaplanırken ona EKLENİR, kâra hiç girmez.
 */
export async function createAccount(params: {
  owner: string
  name: string
  openingBalanceMinor: number
}) {
  const owner = params.owner.trim()
  const name = params.name.trim()
  if (!owner) throw new KasaError('OWNER_REQUIRED', 'Hesap sahibi boş olamaz.')
  if (!name) throw new KasaError('NAME_REQUIRED', 'Hesap adı boş olamaz.')
  if (!Number.isInteger(params.openingBalanceMinor)) {
    throw new KasaError('OPENING_INVALID', 'Açılış bakiyesi tam sayı kuruş olmalıdır.')
  }

  /**
   * ⚠️ AYNI ADLA İKİNCİ HESAP ENGELLENİR. Ödeme kutusuna "yapıkredi"
   * yazıldığında hangi hesap olduğu belirsizleşir ve `odemeCozumle`
   * girdiyi reddetmek zorunda kalırdı — yani ikinci hesabı açmak, ilkini
   * de kullanılamaz hâle getirirdi.
   */
  const clash = await db.cashAccount.findFirst({ where: { name, isActive: true } })
  if (clash) throw new KasaError('NAME_TAKEN', `"${name}" adında bir hesap zaten var.`)

  return db.cashAccount.create({
    data: { owner, name, openingBalanceMinor: params.openingBalanceMinor },
  })
}
