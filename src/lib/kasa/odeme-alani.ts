/**
 * ⭐ "ÖDEME" ALANI — TEK KUTU, İKİ ANLAM
 *
 * Sipariş defterinde ödeme sütununa ya bir TARİH ya bir HESAP ADI yazılır:
 *
 *   "12.09.2026"  → para henüz gelmedi, o gün beklenİyor  → ALACAK
 *   "yapıkredi"   → para geldi, o hesaba yazılsın         → TAHSİLAT
 *   boş           → hiçbir şey
 *
 * ⚠️⚠️ İKİSİ AYNI KUTUDA OLDUĞU İÇİN AYRIM KESİN OLMALI. Bir hesabın adı
 * kazara tarihe benzeseydi (ya da tersi) yazılan şey sessizce yanlış
 * yorumlanır ve para yanlış hesaba girerdi. Bu yüzden:
 *   · ÖNCE tarih denenir — tarih kalıpları dar ve kesindir
 *   · sonra hesap adı aranır
 *   · ikisi de tutmazsa REDDEDİLİR, tahmin edilmez
 *
 * "Tahmin etmemek" burada bilinçli: eşleşmeyen bir metni "herhalde şu
 * hesaptır" diye kabul etmek, yanlış bankaya yazılmış bir gelir demektir ve
 * bu hata ancak ay sonu mutabakatında fark edilir.
 */

export type OdemeGirdisi =
  | { kind: 'bos' }
  /** Beklenen ödeme günü — sipariş ALACAK olarak kaydedilir. */
  | { kind: 'tarih'; date: Date }
  /** Para geldi — bu hesaba gelir yazılır. */
  | { kind: 'hesap'; accountId: string; accountLabel: string }
  | { kind: 'gecersiz'; message: string }

export interface HesapSecenegi {
  id: string
  /** Hesabın adı — "Yapıkredi", "Vakıfbank", "Shopier"… */
  name: string
  /** Ekranda gösterilen tam etiket — "Özkan Köse · Vakıfbank" */
  label: string
}

/**
 * ⚠️ TÜRKÇE HARF KATLAMASI ELLE YAPILIR.
 *
 * `toLowerCase()` tek başına yetmez: "İ" harfi İngilizce yerelde "i̇"
 * (i + birleşen nokta) üretir ve "yapıkredi" ile "YAPIKREDİ" birbirini
 * tutmaz. Ayrıca kullanıcı "yapikredi" (noktasız i) ya da "vakifbank"
 * yazacaktır — bunlar da eşleşmeli.
 *
 * Bu yüzden önce Türkçe'ye özgü harfler ASCII karşılığına indirilir, sonra
 * küçültülür. Boşluk ve nokta gibi ayraçlar tamamen atılır: "yapı kredi",
 * "yapı-kredi" ve "yapıkredi" aynı şeydir.
 */
export function katla(s: string): string {
  return s
    .replace(/[İIı]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o')
    .replace(/[Çç]/g, 'c')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * ⚠️ TARİH KALIPLARI DAR TUTULUR — `new Date(metin)` KULLANILMAZ.
 *
 * `new Date("yapıkredi")` "Invalid Date" verir, orası sorun değil; asıl
 * tehlike `new Date("12")` gibi girdilerin SESSİZCE geçerli bir tarihe
 * dönüşmesidir. Tarayıcılar arasında da farklı davranır. Burada yalnızca
 * iki kalıp kabul edilir ve gün/ay sınırları ayrıca doğrulanır:
 *
 *   gg.aa.yyyy  ·  gg/aa/yyyy  ·  gg-aa-yyyy   (Türkçe yazım)
 *   yyyy-aa-gg                                  (tarih seçicinin verdiği)
 */
const TR_TARIH = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/
const ISO_TARIH = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

export function tarihCozumle(raw: string): Date | null {
  const t = raw.trim()

  let y: number, m: number, d: number
  const tr = TR_TARIH.exec(t)
  const iso = ISO_TARIH.exec(t)
  if (tr) {
    d = Number(tr[1])
    m = Number(tr[2])
    y = Number(tr[3])
  } else if (iso) {
    y = Number(iso[1])
    m = Number(iso[2])
    d = Number(iso[3])
  } else {
    return null
  }

  /**
   * ⚠️ TAŞAN GÜN REDDEDİLİR, KAYDIRILMAZ. `Date.UTC(2026, 1, 31)` hata
   * vermez — sessizce 3 Mart'a kayar. "31.02.2026" yazan biri, bir ay
   * sonra ana sayfada hiç beklemediği bir tarih görürdü.
   */
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null

  return date
}

export function odemeCozumle(raw: string, hesaplar: readonly HesapSecenegi[]): OdemeGirdisi {
  const t = raw.trim()
  if (!t) return { kind: 'bos' }

  const date = tarihCozumle(t)
  if (date) return { kind: 'tarih', date }

  const aranan = katla(t)
  if (!aranan) return { kind: 'bos' }

  /**
   * ⚠️ ÖNCE TAM EŞLEŞME, SONRA BAŞLANGIÇ EŞLEŞMESİ.
   *
   * "ak" yazıldığında "Akbank" bulunur ama iki hesap birden "ak" ile
   * başlıyorsa hangisi olduğu belirsizdir. Belirsizliği tahminle
   * kapatmak yerine reddediyoruz — yanlış hesaba yazılan bir gelir,
   * yazılmamış bir gelirden daha zor fark edilir.
   */
  const tam = hesaplar.filter((h) => katla(h.name) === aranan)
  if (tam.length === 1) return { kind: 'hesap', accountId: tam[0]!.id, accountLabel: tam[0]!.label }

  const bas = hesaplar.filter((h) => katla(h.name).startsWith(aranan))
  if (bas.length === 1) return { kind: 'hesap', accountId: bas[0]!.id, accountLabel: bas[0]!.label }

  if (bas.length > 1) {
    return {
      kind: 'gecersiz',
      message: `"${t}" birden fazla hesaba uyuyor: ${bas.map((h) => h.name).join(', ')}. Tam adını yazın.`,
    }
  }

  return {
    kind: 'gecersiz',
    message:
      `"${t}" ne tarih ne de hesap adı. Ödeme bekliyorsan tarih yaz (12.09.2026), ` +
      `para geldiyse hesap adı yaz (${hesaplar.map((h) => h.name).join(', ') || 'önce hesap ekleyin'}).`,
  }
}
