import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ GELİR – GİDER EKRANI
 *
 * ⚠️⚠️ EN KRİTİK KURAL: KASA AKIŞI İLE NET KÂR AYNI SAYI DEĞİLDİR ve
 * ekranda ayrı gösterilirler.
 *
 *   KASA AKIŞI → giren − çıkan. "Param arttı mı?"
 *   NET KÂR    → ciro − maliyet − gider. "İş kazandırıyor mu?"
 *
 * Alacak tahsili bakiyeyi artırır ama kâr değildir (satış zaten
 * sayılmıştı); kredi ödemesi bakiyeyi düşürür ama zarar değildir. İkisini
 * tek "net" altında toplamak bu ayrımı görünmez kılar ve yanlış iş kararı
 * ürettirir.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const server = stripComments(read('src/server/kasa/finans.ts'))
const page = stripComments(read('src/app/(admin)/admin/(panel)/finans/page.tsx'))
const form = stripComments(read('src/components/kasa/HizliHareketForm.tsx'))
const layout = stripComments(read('src/app/(admin)/admin/(panel)/layout.tsx'))

// ===========================================================================
describe('akış hesabı', () => {
  it('⚠️ TRANSFER VE DÜZELTME AKIŞA GİRMEZ', () => {
    /**
     * Transfer sayılsaydı 10.000 TL'yi bir hesaptan diğerine almak, ayın
     * hem gelirini hem giderini 10.000 TL şişirirdi. Düzeltme ise gerçek
     * bir para hareketi değil, defteri gerçeğe eşitleyen bir kayıttır.
     */
    expect(server).toContain("AKISA_GIRMEZ = new Set<CashCategory>(['TRANSFER_IN', 'TRANSFER_OUT', 'DUZELTME'])")
    expect(server).toMatch(/if \(AKISA_GIRMEZ\.has\(r\.category\)\) continue/)
  })

  it('⚠️ AKIŞ VE KÂR AYRI HESAPLANIR', () => {
    expect(server).toContain('akisMinor: girenMinor - cikanMinor')
    expect(server).toContain('profit: profitOf(movements)')
  })

  it('⚠️ FARK EKRANDA YAZILI', () => {
    // Yazmasaydı iki sayı farklı çıktığında hangisinin doğru olduğu
    // sorusu cevapsız kalırdı — ikisi de doğrudur, farklı soruların cevabı.
    expect(page).toContain('Kasa akışı kâr değildir.')
  })

  it('gider dağılımı büyükten küçüğe', () => {
    // "Para nereye gitti?" sorusunda en büyük kalem en başta olmalı.
    expect(server).toMatch(/sort\(\(a, b\) => b\.amountMinor - a\.amountMinor\)/)
  })

  it('⚠️ SATIR BAŞINA EK SORGU YOK', () => {
    // 200 hareketlik bir ayda satır başına altı bağlılık sorgusu 1.200
    // ek gidiş-geliş demekti.
    expect(server).toContain('packagePayment: { select: { id: true } }')
  })
})

// ===========================================================================
describe('hızlı giriş formu', () => {
  it('⚠️ HESAP VARSAYILANI YOK', () => {
    /**
     * "İlk hesabı seç" gibi bir kolaylık, paranın yanlış bankadan
     * düşmesine yol açar ve bu hata ancak ay sonu mutabakatında fark
     * edilir — o zamana kadar bakiye yanlıştır.
     */
    expect(form).toContain('<option value="">Seç…</option>')
    expect(form).toContain("setError('Hangi hesaptan/hesaba olduğunu seç.')")
  })

  it('⚠️ YÖN DEĞİŞİNCE KATEGORİ SIFIRLANIR', () => {
    /**
     * `key` olmasaydı React aynı `select`i yeniden kullanır, "Gider"den
     * "Gelir"e geçen kullanıcı farkında olmadan GIDER kategorisini
     * göndermeye devam ederdi — yön IN, kategori GIDER: sunucu reddeder
     * ama kullanıcı sebebini anlamazdı.
     */
    expect(form).toMatch(/key=\{yon\}/)
  })

  it('gider ve gelir kategorileri ayrı listeler', () => {
    expect(form).toContain('GIDER_KATEGORI')
    expect(form).toContain('GELIR_KATEGORI')
    // ⚠️ Tek liste olsaydı "SATIS ama para çıkışı" gibi bir satır
    //    üretilebilir ve kâr hesabı sessizce bozulurdu.
    expect(form).not.toMatch(/GIDER_KATEGORI[\s\S]{0,200}'SATIS'/)
  })

  it('form elemanı senkron yakalanıyor', () => {
    expect(form).toContain('function withForm(')
    const gonder = form.slice(form.indexOf('async function gonder'))
    expect(gonder).not.toContain('currentTarget')
  })

  it('⚠️ HESAP VE TARİH FORMDA KALIR, TUTAR TEMİZLENİR', () => {
    /**
     * Arka arkaya beş gider giren biri hesabı her seferinde yeniden
     * seçmek zorunda kalsaydı, üçüncüsünde vazgeçerdi.
     */
    expect(form).toMatch(/for \(const name of \['tutar', 'description'\]\)/)
    expect(form).not.toContain('formEl.reset()')
  })

  it('bakiyenin ne yöne gideceği önceden yazılı', () => {
    expect(form).toContain("{yon === 'OUT' ? 'düşer' : 'artar'}")
  })
})

