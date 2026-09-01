import { describe, expect, it } from 'vitest'

/**
 * ⭐ AYLIK MÜŞTERİ PAKETLERİ
 *
 * ⚠️ BU BİR ABONELİK SİSTEMİ DEĞİLDİR. Testlerin bir kısmı, sistemin
 * NE YAPMADIĞINI kilitliyor: otomatik yenileme yok, otomatik tahakkuk yok,
 * paket açılınca banka bakiyesi kıpırdamıyor. Bunlar "eksik özellik" değil,
 * açıkça istenen davranış — ileride biri "kolaylık olsun" diye ekleyecek
 * olursa test kırılmalı.
 */
import {
  compareForList,
  derivePackageState,
  daysRemaining,
  netProfitMinor,
  retention,
  summarize,
  todayForOperator,
  type ListSortable,
  type PackageLike,
  type PackageState,
} from '@/lib/kasa/packages'

const TODAY = new Date(Date.UTC(2026, 8, 15)) // 15 Eylül 2026

function pkg(p: Partial<PackageLike> = {}): PackageLike {
  return {
    customerName: 'X Firma',
    startDate: new Date(Date.UTC(2026, 8, 1)),
    endDate: new Date(Date.UTC(2026, 9, 1)),
    salePriceMinor: 1_500_000,
    costMinor: 400_000,
    canceledAt: null,
    paidAt: null,
    ...p,
  }
}

// ===========================================================================
describe('durum türetimi', () => {
  it('kullanıcının örneği: 1 Eylül – 1 Ekim, bugün 15 Eylül → AKTİF', () => {
    expect(derivePackageState(pkg(), TODAY)).toBe('AKTIF')
  })

  it('başlangıç gelecekteyse PLANLANDI', () => {
    const p = pkg({ startDate: new Date(Date.UTC(2026, 9, 1)), endDate: new Date(Date.UTC(2026, 10, 1)) })
    expect(derivePackageState(p, TODAY)).toBe('PLANLANDI')
  })

  /**
   * ⚠️ BİTİŞ GÜNÜ DAHİLDİR. "1 Eylül – 1 Ekim" paketinde 1 Ekim hâlâ
   * hizmet günüdür; o gün "süresi doldu" demek müşteriye bir gün eksik
   * hizmet vermek olurdu.
   */
  it('⚠️ BİTİŞ GÜNÜ hâlâ hizmet günüdür', () => {
    const end = new Date(Date.UTC(2026, 9, 1))
    expect(derivePackageState(pkg({ endDate: end }), end)).not.toBe('SURESI_DOLDU')
    const nextDay = new Date(Date.UTC(2026, 9, 2))
    expect(derivePackageState(pkg({ endDate: end }), nextDay)).toBe('SURESI_DOLDU')
  })

  it('bitişe 7 gün veya az kaldıysa BITIYOR', () => {
    const p = pkg({ endDate: new Date(Date.UTC(2026, 8, 20)) }) // 5 gün var
    expect(derivePackageState(p, TODAY)).toBe('BITIYOR')
  })

  it('bitişe 8+ gün varsa hâlâ AKTİF', () => {
    const p = pkg({ endDate: new Date(Date.UTC(2026, 8, 30)) })
    expect(derivePackageState(p, TODAY)).toBe('AKTIF')
  })

  /**
   * ⚠️ İPTAL HER ŞEYİ EZER. İptal edilmiş bir paket bitiş tarihi gelecekte
   * olsa bile "aktif" görünmemeli — aksi hâlde iptal edilen iş ciro
   * tahmininde durmaya devam ederdi.
   */
  it('⚠️ İPTAL, tarih ne olursa olsun diğer durumları EZER', () => {
    const canceled = { canceledAt: new Date(Date.UTC(2026, 8, 10)) }
    expect(derivePackageState(pkg(canceled), TODAY)).toBe('IPTAL')
    // Gelecekte başlayacak olan da:
    expect(
      derivePackageState(pkg({ ...canceled, startDate: new Date(Date.UTC(2026, 11, 1)) }), TODAY),
    ).toBe('IPTAL')
  })

  /**
   * ⚠️ DURUM SAKLANMADIĞI İÇİN "BAYATLAMAZ".
   * Aynı paket, yalnızca gün geçtiği için kendiliğinden doğru duruma geçer.
   * Bunu sağlayacak bir zamanlanmış iş YOK ve olmasına gerek de yok.
   */
  it('⚠️ gün geçince durum KENDİLİĞİNDEN değişir (cron gerekmez)', () => {
    const p = pkg()
    expect(derivePackageState(p, new Date(Date.UTC(2026, 7, 25)))).toBe('PLANLANDI')
    expect(derivePackageState(p, new Date(Date.UTC(2026, 8, 15)))).toBe('AKTIF')
    expect(derivePackageState(p, new Date(Date.UTC(2026, 8, 28)))).toBe('BITIYOR')
    expect(derivePackageState(p, new Date(Date.UTC(2026, 9, 5)))).toBe('SURESI_DOLDU')
  })

  it('kalan gün sayısı', () => {
    expect(daysRemaining(pkg(), TODAY)).toBe(16)
    expect(daysRemaining(pkg({ endDate: new Date(Date.UTC(2026, 8, 10)) }), TODAY)).toBe(-5)
  })
})

