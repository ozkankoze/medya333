import 'server-only'

import {
  netProfitMinor,
  paymentStateOf,
  summarizeOrders,
  type ManualOrderStatus,
  type PaymentState,
} from '@/lib/kasa/orders'
import { odemeCozumle, type OdemeGirdisi } from '@/lib/kasa/odeme-alani'
import { db } from '@/server/db'
import { dayStartUtc, KasaError } from '@/server/kasa'

/**
 * ⭐ ELLE GİRİLEN SİPARİŞ DEFTERİ — SUNUCU KATMANI
 *
 * ⚠️ SİTEDEKİ `Order` TABLOSUNA HİÇ DOKUNULMAZ. Bu modül yalnızca
 * `ManualOrder` okur ve yazar. Siteden gelen gerçek müşteri siparişleri
 * ayrı bir tablodadır ve panelde ARTIK GÖRÜNTÜLENMEZ (İş Kuyruğu ekranı
 * kaldırıldı) — ikisi hiçbir noktada birbirine karışmaz.
 *
 * ⚠️ YETKİ BURADA DEĞİL, UÇTA (`minimumRole: 'SUPERADMIN'`). Kontrolü iki
 * yere dağıtmak, birinde unutulduğunda diğerinin koruduğu yanılsaması
 * yaratır.
 */

export interface OrderRow {
  id: string
  customerName: string
  /** Arayüzde "Sipariş içeriği" — zorunlu, boş olamaz. */
  description: string
  occurredAt: Date
  salePriceMinor: number
  costMinor: number
  /** ⚠️ SAKLANMAZ — hesaplanır. */
  netMinor: number
  status: ManualOrderStatus
  /** ⚠️ SAKLANMAZ — `paidAt`ten türetilir. */
  paymentState: PaymentState
  paidAt: Date | null
  /**
   * BEKLENEN ödeme günü — alınmış ödeme değil. `paidAt` boşken doluysa bu
   * satır bir ALACAKTIR ve panelin ana sayfasında listelenir.
   */
  dueDate: Date | null
  paymentEntryId: string | null
  /**
   * Tahsilatın yazıldığı hesabın adı ("Yapıkredi").
   * ⚠️ Ekranda ŞART: hangi hesaba girdiği görünmezse, dört hesabı olan
   * biri parayı bulmak için kasa dökümünü taramak zorunda kalır.
   */
  paidAccountName: string | null
  costEntryId: string | null
  /**
   * Satır silinebilir mi? Kasaya hareket yazılmışsa HAYIR — para öksüz
   * kalırdı. Ekranda düğmeyi gizlemek için burada hesaplanır, ama asıl
   * engel veritabanı tetikleyicisindedir.
   */
  canDelete: boolean
}

interface DbOrder {
  id: string
  customerName: string
  description: string
  occurredAt: Date
  salePriceMinor: number
  costMinor: number
  status: ManualOrderStatus
  paidAt: Date | null
  dueDate: Date | null
  paymentEntryId: string | null
  paymentEntry?: { account: { name: string } } | null
  costEntryId: string | null
}

function toRow(o: DbOrder): OrderRow {
  return {
    id: o.id,
    customerName: o.customerName,
    description: o.description,
    occurredAt: o.occurredAt,
    salePriceMinor: o.salePriceMinor,
    costMinor: o.costMinor,
    netMinor: netProfitMinor(o),
    status: o.status,
    paymentState: paymentStateOf(o),
    paidAt: o.paidAt,
    dueDate: o.dueDate,
    paymentEntryId: o.paymentEntryId,
    paidAccountName: o.paymentEntry?.account.name ?? null,
    costEntryId: o.costEntryId,
    canDelete: o.paymentEntryId === null && o.costEntryId === null,
  }
}

