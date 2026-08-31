/**
 * ⭐ AYLIK MÜŞTERİ PAKETLERİ — SAF MANTIK
 *
 * Bu bir ABONELİK SİSTEMİ DEĞİLDİR ve öyle olmamalıdır.
 *   · Otomatik yenileme YOK
 *   · Otomatik tahakkuk YOK
 *   · Süre bitince yeni kayıt üretilmez
 * Süresi dolan paket yalnızca "süresi doldu" olarak GÖSTERİLİR. Yenileme,
 * operatörün elle açtığı yeni bir kayıttır.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ DURUM SAKLANMAZ, TARİHLERDEN TÜRETİLİR.
 *
 * Veritabanında "aktif / süresi doldu" diye bir alan YOKTUR. Saklansaydı
 * bayatlardı: o değeri gece yarısı çevirecek bir zamanlanmış iş yok ve
 * bilinçli olarak da istenmiyor. Sonuç, süresi üç hafta önce dolmuş bir
 * paketin ekranda "aktif" görünmesi olurdu — kimse hata almaz, tablo
 * sessizce yanlış olur.
 *
 * Türetilmiş durum her sorguda doğrudur ve düzeltilmesi gereken bir kayıt
 * yoktur.
 *
 * ⚠️ TEK İSTİSNA: İPTAL. O bir tarihten çıkmaz, operatörün verdiği bir
 * karardır; bu yüzden `canceledAt` saklanır ve diğer tüm durumları ezer.
 *
 * ⚠️ BENZER ŞEKİLDE "ÖDENDİ" DE AYRI BİR ALAN DEĞİLDİR: `paidAt` doludur
 * ya da değildir. İkisini ayrı tutmak (bir `isPaid` bayrağı + bir tarih)
 * er geç ayrışır — bayrak true, tarih boş kalır ve hangisinin doğru
 * olduğu bilinemez.
 */

/**
 * ⚠️⚠️ BUGÜN, İSTANBUL TAKVİMİNE GÖRE — SUNUCUNUN UTC GÜNÜNE GÖRE DEĞİL.
 *
 * Bir denetimde kanıtlandı: sunucu UTC'de çalışıyor, operatör Türkiye'de
 * (UTC+3). Her gün saat 21:00–24:00 arasında sunucu HÂLÂ ÖNCEKİ GÜNDE
 * oluyor. 2 Ekim gece 01:00'de bakan biri, 1 Ekim'de biten paketi "süresi
 * doldu" yerine "bitiyor" olarak görüyordu.
 *
 * Hata günde üç saat boyunca aktif ve tamamen sessiz: ekran makul bir durum
 * gösteriyor, sadece bir gün geride. Yenileme konuşmasını bir gün geç
 * başlatmak, aylık bir pakette gerçek para kaybıdır.
 *
 * ⚠️ SABİT +3 SAAT EKLENMEZ. Türkiye kalıcı UTC+3 kullanıyor ama bunu koda
 * gömmek, kural değişirse sessizce yanlışa döner. `Intl` üzerinden IANA
 * bölgesi sorulur — kuralı işletim sisteminin saat dilimi veritabanı bilir.
 */
export const OPERATOR_TIME_ZONE = 'Europe/Istanbul'

const ISTANBUL_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPERATOR_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Operatörün takvimindeki bugünün gün başlangıcı (UTC olarak temsil edilir). */
export function todayForOperator(now: Date = new Date()): Date {
  // en-CA biçimi "YYYY-MM-DD" verir — ayrıştırması güvenlidir.
  return new Date(`${ISTANBUL_DAY.format(now)}T00:00:00Z`)
}

export type PackageState =
  /** Başlangıç tarihi henüz gelmedi */
  | 'PLANLANDI'
  | 'AKTIF'
  /** Bitişine az kaldı — dashboard'da uyarı */
  | 'BITIYOR'
  | 'SURESI_DOLDU'
  | 'IPTAL'

export interface PackageLike {
  customerName: string
  startDate: Date
  endDate: Date
  salePriceMinor: number
  costMinor: number
  canceledAt: Date | null
  paidAt: Date | null
}