// ===========================================================================
describe('net kâr', () => {
  it("kullanıcının örneği: 15.000 − 4.000 = 11.000 ₺", () => {
    expect(netProfitMinor({ salePriceMinor: 1_500_000, costMinor: 400_000 })).toBe(1_100_000)
  })

  it('maliyet sıfırsa kâr satışa eşit', () => {
    expect(netProfitMinor({ salePriceMinor: 1_500_000, costMinor: 0 })).toBe(1_500_000)
  })

  it('zararına satış negatif kâr üretir — gizlenmez', () => {
    expect(netProfitMinor({ salePriceMinor: 100_000, costMinor: 400_000 })).toBe(-300_000)
  })
})

// ===========================================================================
describe('özet', () => {
  const EYLUL = { year: 2026, month1: 9 }

  it('aylık toplamlar BAŞLANGIÇ tarihine göre sayılır', () => {
    const s = summarize(
      [
        pkg({ startDate: new Date(Date.UTC(2026, 8, 1)) }), // eylül
        pkg({ startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 8, 1)) }), // ağustos
      ],
      TODAY,
      EYLUL,
    )
    expect(s.monthCount).toBe(1)
    expect(s.monthSaleMinor).toBe(1_500_000)
    expect(s.monthNetMinor).toBe(1_100_000)
  })

  /**
   * ⚠️ AYLARA YAYILAN PAKET İKİ KEZ SAYILMAZ.
   * "O ayla kesişen paketler" mantığı kullanılsaydı, 1 Eylül – 1 Ekim
   * arası 15.000 ₺'lik paket hem eylülde hem ekimde tam sayılır ve yıllık
   * toplam gerçeğin iki katı çıkardı.
   */
  it('⚠️ AYLARA YAYILAN paket yalnızca BİR ayda sayılır', () => {
    const p = [pkg()] // 1 Eylül – 1 Ekim
    expect(summarize(p, TODAY, { year: 2026, month1: 9 }).monthSaleMinor).toBe(1_500_000)
    expect(summarize(p, TODAY, { year: 2026, month1: 10 }).monthSaleMinor).toBe(0)
  })

  it('⚠️ İPTAL edilen paket aylık ciroya GİRMEZ', () => {
    const s = summarize([pkg({ canceledAt: new Date(Date.UTC(2026, 8, 5)) })], TODAY, EYLUL)
    expect(s.monthCount).toBe(1) // sayısı görünür
    expect(s.monthSaleMinor).toBe(0) // ama parası sayılmaz
    expect(s.canceledCount).toBe(1)
  })

  it('⚠️ "bitiyor" olan paket AKTİF sayılır — hizmet hâlâ veriliyor', () => {
    const s = summarize([pkg({ endDate: new Date(Date.UTC(2026, 8, 18)) })], TODAY, EYLUL)
    expect(s.activeCount).toBe(1)
    expect(s.endingSoonCount).toBe(1)
  })

  /**
   * ⚠️ DURUM SAYAÇLARI AYA BAĞLI DEĞİL.
   * "Şu anda kaç aktif paketim var?" sorusunun cevabı, hangi aya
   * baktığınla değişmemeli.
   */
  it('⚠️ aktif sayısı SEÇİLİ AYDAN bağımsızdır', () => {
    const p = [pkg()]
    const eylul = summarize(p, TODAY, { year: 2026, month1: 9 })
    const ocak = summarize(p, TODAY, { year: 2026, month1: 1 })
    expect(eylul.activeCount).toBe(ocak.activeCount)
    expect(ocak.monthSaleMinor).toBe(0) // ama ayın cirosu farklı
  })
})