/**
 * Seçili AYIN siparişleri.
 *
 * ⚠️ PAKETLERDEN FARKLI OLARAK TÜM KAYITLAR ÇEKİLMEZ. Paket sayısı
 * doğası gereği azdır (aylık müşteri başına bir satır), günlük sipariş
 * ise birikir — bir yıl sonra binlerce satırı her açılışta çekmek sayfayı
 * yavaşlatır ve hiçbir işe yaramaz, çünkü ekranda zaten tek ay gösteriliyor.
 */
export async function getOrders(year: number, month1: number) {
  const start = new Date(Date.UTC(year, month1 - 1, 1))
  const end = new Date(Date.UTC(year, month1, 1))

  const all = await db.manualOrder.findMany({
    where: { occurredAt: { gte: start, lt: end } },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    // ⚠️ TEK SORGUDA hesap adı. Satır başına ayrı sorgu, 200 siparişlik
    //    bir ayda 200 ek gidiş-geliş demekti.
    include: { paymentEntry: { select: { account: { select: { name: true } } } } },
  })

  return {
    rows: all.map(toRow),
    summary: summarizeOrders(all, { year, month1 }),
  }
}

// ---------------------------------------------------------------------------

/**
 * ⚠️⚠️ SATIR KİLİDİ ALAN OKUMA — `findUnique` YETMEZ.
 *
 * Paketlerde bu bir denetimde kanıtlandı: düz `SELECT` hiçbir kilit almaz.
 * İki eşzamanlı "tahsil et" isteği kaydı AYNI ANDA "ödenmemiş" görüyor,
 * ikisi de kendi kasa hareketini yazıyordu — tek satış için defterde iki
 * gelir. Hiçbir hata düşmüyor, çünkü teknik olarak her iki işlem de
 * "geçerli". Aynı hatayı bu tabloda tekrarlamıyoruz.
 *
 * ⚠️ Prisma'nın sorgu API'sinde `FOR UPDATE` yok, bu yüzden ham SQL
 * zorunludur. Parametre şablon değişkeniyle geçirilir, birleştirilmez.
 */
