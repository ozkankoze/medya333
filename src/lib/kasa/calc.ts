/**
 * ⭐ KASA — SAF HESAP MANTIĞI
 *
 * Bu dosya veritabanı, `env` veya Next bilmez. Sebebi tek: PARANIN
 * DOĞRULUĞU BURADA BELİRLENİYOR ve bunun canlıya çıkmadan, veritabanı
 * kurmadan test edilebilir olması gerekir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ EN ÖNEMLİ KARAR: **BAKİYE SAKLANMAZ, TÜRETİLİR.**
 *
 * Hesap tablosunda "bakiye" diye bir sütun YOKTUR ve olmamalıdır. Bakiye,
 * o hesaba ait hareketlerin toplamıdır.
 *
 * Neden? Saklanan bakiye bir kez kayarsa — çift kayıt, yarıda kalan işlem,
 * silinen satır, iki isteğin aynı anda güncellemesi — geriye dönüp hangi
 * rakamın doğru olduğunu ANLAMANIN YOLU KALMAZ. Tablo hata vermez, sadece
 * yalan söylemeye başlar ve bu genelde aylar sonra, bankayla mutabakat
 * tutmayınca fark edilir.
 *
 * Türetilmiş bakiyede her kuruşun karşılığında bir hareket satırı vardır:
 * rakam tutmuyorsa hangi satırın hatalı olduğu bulunabilir.
 *
 * ⚠️ AÇILIŞ BAKİYESİ BİR HAREKET DEĞİLDİR. Sisteme geçmeden önceki para
 * `openingBalanceMinor` alanındadır ve toplama ayrıca eklenir. Onu sahte
 * bir "giriş" hareketi olarak yazmak, gerçek bir tahsilatla karışırdı ve
 * ciro raporunu şişirirdi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ TÜM TUTARLAR TAM SAYI KURUŞ. `lib/money` ile aynı kural — float yok.
 * `amountMinor` HER ZAMAN POZİTİFTİR; yönü `direction` taşır. Negatif tutar
 * yazmak, "eksi gider" gibi çift olumsuzlamalara ve işaret hatalarına
 * kapı açardı.
 */

export type CashDirection = 'IN' | 'OUT'

export type CashCategory =
  | 'SATIS' // sipariş geliri
  | 'TAHSILAT' // alacak tahsili
  | 'GIDER' // günlük harcama
  | 'MALIYET' // tedarikçi / panel ödemesi
  | 'BORC_ODEME' // kredi, taksit
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'DIGER'

export interface CashMovement {
  accountId: string
  occurredAt: Date
  direction: CashDirection
  category: CashCategory
  /** ⚠️ HER ZAMAN POZİTİF. Yön `direction` alanındadır. */
  amountMinor: number
  /** Sipariş satırında işin bize maliyeti. Banka hareketi DEĞİLDİR — bkz. `profitOf`. */
  costMinor?: number | null
}

export interface AccountLike {
  id: string
  openingBalanceMinor: number
}

// ---------------------------------------------------------------------------
// BAKİYE
// ---------------------------------------------------------------------------

/**
 * Bir hesabın güncel bakiyesi = açılış + girenler − çıkanlar.
 *
 * ⚠️ `entries` yalnızca O HESABA ait olmalıdır; fonksiyon filtreleme yapmaz
 * çünkü sessizce yanlış hesabın hareketini toplamak, gürültüyle patlamaktan
 * daha tehlikelidir. Karışık liste veriliyorsa `balancesByAccount` kullanın.
 */
export function accountBalance(
  account: AccountLike,
  entries: readonly CashMovement[],
): number {
  let total = account.openingBalanceMinor
  for (const e of entries) {
    if (e.accountId !== account.id) {
      throw new Error(
        `accountBalance: "${account.id}" hesabına ait olmayan hareket verildi ("${e.accountId}").`,
      )
    }
    total += e.direction === 'IN' ? e.amountMinor : -e.amountMinor
  }
  return total
}

/** Karışık hareket listesinden hesap → bakiye eşlemesi. */
export function balancesByAccount(
  accounts: readonly AccountLike[],
  entries: readonly CashMovement[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of accounts) out.set(a.id, a.openingBalanceMinor)
  for (const e of entries) {
    const cur = out.get(e.accountId)
    // ⚠️ Bilinmeyen hesabın hareketi SESSİZCE YUTULMAZ. Böyle bir satır
    //    varsa veri tutarsızdır ve toplam yanlış olur; görünmesi gerekir.
    if (cur === undefined) {
      throw new Error(`balancesByAccount: tanımsız hesap "${e.accountId}".`)
    }
    out.set(e.accountId, cur + (e.direction === 'IN' ? e.amountMinor : -e.amountMinor))
  }
  return out
}

// ---------------------------------------------------------------------------
// KÂR
// ---------------------------------------------------------------------------

export interface ProfitBreakdown {
  /** SATIS + TAHSILAT girişleri */
  revenueMinor: number
  /** Satış satırlarındaki `costMinor` toplamı */
  costOfSalesMinor: number
  /** GIDER + MALIYET + BORC_ODEME çıkışları */
  expenseMinor: number
  /** revenue − costOfSales − expense */
  netMinor: number
}