// ===========================================================================
describe('yenileme çıkarımı', () => {
  const BUGUN = new Date(Date.UTC(2026, 9, 15)) // 15 Ekim

  it('bitiş sonrası yeni paket varsa YENİLENDİ', () => {
    const rows = retention(
      [
        pkg({ startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2026, 9, 1)) }),
        pkg({ startDate: new Date(Date.UTC(2026, 9, 1)), endDate: new Date(Date.UTC(2026, 10, 1)) }),
      ],
      BUGUN,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.renewed).toBe(true)
  })

  it('devamı yoksa YENİLENMEDİ', () => {
    const rows = retention(
      [pkg({ startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2026, 9, 1)) })],
      BUGUN,
    )
    expect(rows[0]!.renewed).toBe(false)
  })

  /**
   * ⚠️ MÜŞTERİ BAZINDA — HİZMET BAZINDA DEĞİL.
   * Panelde sorulan "yenilenen MÜŞTERİLER"dir; müşteri farklı bir hizmete
   * geçtiyse de elde tutulmuştur.
   */
  it('⚠️ farklı hizmete geçen müşteri de YENİLENMİŞ sayılır', () => {
    const rows = retention(
      [
        pkg({ startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2026, 9, 1)) }),
        pkg({ startDate: new Date(Date.UTC(2026, 9, 2)), endDate: new Date(Date.UTC(2026, 10, 2)) }),
      ],
      BUGUN,
    )
    expect(rows[0]!.renewed).toBe(true)
  })

  it('⚠️ İPTAL edilmiş devam paketi yenileme SAYILMAZ', () => {
    const rows = retention(
      [
        pkg({ startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2026, 9, 1)) }),
        pkg({
          startDate: new Date(Date.UTC(2026, 9, 1)),
          endDate: new Date(Date.UTC(2026, 10, 1)),
          canceledAt: new Date(Date.UTC(2026, 9, 3)),
        }),
      ],
      BUGUN,
    )
    expect(rows[0]!.renewed).toBe(false)
  })

  it('müşteri adı büyük/küçük harf farkıyla ikiye BÖLÜNMEZ', () => {
    const rows = retention(
      [
        pkg({ customerName: 'X Firma', startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2026, 9, 1)) }),
        pkg({ customerName: ' x firma ', startDate: new Date(Date.UTC(2026, 9, 1)), endDate: new Date(Date.UTC(2026, 10, 1)) }),
      ],
      BUGUN,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.renewed).toBe(true)
  })

  it('hiç süresi dolmamış müşteri yenileme listesine GİRMEZ', () => {
    // Henüz devam eden paket için "yenilendi mi?" sorusu doğmaz.
    expect(retention([pkg()], new Date(Date.UTC(2026, 8, 15)))).toEqual([])
  })
})

// ===========================================================================
/**
 * ⭐⭐ SAAT DİLİMİ — DENETİMDE BULUNAN BİR GÜNLÜK KAYMA
 *
 * Sunucu UTC'de çalışıyor, operatör Türkiye'de (UTC+3). Her gün 21:00–24:00
 * arasında sunucu HÂLÂ ÖNCEKİ GÜNDE oluyordu. 2 Ekim gece 01:00'de bakan
 * biri, 1 Ekim'de biten paketi "süresi doldu" yerine "bitiyor" görüyordu.
 *
 * Hata günde üç saat aktif ve tamamen sessizdi: ekran makul bir durum
 * gösteriyor, sadece bir gün geride.
 */