/** Gün başına indirger — saat farkı durum kararını değiştirmemeli. */
function day(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * ⚠️ "YAKINDA BİTİYOR" EŞİĞİ. 7 gün, çünkü aylık bir pakette yenileme
 * konuşmasını başlatmak için makul en kısa süre budur. Daha kısası
 * (2-3 gün) müşteriye dönmek için zaman bırakmaz.
 */
export const EXPIRY_WARNING_DAYS = 7

/**
 * Paketin O ANKİ durumu.
 *
 * ⚠️ SIRALAMA ÖNEMLİ: iptal her şeyi ezer. İptal edilmiş bir paket, bitiş
 * tarihi gelecekte olsa bile "aktif" sayılmamalıdır — aksi hâlde iptal
 * edilen iş ciro tahmininde görünmeye devam ederdi.
 */
export function derivePackageState(
  pkg: Pick<PackageLike, 'startDate' | 'endDate' | 'canceledAt'>,
  today: Date,
  warningDays: number = EXPIRY_WARNING_DAYS,
): PackageState {
  if (pkg.canceledAt) return 'IPTAL'

  const t = day(today)
  const start = day(pkg.startDate)
  const end = day(pkg.endDate)

  if (t < start) return 'PLANLANDI'
  // ⚠️ Bitiş günü DAHİLDİR: "1 Eylül – 1 Ekim" paketinde 1 Ekim hâlâ
  //    hizmet günüdür. `t > end` yazılması gerekiyor, `t >= end` değil.
  if (t > end) return 'SURESI_DOLDU'

  const daysLeft = Math.round((end - t) / 86_400_000)
  return daysLeft <= warningDays ? 'BITIYOR' : 'AKTIF'
}

/** Kalan gün sayısı (bitiş günü dahil). Süresi dolmuşsa negatif. */
export function daysRemaining(pkg: Pick<PackageLike, 'endDate'>, today: Date): number {
  return Math.round((day(pkg.endDate) - day(today)) / 86_400_000)
}

/**
 * ⚠️ NET KÂR SAKLANMAZ, HESAPLANIR.
 * Saklansaydı satış veya maliyet düzeltildiğinde güncellenmeyi unutabilir
 * ve üç alan birbiriyle çelişirdi.
 */
export function netProfitMinor(pkg: Pick<PackageLike, 'salePriceMinor' | 'costMinor'>): number {
  return pkg.salePriceMinor - pkg.costMinor
}

// ---------------------------------------------------------------------------
// ÖZET
// ---------------------------------------------------------------------------

export interface PackageSummary {
  /** Seçili ayda BAŞLAYAN paketler (bkz. aşağıdaki not) */
  monthCount: number
  monthSaleMinor: number
  monthCostMinor: number
  monthNetMinor: number

  /** "Şu an" durumları — aya bağlı DEĞİL */
  activeCount: number
  endingSoonCount: number
  expiredCount: number
  canceledCount: number
}

/**
 * ⚠️ AYLIK TOPLAMLAR **BAŞLANGIÇ TARİHİNE** GÖRE HESAPLANIR.
 *
 * Alternatif "o ayla kesişen paketler" olurdu; ama 1 Eylül – 1 Ekim
 * arası 15.000 ₺'lik bir paket hem eylülde hem ekimde tam 15.000 ₺
 * sayılırdı ve yıllık toplam gerçeğin iki katı çıkardı. Başlangıç
 * tarihine göre saymak her paketi TAM BİR KEZ sayar.
 *
 * ⚠️ DURUM SAYAÇLARI ("aktif", "bitiyor") AYA BAĞLI DEĞİLDİR. "Şu anda kaç
 * aktif paketim var?" sorusunun cevabı hangi aya baktığınla değişmez.
 */
export function summarize(
  packages: readonly PackageLike[],
  today: Date,
  month: { year: number; month1: number },
): PackageSummary {
  const monthStart = Date.UTC(month.year, month.month1 - 1, 1)
  const monthEnd = Date.UTC(month.year, month.month1, 1)

  let monthCount = 0
  let monthSaleMinor = 0
  let monthCostMinor = 0
  let activeCount = 0
  let endingSoonCount = 0
  let expiredCount = 0
  let canceledCount = 0

  for (const p of packages) {
    const s = day(p.startDate)
    if (s >= monthStart && s < monthEnd) {
      monthCount += 1
      /**
       * ⚠️ İPTAL EDİLEN PAKET AYLIK CİROYA GİRMEZ. Girseydi, iptal edilen
       * işin parası kazanılmış gibi görünürdü.
       */
      if (!p.canceledAt) {
        monthSaleMinor += p.salePriceMinor
        monthCostMinor += p.costMinor
      }
    }

    switch (derivePackageState(p, today)) {
      case 'AKTIF':
        activeCount += 1
        break
      case 'BITIYOR':
        // ⚠️ "Bitiyor" da AKTİF bir pakettir — hizmet hâlâ veriliyor.
        //    Ayrıca sayılır ki uyarı listesi boş kalmasın.
        activeCount += 1
        endingSoonCount += 1
        break
      case 'SURESI_DOLDU':
        expiredCount += 1
        break
      case 'IPTAL':
        canceledCount += 1
        break
      default:
        break // PLANLANDI — henüz başlamadı
    }
  }

  return {
    monthCount,
    monthSaleMinor,
    monthCostMinor,
    monthNetMinor: monthSaleMinor - monthCostMinor,
    activeCount,
    endingSoonCount,
    expiredCount,
    canceledCount,
  }
}

// ---------------------------------------------------------------------------
// YENİLEME
// ---------------------------------------------------------------------------

export interface RetentionRow {
  customerName: string
  /** Müşterinin en son biten paketinin bitiş tarihi */
  lastEndDate: Date
  renewed: boolean
}

/**
 * ⚠️ YENİLEME **ÇIKARIMDIR**, KAYDEDİLMİŞ BİR GERÇEK DEĞİL.
 *
 * Otomatik yenileme olmadığı için sistemde "bu paket şunun devamıdır"
 * diyen bir bağ yok. Kural açıkça şudur ve ekranda da yazar:
 *
 *   Süresi dolmuş bir paketin müşterisi için, o paketin BİTİŞ TARİHİNDEN
 *   SONRA (veya aynı gün) başlayan başka bir paket varsa müşteri
 *   YENİLENMİŞ sayılır.
 *
 * ⚠️ MÜŞTERİ BAZINDA, HİZMET BAZINDA DEĞİL. Panelde sorulan şey "yenilenen
 * müşteriler"dir: müşteri farklı bir hizmete geçtiyse de elde tutulmuştur.
 *
 * ⚠️ İPTAL EDİLEN PAKET YENİLEME SAYILMAZ — ne kendisi (iptal edilmiş bir
 * paket "devam etti" demek değildir) ne de yenileyen taraf olarak.
 */
export function retention(packages: readonly PackageLike[], today: Date): RetentionRow[] {
  const byCustomer = new Map<string, PackageLike[]>()
  for (const p of packages) {
    const key = p.customerName.trim().toLocaleLowerCase('tr-TR')
    const list = byCustomer.get(key) ?? []
    list.push(p)
    byCustomer.set(key, list)
  }

  const rows: RetentionRow[] = []
  for (const list of byCustomer.values()) {
    const expired = list
      .filter((p) => derivePackageState(p, today) === 'SURESI_DOLDU')
      .sort((a, b) => day(b.endDate) - day(a.endDate))
    const last = expired[0]
    if (!last) continue // hiç süresi dolmuş paketi yok → yenileme sorusu doğmaz

    const renewed = list.some(
      (p) => p !== last && !p.canceledAt && day(p.startDate) >= day(last.endDate),
    )
    rows.push({ customerName: last.customerName, lastEndDate: last.endDate, renewed })
  }

  return rows.sort((a, b) => day(b.lastEndDate) - day(a.lastEndDate))
}