async function lockOrder(
  tx: Pick<typeof db, '$queryRaw'>,
  id: string,
): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT "id", "customerName", "description", "occurredAt", "salePriceMinor", "costMinor",
           "status", "paidAt", "dueDate", "paymentEntryId", "costEntryId"
    FROM "ManualOrder"
    WHERE "id" = ${id}
    FOR UPDATE
  `
  return rows[0] ?? null
}

interface LockedOrder {
  id: string
  customerName: string
  description: string
  occurredAt: Date
  salePriceMinor: number
  costMinor: number
  status: ManualOrderStatus
  paidAt: Date | null
  dueDate: Date | null
  paymentEntryId: string | null
  costEntryId: string | null
}

export interface CreateOrderInput {
  customerName: string
  /** Arayüzde "Sipariş içeriği" — zorunlu. */
  description: string
  occurredAt: Date
  salePriceMinor: number
  costMinor: number
  status?: ManualOrderStatus
  /** Beklenen ödeme günü — "Ödeme" kutusuna tarih yazıldığında dolar. */
  dueDate?: Date | null
  createdById?: string | null
}

/**
 * ⚠️ SİPARİŞ GİRMEK KASAYA DOKUNMAZ.
 *
 * Hiçbir `CashEntry` oluşturulmaz, hiçbir banka bakiyesi değişmez. Sipariş
 * bir SATIŞ KAYDIDIR; para henüz gelmemiş olabilir. Girişte gelir yazılsaydı
 * bakiye tahsil edilmemiş parayı içerir ve "ödeyebilir miyim?" sorusuna
 * yanlış cevap verirdi.
 *
 * Gelir hareketi yalnızca `collectOrderPayment` ile oluşur.
 */
export async function createOrder(input: CreateOrderInput) {
  if (!Number.isInteger(input.salePriceMinor) || input.salePriceMinor < 0) {
    throw new KasaError('SALE_INVALID', 'Sipariş tutarı negatif olamaz.')
  }
  if (!Number.isInteger(input.costMinor) || input.costMinor < 0) {
    throw new KasaError('COST_INVALID', 'Maliyet negatif olamaz.')
  }
  const name = input.customerName.trim()
  if (!name) throw new KasaError('NAME_REQUIRED', 'Kullanıcı adı boş olamaz.')

  /**
   * ⚠️ SADECE BOŞLUKTAN İBARET İÇERİK REDDEDİLİR. Zod `min(1)` tek boşluğu
   * geçirir; kırpıldıktan sonra boş kalan bir değer veritabanındaki
   * `btrim(...) <> ''` kısıtına takılır ve kullanıcı anlaşılmaz bir
   * veritabanı hatası görürdü. Kapıyı burada, anlaşılır mesajla kapatıyoruz.
   */
  const description = input.description.trim()
  if (!description) throw new KasaError('DESCRIPTION_REQUIRED', 'Sipariş içeriği boş olamaz.')

  return db.manualOrder.create({
    data: {
      customerName: name,
      description,
      occurredAt: dayStartUtc(input.occurredAt),
      salePriceMinor: input.salePriceMinor,
      costMinor: input.costMinor,
      status: input.status ?? 'BEKLIYOR',
      dueDate: input.dueDate ? dayStartUtc(input.dueDate) : null,
      createdById: input.createdById ?? null,
    },
  })
}

/**
 * "Tahsil edildi" — siparişin parasını SEÇİLEN HESABA gelir olarak yazar.
 *
 * ⚠️ TEK İŞLEM (transaction). Ayrı yapılsaydı sipariş "tahsil edildi"
 * görünürken para hiçbir hesaba girmemiş olabilirdi — ya da tersi.
 *
 * ⚠️ KISMİ TAHSİLAT YOKTUR. Tahsil edilen tutar HER ZAMAN siparişin tam
 * satış bedelidir. Kısmi tahsilat gerekiyorsa doğru yol, siparişi iki
 * satıra bölmektir — yarım tutarı "ödendi" saymak, kalanın ne olduğunu
 * hiçbir yerde göstermezdi.
 *
 * ⚠️ ÇİFT TAHSİLAT ENGELLİ. `paidAt` doluysa reddedilir; ayrıca
 * `paymentEntryId` veritabanında TEKİLDİR, yani aynı hareket iki siparişe
 * bağlanamaz.
 */
export async function collectOrderPayment(params: {
  orderId: string
  accountId: string
  occurredAt: Date
  createdById?: string | null
}) {
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, params.orderId)
    if (!order) throw new KasaError('NOT_FOUND', 'Sipariş bulunamadı.', 404)
    if (order.paidAt) throw new KasaError('ALREADY_PAID', 'Bu siparişin ödemesi zaten alınmış.')
    if (order.status === 'IPTAL') {
      throw new KasaError('CANCELED', 'İptal edilmiş sipariş tahsil edilemez.')
    }

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
        //    parasının gelmesi içindir. Sipariş ilk kez burada sayılır.
        category: 'SATIS',
        amountMinor: order.salePriceMinor,
        // ⚠️ İçerik hareketin açıklamasına da yazılır: kasa dökümünde
        //    "Sipariş — @ali" değil, ne satıldığı görünür.
        description: `${order.description} — ${order.customerName}`,
        customerHandle: order.customerName,
        // ⚠️ Maliyet BURAYA yazılmaz: siparişin kârı zaten sipariş kaydında
        //    hesaplanıyor. Buraya da yazmak aynı maliyeti iki kez düşerdi.
        createdById: params.createdById ?? null,
      },
    })

    return tx.manualOrder.update({
      where: { id: params.orderId },
      data: { paidAt: dayStartUtc(params.occurredAt), paymentEntryId: entry.id },
    })
  })
}

/**
 * Siparişin maliyetini GERÇEK bir kasa çıkışına dönüştürür.
 *
 * ⚠️ İSTEĞE BAĞLIDIR. Maliyet sipariş kaydında zaten kâr hesabına giriyor;
 * bu işlem yalnızca parayı fiilen ödediğinde banka bakiyesinin de düşmesi
 * için yapılır. Zorunlu tutulsaydı, henüz ödenmemiş bir tedarikçi borcu
 * bakiyeden düşülmüş görünürdü.
 */
export async function recordOrderCostExpense(params: {
  orderId: string
  accountId: string
  occurredAt: Date
  createdById?: string | null
}) {
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, params.orderId)
    if (!order) throw new KasaError('NOT_FOUND', 'Sipariş bulunamadı.', 404)
    if (order.costEntryId) {
      throw new KasaError('ALREADY_RECORDED', 'Bu siparişin maliyeti zaten işlendi.')
    }
    if (order.costMinor <= 0) throw new KasaError('NO_COST', 'Siparişte maliyet girilmemiş.')

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
        amountMinor: order.costMinor,
        description: `Maliyet — ${order.description} · ${order.customerName}`,
        createdById: params.createdById ?? null,
      },
    })

    return tx.manualOrder.update({
      where: { id: params.orderId },
      data: { costEntryId: entry.id },
    })
  })
}

/**
 * İŞ durumunu değiştirir.
 *
 * ⚠️ ÖDEME DURUMUNA DOKUNMAZ. "Tamamlandı" işaretlemek parayı geldi
 * saymaz; tahsilat ayrı bir işlemdir. Aksi hâlde işi bitirmek banka
 * bakiyesini artırırdı ve bakiye, gelmemiş parayı içerirdi.
 *
 * ⚠️ TAHSİL EDİLMİŞ SİPARİŞ "İPTAL"E ÇEKİLEBİLİR ama KASA HAREKETİ
 * KENDİLİĞİNDEN SİLİNMEZ. Para gerçekten geldiyse iade ayrı bir harekettir
 * ve elle girilir — kaydı sessizce yok etmek, bankada duran parayı defterde
 * yok saymak olurdu. Ekranda bu uyarı yazılıdır.
 */
export async function setOrderStatus(orderId: string, status: ManualOrderStatus) {
  const order = await db.manualOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new KasaError('NOT_FOUND', 'Sipariş bulunamadı.', 404)

  return db.manualOrder.update({ where: { id: orderId }, data: { status } })
}

/**
 * ⚠️ GERÇEK SİLME — ama yalnızca kasaya hareket yazılmamışsa.
 *
 * Yanlış girilen bir satır defterde kalmamalı, bu yüzden silme gerçekten
 * siler. Ancak gelir veya gider hareketi oluşmuş bir siparişi silmek o
 * parayı ÖKSÜZ bırakır: hareket defterde durur, hangi işe ait olduğu bir
 * daha bilinemez ve bakiye açıklanamaz hâle gelir.
 *
 * ⚠️ BURADAKİ KONTROL TEK BAŞINA YETMEZ ve yetmediği için veritabanında
 * da bir tetikleyici var. Bu kontrol yalnızca kullanıcıya ANLAŞILIR bir
 * mesaj vermek içindir; uygulama katmanı atlanabilir, tetikleyici
 * atlanamaz.
 */
export async function deleteOrder(orderId: string) {
  const order = await db.manualOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new KasaError('NOT_FOUND', 'Sipariş bulunamadı.', 404)

  if (order.paymentEntryId || order.costEntryId) {
    throw new KasaError(
      'HAS_CASH_ENTRY',
      'Kasaya hareket yazılmış sipariş silinemez. Önce ilgili kasa hareketini kaldırın.',
    )
  }

  await db.manualOrder.delete({ where: { id: orderId } })
  return { id: orderId }
}

/**
 * Beklenen ödeme gününü yazar ya da siler.
 *
 * ⚠️ TAHSİL EDİLMİŞ SİPARİŞE VADE YAZILMAZ. Para gelmişken "12 Eylül'de
 * bekleniyor" demek, ana sayfadaki alacak listesine tahsil edilmiş bir işi
 * koymak olurdu; toplam alacak olduğundan yüksek görünür ve o rakama
 * bakarak verilen her karar yanlış olurdu.
 */
export async function setOrderDueDate(orderId: string, dueDate: Date | null) {
  const order = await db.manualOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new KasaError('NOT_FOUND', 'Sipariş bulunamadı.', 404)
  if (order.paidAt && dueDate) {
    throw new KasaError(
      'ALREADY_PAID',
      'Bu siparişin ödemesi alınmış; beklenen ödeme tarihi yazılamaz.',
    )
  }

  return db.manualOrder.update({
    where: { id: orderId },
    data: { dueDate: dueDate ? dayStartUtc(dueDate) : null },
  })
}

// ---------------------------------------------------------------------------
// "ÖDEME" KUTUSU
// ---------------------------------------------------------------------------

/**
 * Ödeme kutusuna yazılanı çözer: tarih mi, hesap adı mı?
 *
 * ⚠️ HESAP LİSTESİ HER ÇÖZÜMLEMEDE VERİTABANINDAN OKUNUR, önbelleğe
 * alınmaz. Yeni açılan bir hesabın adı ilk denemede tanınmalı; "biraz
 * bekle, önbellek yenilensin" diye bir kural kullanıcıya anlatılamaz.
 */
export async function cozumleOdeme(raw: string): Promise<OdemeGirdisi> {
  const accounts = await db.cashAccount.findMany({
    where: { isActive: true },
    select: { id: true, name: true, owner: true },
    orderBy: [{ owner: 'asc' }, { name: 'asc' }],
  })
  return odemeCozumle(
    raw,
    accounts.map((a) => ({ id: a.id, name: a.name, label: `${a.owner} · ${a.name}` })),
  )
}

/**
 * Çözülmüş ödeme girdisini bir siparişe uygular.
 *
 * ⚠️⚠️ İKİ SONUÇ BİRBİRİNİN YERİNE GEÇMEZ:
 *   tarih  → hiçbir kasa hareketi YAZILMAZ, yalnızca beklenen gün işaretlenir
 *   hesap  → gerçek bir gelir hareketi yazılır ve BANKA BAKİYESİ ARTAR
 *
 * Yanlış dalın çalışması, ya gelmemiş parayı bakiyeye eklemek ya da gelmiş
 * parayı hiç görmemek demektir. Ayrım `odemeCozumle` içinde kesin kurallara
 * bağlandı; burada tahmin yapılmaz.
 */
export async function uygulaOdeme(params: {
  orderId: string
  girdi: OdemeGirdisi
  bugun: Date
  createdById?: string | null
}) {
  const { girdi } = params
  if (girdi.kind === 'gecersiz') throw new KasaError('ODEME_ANLASILMADI', girdi.message)
  if (girdi.kind === 'bos') {
    await setOrderDueDate(params.orderId, null)
    return { kind: 'bos' as const }
  }
  if (girdi.kind === 'tarih') {
    await setOrderDueDate(params.orderId, girdi.date)
    return { kind: 'tarih' as const, date: girdi.date }
  }

  await collectOrderPayment({
    orderId: params.orderId,
    accountId: girdi.accountId,
    occurredAt: params.bugun,
    createdById: params.createdById ?? null,
  })
  /**
   * ⚠️ TAHSİL EDİLİNCE BEKLENEN TARİH SİLİNİR. Kalsaydı ana sayfadaki
   * alacak listesi bu satırı filtreliyor olsa bile, düzenleme ekranında
   * "beklenen ödeme: 12.09" yazmaya devam eder ve ödenmiş bir işin hâlâ
   * beklendiği izlenimini verirdi.
   */
  await db.manualOrder.update({ where: { id: params.orderId }, data: { dueDate: null } })
  return { kind: 'hesap' as const, accountLabel: girdi.accountLabel }
}