// ===========================================================================
describe('menü', () => {
  it('⚠️⚠️ SİPARİŞLER VE PAKETLER KASA’NIN ALTINDA DEĞİL', () => {
    /**
     * Canlıda oldu: Kasa sayfası eksik bir migration yüzünden 500 verdi
     * ve o sayfanın sekme çubuğundan gidilen iki ekran birden erişilemez
     * hâle geldi — oysa ikisinin de o sayfayla ilgisi yok.
     */
    expect(layout).toContain("href: '/admin/kasa/siparisler', label: 'Siparişler'")
    expect(layout).toContain("href: '/admin/kasa/paketler', label: 'Aylık Paketler'")
  })

  it('⚠️ KASA BAĞLANTISI TAM EŞLEŞME İSTER', () => {
    // '/admin/kasa' diğer ikisinin ön eki; `exact` olmasaydı Siparişler
    // sayfasındayken iki sekme birden aktif görünürdü.
    expect(layout).toMatch(/label: 'Kasa', match: '\/admin\/kasa', exact: true/)
  })

  it('gelir–gider menüde ve SUPERADMIN’e özel', () => {
    const blok = layout.slice(layout.indexOf("if (user.role === 'SUPERADMIN')"))
    expect(blok).toContain("label: 'Gelir–Gider'")
  })
})

// ===========================================================================
describe('bu ayın işleri', () => {
  it('⚠️⚠️ İŞ CİROSU KASA GİRİŞİNE EKLENMEZ', () => {
    /**
     * Toplansaydı tahsil edilmiş bir sipariş HEM iş cirosunda HEM kasa
     * girişinde sayılır — aynı satış iki kez görünürdü. İki blok ayrı
     * hesaplanır ve ekranda ayrı gösterilir.
     */
    expect(server).toContain('const isCiroMinor = isler.reduce')
    expect(server).toContain('akisMinor: girenMinor - cikanMinor')
    expect(server).not.toMatch(/girenMinor \+= .*isCiro/)
    expect(page).toContain('Yukarıdaki “giren” yalnızca kasaya fiilen giren parayı sayar.')
  })

  it('sipariş ve paketler birlikte listelenir', () => {
    expect(server).toContain('db.manualOrder.findMany')
    expect(server).toContain('db.servicePackage.findMany')
    // ⚠️ Paketler AYDA BAŞLAYANA göre — paket sayfasındaki özetle aynı kural.
    expect(server).toMatch(/startDate: \{ gte: range\.gte, lt: range\.lt \}/)
  })

  it('⚠️ İPTALLER SAYILMAZ', () => {
    // İptal edilmiş bir iş ciroya girseydi, yapılmamış iş kâr gibi görünürdü.
    expect(server).toContain("status: { not: 'IPTAL' }")
    expect(server).toContain('canceledAt: null')
  })

  it('⚠️ TAHSİL EDİLMEYEN TUTAR AYRI GÖSTERİLİR', () => {
    /**
     * Ciroya bakıp "bu para bende" sanmak, bu ekranda yapılabilecek en
     * pahalı yanlış okumadır.
     */
    expect(server).toContain('tahsilEdilmeyenMinor')
    expect(page).toContain('Tahsil edilmeyen')
  })

  it('hangi hesaba tahsil edildiği satırda yazıyor', () => {
    expect(server).toContain('accountName: o.paymentEntry?.account.name ?? null')
    expect(page).toContain('i.tahsilat.accountName')
  })
})
