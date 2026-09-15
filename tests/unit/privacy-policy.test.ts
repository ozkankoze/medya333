import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ MARTIS GİZLİLİK POLİTİKASI — /privacy-policy
 *
 * ⚠️⚠️ BU SAYFANIN İKİ TÜRLÜ BOZULMA BİÇİMİ VAR ve ikisi de SESSİZDİR:
 *
 *   1. YANLIŞ YERE TAŞINMA. `(legal)` grubuna girerse düzen her metnin
 *      başına "Taslak metin — hukuk danışmanı tarafından güncellenecek"
 *      rozetini basar ve `robots: { index: false }` uygular. Sayfa açılır,
 *      hiçbir test kırılmaz — ama App Store inceleyicisi taslak rozeti
 *      gören bir gizlilik politikası yüzünden uygulamayı reddeder.
 *
 *   2. UYDURMA İLETİŞİM BİLGİSİ. Bir gizlilik metninde var olmayan bir
 *      adres, telefon veya e-posta bulunması yalnızca çirkin değil, GDPR
 *      kapsamında YANLIŞ BEYANDIR: veri sahibi haklarını kullanmak için
 *      yazdığı adres dönüyorsa hak fiilen kullanılamaz hâle gelir.
 *
 * ⚠️ ÜÇÜNCÜ TARAF LİSTESİ DE BURADA SABİTLENİR. Metinde adı geçen her
 * sağlayıcı operatöre tek tek soruldu. Yeni bir SDK eklenip metne
 * yazılmazsa beyan EKSİK, kullanılmayan biri yazılırsa YANLIŞ olur.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

const SAYFA = 'src/app/(site)/privacy-policy/page.tsx'
const page = read(SAYFA)
const footer = read('src/components/layout/SiteFooter.tsx')
const sitemap = read('src/app/sitemap.ts')

/** Yorumlar taranmaz: kural metnin KENDİSİNDE aranır. */
const stripComments = (body: string) =>
  body
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const govde = stripComments(page)

// ===========================================================================
describe('adres ve yerleşim', () => {
  it('sayfa tam olarak /privacy-policy adresinde', () => {
    // `(site)` bir rota grubudur, adrese hiçbir şey eklemez.
    expect(existsSync(path.join(ROOT, SAYFA))).toBe(true)
  })

  it('⚠️⚠️ TASLAK ROZETLİ (legal) GRUBUNDA DEĞİL', () => {
    /**
     * `(legal)/layout.tsx` her çocuğuna taslak rozeti basar. Bu sayfanın
     * oraya taşınması, yayınlanmış bir yasal belgeyi "taslak" diye
     * etiketlemek olurdu.
     */
    expect(existsSync(path.join(ROOT, 'src/app/(site)/(legal)/privacy-policy/page.tsx'))).toBe(
      false,
    )
  })

  it('⚠️ İNDEKSLENEBİLİR — diğer yasal metinlerin aksine', () => {
    // Kardeş sayfalar bilinçli olarak `index: false`; bu sayfa değil.
    expect(govde).toContain('robots: { index: true, follow: true }')
    expect(govde).not.toMatch(/index:\s*false/)
  })

  it('site haritasında yer alıyor', () => {
    expect(stripComments(sitemap)).toContain('/privacy-policy')
  })
})

// ===========================================================================
describe('footer bağlantısı', () => {
  it('⚠️ BAĞLANTI VAR', () => {
    expect(stripComments(footer)).toContain("href: '/privacy-policy'")
  })

  it('⚠️⚠️ KVKK BAĞLANTISININ YERİNE GEÇMEDİ', () => {
    /**
     * İkisi FARKLI belgelerdir: biri Türkçe e-ticaret sitesinin KVKK
     * aydınlatma metni, diğeri Martis iOS uygulamasının İngilizce gizlilik
     * politikası. Biri diğerinin yerine konursa taraflardan biri kendi
     * yasal metnine footer'dan ulaşamaz.
     */
    expect(stripComments(footer)).toContain("href: '/kvkk-gizlilik'")
  })
})