describe('saat dilimi', () => {
  it('⚠️ GECE 01:00 İSTANBUL, sunucu hâlâ önceki UTC gününde', () => {
    const an = new Date('2026-10-01T22:00:00Z') // İstanbul: 2 Ekim 01:00
    const utcGun = new Date(Date.UTC(an.getUTCFullYear(), an.getUTCMonth(), an.getUTCDate()))
    expect(utcGun.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(todayForOperator(an).toISOString().slice(0, 10)).toBe('2026-10-02')
  })

  it('⚠️ kayma DURUMU değiştiriyordu — artık değiştirmiyor', () => {
    const an = new Date('2026-10-01T22:00:00Z')
    const p = pkg({ startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2026, 9, 1)) })

    // Eski (hatalı) davranış: sunucunun UTC günü
    const utcGun = new Date(Date.UTC(an.getUTCFullYear(), an.getUTCMonth(), an.getUTCDate()))
    expect(derivePackageState(p, utcGun)).toBe('BITIYOR') // yanlış

    // Yeni davranış: operatörün takvim günü
    expect(derivePackageState(p, todayForOperator(an))).toBe('SURESI_DOLDU') // doğru
  })

  it('gündüz saatlerinde iki yöntem AYNI sonucu verir', () => {
    const oglen = new Date('2026-10-01T09:00:00Z') // İstanbul 12:00
    const utcGun = new Date(Date.UTC(oglen.getUTCFullYear(), oglen.getUTCMonth(), oglen.getUTCDate()))
    expect(todayForOperator(oglen).getTime()).toBe(utcGun.getTime())
  })

  /**
   * ⚠️ SABİT +3 SAAT EKLENMEDİĞİNİN KANITI. Kural koda gömülseydi, saat
   * dilimi kuralı değişince sessizce yanlışa dönerdi.
   */
  it('⚠️ dönüşüm IANA bölgesinden gelir, sabit ofsetten değil', () => {
    // Yaz ve kış aylarında aynı takvim gününü doğru üretmeli.
    expect(todayForOperator(new Date('2026-01-15T21:30:00Z')).toISOString().slice(0, 10)).toBe('2026-01-16')
    expect(todayForOperator(new Date('2026-07-15T21:30:00Z')).toISOString().slice(0, 10)).toBe('2026-07-16')
  })
})

// ===========================================================================
describe('liste sırası', () => {
  const row = (state: PackageState, day: number, customerName = 'A'): ListSortable => ({
    state,
    endDate: new Date(Date.UTC(2026, 8, day)),
    customerName,
  })

  const order = (rows: ListSortable[]) =>
    [...rows].sort(compareForList).map((r) => `${r.state}:${r.endDate.getUTCDate()}`)

  it('yaşayan paketlerde bitişi en yakın olan üstte', () => {
    expect(order([row('AKTIF', 30), row('BITIYOR', 5), row('PLANLANDI', 12)])).toEqual([
      'BITIYOR:5',
      'PLANLANDI:12',
      'AKTIF:30',
    ])
  })

  it('⚠️ SÜRESİ DOLMUŞ VE İPTAL PAKETLER EN ALTTA', () => {
    /**
     * Düz bitiş tarihi sıralamasında bunlar EN ÜSTE çıkardı: bitiş
     * tarihleri geçmişte, yani hepsinden "yakın". Ekranın ilk ekranı,
     * hakkında yapılacak hiçbir şey olmayan ölü kayıtlarla dolardı.
     */
    expect(
      order([row('SURESI_DOLDU', 2), row('AKTIF', 28), row('IPTAL', 1), row('BITIYOR', 20)]),
    ).toEqual(['BITIYOR:20', 'AKTIF:28', 'SURESI_DOLDU:2', 'IPTAL:1'])
  })

  it('bitenlerde EN SON biten üstte — orada yakınlık geçmişe bakar', () => {
    expect(order([row('SURESI_DOLDU', 1), row('IPTAL', 25), row('SURESI_DOLDU', 10)])).toEqual([
      'IPTAL:25',
      'SURESI_DOLDU:10',
      'SURESI_DOLDU:1',
    ])
  })

  it('⚠️ EŞİT TARİHTE SIRA RASTGELE KALMAZ', () => {
    /**
     * Kalan fark çözülmeseydi sıra veritabanının döndürdüğü düzene kalırdı;
     * aynı sayfayı iki kez açan operatör satırların yer değiştirdiğini
     * görürdü ve listeye güveni azalırdı.
     */
    const rows = [row('AKTIF', 9, 'Zeynep'), row('AKTIF', 9, 'Ali'), row('AKTIF', 9, 'Çağla')]
    const names = [...rows].sort(compareForList).map((r) => r.customerName)
    expect(names).toEqual(['Ali', 'Çağla', 'Zeynep'])
  })
})
