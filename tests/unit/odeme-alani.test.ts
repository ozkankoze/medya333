import { describe, expect, it } from 'vitest'
import { katla, odemeCozumle, tarihCozumle, type HesapSecenegi } from '@/lib/kasa/odeme-alani'

/**
 * ⭐ "ÖDEME" ALANI — TEK KUTU, İKİ ANLAM
 *
 * ⚠️⚠️ BU DOSYADAKİ TESTLERİN ÇOĞU "YANLIŞ ANLAMA" ÜZERİNE.
 * Tarih ile hesap adı aynı kutuya yazıldığı için, yanlış çözümlenen bir
 * girdi doğrudan PARANIN YANLIŞ HESABA yazılması demektir — ve bu hata
 * hiçbir uyarı üretmez, ancak ay sonu mutabakatında fark edilir.
 */

const HESAPLAR: HesapSecenegi[] = [
  { id: 'a', name: 'Vakıfbank', label: 'Özkan Köse · Vakıfbank' },
  { id: 'b', name: 'Yapıkredi', label: 'Ayhan Köse · Yapıkredi' },
  { id: 'c', name: 'Shopier', label: 'Özkan Köse · Shopier' },
  { id: 'd', name: 'Akbank', label: 'Özkan Köse · Akbank' },
]

// ===========================================================================
describe('tarih çözümleme', () => {
  it('gg.aa.yyyy ve yyyy-aa-gg kabul edilir', () => {
    expect(tarihCozumle('12.09.2026')?.toISOString()).toBe('2026-09-12T00:00:00.000Z')
    expect(tarihCozumle('2026-09-12')?.toISOString()).toBe('2026-09-12T00:00:00.000Z')
    expect(tarihCozumle('5/9/2026')?.toISOString()).toBe('2026-09-05T00:00:00.000Z')
  })

  it('⚠️ TAŞAN GÜN REDDEDİLİR, KAYDIRILMAZ', () => {
    /**
     * `Date.UTC(2026, 1, 31)` hata vermez — sessizce 3 Mart'a kayar.
     * "31.02.2026" yazan biri bir ay sonra ana sayfada hiç beklemediği
     * bir tarih görürdü.
     */
    expect(tarihCozumle('31.02.2026')).toBeNull()
    expect(tarihCozumle('31.04.2026')).toBeNull()
    expect(tarihCozumle('29.02.2028')?.toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it('⚠️ `new Date()` GİBİ GEVŞEK DAVRANMAZ', () => {
    // `new Date("12")` sessizce 2001-12-01 üretir. Burada reddedilir.
    for (const s of ['12', '2026', 'bugün', '12.09', '', '12.13.2026', '0.9.2026']) {
      expect(tarihCozumle(s), `"${s}" kabul edildi`).toBeNull()
    }
  })
})

// ===========================================================================
describe('türkçe harf katlama', () => {
  it('⚠️ NOKTASIZ/NOKTALI i AYNI SAYILIR', () => {
    /**
     * Kullanıcı "yapikredi" yazacak, hesap adı "Yapıkredi". `toLowerCase()`
     * tek başına bunları eşleştirmez; üstelik "İ" İngilizce yerelde
     * birleşen noktalı bir karaktere dönüşür.
     */
    expect(katla('Yapıkredi')).toBe(katla('YAPIKREDİ'))
    expect(katla('yapikredi')).toBe(katla('Yapıkredi'))
    expect(katla('Vakıfbank')).toBe('vakifbank')
  })

  it('boşluk ve ayraç yok sayılır', () => {
    expect(katla('yapı kredi')).toBe(katla('yapı-kredi'))
    expect(katla('  Shopier ')).toBe('shopier')
  })
})

// ===========================================================================
describe('ödeme alanı', () => {
  const coz = (s: string) => odemeCozumle(s, HESAPLAR)

  it('boş kutu hiçbir şey yapmaz', () => {
    expect(coz('').kind).toBe('bos')
    expect(coz('   ').kind).toBe('bos')
  })

  it('tarih → alacak', () => {
    const r = coz('12.09.2026')
    expect(r.kind).toBe('tarih')
    if (r.kind === 'tarih') expect(r.date.toISOString().slice(0, 10)).toBe('2026-09-12')
  })

  it('hesap adı → tahsilat', () => {
    for (const yazim of ['yapıkredi', 'YAPIKREDİ', 'Yapı Kredi', 'yapikredi']) {
      const r = coz(yazim)
      expect(r.kind, `"${yazim}" hesap olarak tanınmadı`).toBe('hesap')
      if (r.kind === 'hesap') expect(r.accountId).toBe('b')
    }
  })

  it('kısaltma tek hesaba uyuyorsa kabul edilir', () => {
    const r = coz('shop')
    expect(r.kind).toBe('hesap')
    if (r.kind === 'hesap') expect(r.accountId).toBe('c')
  })

  it('⚠️ BELİRSİZ KISALTMA TAHMİN EDİLMEZ, REDDEDİLİR', () => {
    /**
     * "Vakıfbank" ve "Yapıkredi" arasında seçim yapmak zorunda kalan bir
     * tahmin, parayı yanlış bankaya yazar. Yanlış hesaba giden gelir,
     * hiç girilmemiş gelirden daha zor fark edilir.
     */
    const iki: HesapSecenegi[] = [
      { id: 'x', name: 'Akbank', label: 'A' },
      { id: 'y', name: 'Akbank Ticari', label: 'B' },
    ]
    const r = odemeCozumle('ak', iki)
    expect(r.kind).toBe('gecersiz')
    if (r.kind === 'gecersiz') expect(r.message).toContain('birden fazla')
  })

  it('⚠️ TANINMAYAN METİN SESSİZCE YUTULMAZ', () => {
    // "elden" yazan biri parayı bir yere yazdığını sanır; hiçbir hesaba
    // girmemiş olurdu. Hata mesajı ne yazması gerektiğini söylüyor.
    const r = coz('elden aldım')
    expect(r.kind).toBe('gecersiz')
    if (r.kind === 'gecersiz') {
      expect(r.message).toContain('tarih')
      expect(r.message).toContain('Vakıfbank')
    }
  })

  it('⚠️ TARİH, HESAPTAN ÖNCE DENENİR', () => {
    /**
     * Sıra ters olsaydı, adında rakam geçen bir hesap ("333 Kasa") bir
     * tarihi kapabilirdi. Tarih kalıpları dar ve kesin olduğu için önce
     * onlar denenir.
     */
    const tuzak: HesapSecenegi[] = [{ id: 'z', name: '12092026', label: 'Tuzak' }]
    expect(odemeCozumle('12.09.2026', tuzak).kind).toBe('tarih')
  })
})