/**
 * ⚠️ BAKİYE İLE KÂR AYNI ŞEY DEĞİLDİR ve karıştırılırsa iş kararları
 * yanlış verilir.
 *
 *   BAKİYE → hesapta ŞU AN duran para. Kredi taksiti düşer, alacak
 *            tahsilatı artırır. "Ödeyebilir miyim?" sorusunu cevaplar.
 *   KÂR    → işin kendisi para kazandırıyor mu. "Devam etmeli miyim?"
 *            sorusunu cevaplar.
 *
 * Bir ay bankada para birikmiş olabilir çünkü alacak tahsil edilmiştir —
 * bu kâr değildir. Ya da bankada para azalmış olabilir çünkü kredi
 * kapatılmıştır — bu zarar değildir. İki rakam ayrı hesaplanır ve ekranda
 * ayrı gösterilir.
 *
 * ⚠️ `TAHSILAT` CİROYA DAHİL DEĞİLDİR. Alacak tahsili, daha önce yapılmış
 * bir satışın parasının gelmesidir; ciroya ikinci kez yazmak satışı çift
 * saymak olurdu. Bakiyeyi artırır, kârı artırmaz.
 *
 * ⚠️ `TRANSFER_*` HİÇBİR TOPLAMA GİRMEZ. Kendi hesapların arasında para
 * taşımak ne gelir ne giderdir; iki hesabın bakiyesini değiştirir, o kadar.
 */
export function profitOf(entries: readonly CashMovement[]): ProfitBreakdown {
  let revenueMinor = 0
  let costOfSalesMinor = 0
  let expenseMinor = 0

  for (const e of entries) {
    switch (e.category) {
      case 'SATIS':
        revenueMinor += e.amountMinor
        costOfSalesMinor += e.costMinor ?? 0
        break
      case 'GIDER':
      case 'MALIYET':
      case 'BORC_ODEME':
        expenseMinor += e.amountMinor
        break
      // TAHSILAT, TRANSFER_IN, TRANSFER_OUT, DIGER → kâra girmez (bkz. üst not)
      default:
        break
    }
  }

  return {
    revenueMinor,
    costOfSalesMinor,
    expenseMinor,
    netMinor: revenueMinor - costOfSalesMinor - expenseMinor,
  }
}

// ---------------------------------------------------------------------------
// HAFTALIK DAĞILIM
// ---------------------------------------------------------------------------

export interface WeekBucket {
  /** 1..5 — tablodaki "1. Hafta" … "5. Hafta" ile birebir */
  week: number
  revenueMinor: number
  netMinor: number
}

/**
 * Ayı, tablodaki gibi 5 haftaya böler.
 *
 * ⚠️ HAFTA = AYIN GÜNÜNE GÖRE, ISO HAFTA NUMARASINA GÖRE DEĞİL.
 * Tabloda "3. Hafta" ayın 15-21'i demektir; ISO hafta numarası ise yıl
 * başından sayar ve ay ortasında değişir. ISO kullanmak, ayın ilk
 * gününün "5. hafta"ya düşmesi gibi sonuçlar üretirdi.
 *
 * Kural: 1-7 → 1, 8-14 → 2, 15-21 → 3, 22-28 → 4, 29+ → 5.
 * Böylece her ay tam 5 kova olur ve şubatta 5. kova boş kalır.
 *
 * ⚠️ TARİH YEREL AY GÜNÜNDEN OKUNUR. Sunucu UTC'de çalışsa da işlem
 * tarihini kullanıcı Türkiye takvimine göre girer; `occurredAt` bu yüzden
 * gün başlangıcına sabitlenmiş olarak saklanır (bkz. server katmanı).
 */
export function weekOfMonth(date: Date): number {
  const day = date.getUTCDate()
  return Math.min(5, Math.floor((day - 1) / 7) + 1)
}

export function weeklyBuckets(entries: readonly CashMovement[]): WeekBucket[] {
  const buckets: WeekBucket[] = [1, 2, 3, 4, 5].map((week) => ({
    week,
    revenueMinor: 0,
    netMinor: 0,
  }))

  for (const e of entries) {
    const b = buckets[weekOfMonth(e.occurredAt) - 1]!
    if (e.category === 'SATIS') {
      b.revenueMinor += e.amountMinor
      b.netMinor += e.amountMinor - (e.costMinor ?? 0)
    } else if (e.category === 'GIDER' || e.category === 'MALIYET' || e.category === 'BORC_ODEME') {
      b.netMinor -= e.amountMinor
    }
  }

  return buckets
}

// ---------------------------------------------------------------------------
// DOLAR ÇEVRİMİ
// ---------------------------------------------------------------------------

/**
 * TL kuruş → USD sent, ELLE GİRİLEN kurla.
 *
 * ⚠️ KUR DIŞ SERVİSTEN ÇEKİLMİYOR ve bu bilinçli. Canlı kur, geçmiş
 * kayıtların gösterdiği doları HER SAYFA YENİLEMESİNDE değiştirirdi:
 * dün "$25,30" yazan satır bugün "$24,80" olurdu ve hangisinin doğru
 * olduğu sorusunun cevabı olmazdı. Kuru sen belirlersin, sabit kalır.
 *
 * ⚠️ KUR 0 İSE ÇEVRİM YAPILMAZ, sıfır döndürülmez — `null` döner.
 * Sıfır göstermek "hiç kazanmadın" demektir; doğrusu "kur tanımlı değil".
 *
 * @param rateMinor 1 USD kaç KURUŞ? (43,50 ₺ → 4350)
 */
export function tlToUsdMinor(tlMinor: number, rateMinor: number): number | null {
  if (!Number.isFinite(rateMinor) || rateMinor <= 0) return null
  // kuruş → sent: (tl/100) / (rate/100) * 100 = tl * 100 / rate
  return Math.round((tlMinor * 100) / rateMinor)
}