// ===========================================================================
describe('⚠️⚠️ UYDURMA İLETİŞİM BİLGİSİ YOK', () => {
  const GERCEK_EPOSTA = 'destek@medya333.com'

  it('yalnızca projede gerçekten var olan e-posta kullanılıyor', () => {
    expect(govde).toContain(GERCEK_EPOSTA)
    const epostalar = new Set(govde.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [])
    epostalar.delete(GERCEK_EPOSTA)
    expect([...epostalar], 'metinde tanımadığımız e-posta adresi var').toEqual([])
  })

  it('telefon numarası uydurulmamış', () => {
    /**
     * Projede hiçbir yerde gerçek bir telefon numarası yok
     * (`NEXT_PUBLIC_WHATSAPP_NUMBER` boş). Metinde bir numara belirmişse
     * uydurulmuş demektir.
     */
    const numaralar = govde.match(/\+\d[\d\s()-]{8,}/g) ?? []
    expect(numaralar, 'metinde uydurma telefon numarası var').toEqual([])
  })

  it('açık adres uydurulmamış', () => {
    // Şirketin tescilli adresi bilinmiyor; sokak/mahalle/kat gibi bir
    // adres bileşeni görünüyorsa kaynağı yok demektir.
    expect(govde).not.toMatch(/\b(Mah\.|Mahallesi|Sok\.|Sokak|Cad\.|Caddesi|No:|Kat:)\b/)
  })
})

// ===========================================================================
describe('⚠️ ÜÇÜNCÜ TARAFLAR AÇIKÇA ADLANDIRILMIŞ', () => {
  const BEKLENEN = [
    'Firebase Authentication',
    'Firebase Analytics',
    'Crashlytics',
    'OpenAI',
    'Medya 333 backend API',
  ]

  it.each(BEKLENEN)('%s metinde geçiyor', (ad) => {
    expect(govde).toContain(ad)
  })

  it('⚠️ KULLANILMAYAN SAĞLAYICI YAZILMAMIŞ', () => {
    /**
     * Operatöre soruldu: yanıtlar OpenAI'dan geliyor. Başka bir model
     * sağlayıcısının metinde belirmesi, yapılmayan bir veri aktarımını
     * beyan etmek olurdu.
     */
    for (const yok of ['Anthropic', 'Gemini', 'Vertex AI', 'Mixpanel', 'Amplitude', 'Sentry']) {
      expect(govde, `${yok} kullanılmıyor ama metinde geçiyor`).not.toContain(yok)
    }
  })
})

// ===========================================================================
describe('⚠️ GDPR ve App Store zorunlu bölümleri', () => {
  const BOLUMLER = [
    'Who we are',
    'Data we collect',
    'How we use your data',
    'Legal bases',
    'Third-party services',
    'International data transfers',
    'How long we keep your data',
    'Deleting your data',
    'Your rights',
    'Children',
    'Changes to this policy',
    'Contact us',
  ]

  it.each(BOLUMLER)('"%s" bölümü var', (baslik) => {
    expect(govde).toContain(baslik)
  })

  it('⚠️⚠️ VERİ SİLME YOLU SOMUT — süre taahhüdüyle', () => {
    /**
     * Apple, hesap açabilen uygulamalarda silme yolunun AÇIKÇA anlatılmasını
     * ister. "İletişime geçin" yeterli değildir: nereye yazılacağı ve ne
     * kadar sürede sonuçlanacağı yazmalıdır.
     */
    expect(govde).toContain('within 30 days')
    expect(govde).toContain('destek@medya333.com')
  })

  it('sohbet geçmişinin SUNUCUDA saklandığı açıkça söyleniyor', () => {
    // İşin en hassas kısmı bu; üstü kapalı geçilirse beyan eksik kalır.
    expect(govde).toMatch(/transmitted to our backend servers\s*\n?\s*and stored/)
  })

  it('⚠️ SAYFA DİLİ İNGİLİZCE OLARAK İŞARETLİ', () => {
    // Kök düzen `lang="tr-TR"` veriyor; belirtilmezse ekran okuyucu
    // İngilizce metni Türkçe sesletimle okur.
    expect(govde).toContain('lang="en"')
  })
})
