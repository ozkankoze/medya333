import 'server-only'

import {
  netProfitMinor,
  paymentStateOf,
  summarizeOrders,
  type ManualOrderStatus,
  type PaymentState,
} from '@/lib/kasa/orders'
import { db } from '@/server/db'
import { dayStartUtc, KasaError } from '@/server/kasa'

/**
 * ⭐ ELLE GİRİLEN SİPARİŞ DEFTERİ — SUNUCU KATMANI
 *
 * ⚠️ SİTEDEKİ `Order` TABLOSUNA HİÇ DOKUNULMAZ. Bu modül yalnızca
 * `ManualOrder` okur ve yazar. Gerçek müşteri siparişleri
 * `/admin/fulfillment` altındadır ve oradan yönetilir.
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
  paymentEntryId: string | null
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
  paymentEntryId: string | null
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
    paymentEntryId: o.paymentEntryId,
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
           "status", "paidAt", "paymentEntryId", "costEntryId"
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
