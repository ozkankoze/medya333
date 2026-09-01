import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ YÖNETİM PANELİ MÜŞTERİ SİTESİNDEN AYRI BİR UYGULAMADIR
 *
 * Panel, müşteri sitesinin kök düzeninin İÇİNDE render ediliyordu. Sonuç
 * yalnızca görsel değildi:
 *
 *   · Müşteri başlığı, altbilgisi ve menüsü panelde görünüyordu
 *   · Sağ altta WhatsApp destek düğmesi duruyordu — kendi paneline destek
 *     talebi açmaya davet eden bir düğme
 *   · **Google Ads dönüşüm etiketi** paneli her açışta tetikleniyordu, yani
 *     yöneticinin kendi kullanımı reklam verisine karışıyordu
 *
 * Ayrım artık iki KÖK düzenle yapılıyor: `(site)` ve `(admin)`. Bu testler
 * ayrımın kazara geri alınmasını engeller.
 */

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'src')
const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SITE_LAYOUT = path.join(SRC, 'app/(site)/layout.tsx')
const ADMIN_LAYOUT = path.join(SRC, 'app/(admin)/layout.tsx')
const ADMIN_DIR = path.join(SRC, 'app/(admin)/admin')

// ===========================================================================
describe('kök düzen ayrımı', () => {
  it('⚠️ TEK BİR ORTAK KÖK DÜZEN KALMADI', () => {
    /**
     * `src/app/layout.tsx` var olsaydı Next.js onu HER İKİ gruba da
     * uygulardı ve müşteri kabuğu panele geri sızardı — üstelik hiçbir
     * hata vermeden.
     */
    expect(existsSync(path.join(SRC, 'app/layout.tsx'))).toBe(false)
    expect(existsSync(SITE_LAYOUT)).toBe(true)
    expect(existsSync(ADMIN_LAYOUT)).toBe(true)
  })

  it('her iki kök düzen de kendi <html> ve <body>’sini açıyor', () => {
    for (const f of [SITE_LAYOUT, ADMIN_LAYOUT]) {
      const body = read(f)
      expect(body, `${path.relative(ROOT, f)} <html> açmıyor`).toContain('<html')
      expect(body, `${path.relative(ROOT, f)} <body> açmıyor`).toContain('<body')
    }
  })

  it('⚠️ MÜŞTERİ KABUĞU ADMIN KÖK DÜZENİNDE YOK', () => {
    const admin = stripComments(read(ADMIN_LAYOUT))
    for (const banned of ['SiteHeader', 'SiteFooter', 'SupportFab', 'GoogleAdsTag']) {
      expect(admin, `admin kök düzeninde "${banned}"`).not.toContain(banned)
    }
  })

  it('⚠️ GOOGLE ADS ETİKETİ PANELİN HİÇBİR YERİNDE YOK', () => {
    /**
     * Bu, ayrımın en somut kazancı. Etiket panelde çalıştığı sürece
     * yöneticinin kendi oturumları reklam ölçümüne karışıyordu ve bunu
     * fark ettirecek hiçbir belirti yoktu.
     */
    const offenders = walk(path.join(SRC, 'app/(admin)')).filter((p) =>
      stripComments(read(p)).includes('GoogleAdsTag'),
    )
    expect(offenders.map((p) => path.relative(ROOT, p))).toEqual([])
  })

  it('müşteri kabuğu YERİNDE DURUYOR (site tarafı bozulmadı)', () => {
    const site = read(SITE_LAYOUT)
    for (const wanted of ['SiteHeader', 'SiteFooter', 'SupportFab', 'GoogleAdsTag']) {
      expect(site, `müşteri düzeninde "${wanted}" kayboldu`).toContain(wanted)
    }
  })

  it('⚠️ paylaşılan stil dosyası HER İKİ kabukta da yükleniyor', () => {
    // Panele ayrı bir stil dosyası yazmak, iki yerde ayrışan iki tema
    // üretirdi. Tailwind temeli ve tasarım belirteçleri ortak kalmalı.
    expect(read(SITE_LAYOUT)).toContain("globals.css")
    expect(read(ADMIN_LAYOUT)).toContain("globals.css")
  })
})

// ===========================================================================
describe('adres yapısı', () => {
  it('panel /admin altında, rota grubu adrese hiçbir şey eklemiyor', () => {
    for (const p of [
      // ⚠️ ÇIPLAK /admin ARTIK KENDİ SAYFASI: hesap bakiyeleri ve alacaklar.
      //    Eskiden İş Kuyruğu'na yönlendiriyordu; o ekran silindi.
      '(panel)/page.tsx',
      // ⚠️ '(panel)/katalog' BİLEREK YOK — katalog ekranları panelden
      //    kaldırıldı (API uçları ve veri duruyor).
      '(panel)/notifications/page.tsx',
      '(panel)/kullanicilar/page.tsx',
      '(panel)/kasa/page.tsx',
      '(panel)/kasa/paketler/page.tsx',
      '(panel)/kasa/siparisler/page.tsx',
      'giris/page.tsx',
    ]) {
      expect(existsSync(path.join(ADMIN_DIR, p)), `${p} yok`).toBe(true)
    }
  })

  it('⚠️⚠️ İŞ KUYRUĞU EKRANLARI VE UÇLARI GERÇEKTEN SİLİNDİ', () => {
    /**
     * Kaldırılması istendi ve sonucu açıkça kabul edildi: siteden gelen
     * ödenmiş bir sipariş veritabanına düşer ama panelde GÖRÜNMEZ.
     *
     * ⚠️ Bu test yalnızca EKRANLARIN gittiğini doğrular. `src/server/
     * fulfillment/*` DURUYOR ve durmalı: ödeme webhook'u ona bağlı,
     * silinseydi ödeme akışı kırılırdı — aşağıda ayrıca doğrulanıyor.
     */
    expect(existsSync(path.join(ADMIN_DIR, '(panel)/fulfillment'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'src/app/api/v1/admin/fulfillments'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'src/components/fulfillment'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'src/server/fulfillment')), 'ödeme akışı buna bağlı').toBe(true)
  })

  it('⚠️ ESKİ /yonetim ADRESİ YÖNLENDİRME İLE YAŞIYOR', () => {
    /**
     * 404'e bırakmak kaydedilmiş yer imlerini ve açık sekmeleri bir anda
     * kırardı — üstelik "panel bozuldu" gibi görünerek.
     */
    const config = read(path.join(ROOT, 'next.config.ts'))
    expect(config).toContain('async redirects()')
    expect(config).toContain("source: '/yonetim/:path*'")
    expect(config).toContain("destination: '/admin/:path*'")
  })

  it('⚠️ YÖNLENDİRME KALICI DEĞİL (permanent: false)', () => {
    /**
     * Kalıcı yönlendirme tarayıcıda agresif biçimde önbelleğe alınır:
     * karar geri alınırsa kullanıcıların tarayıcısı aylarca eski
     * yönlendirmeyi hatırlar ve bunu uzaktan temizlemenin yolu yoktur.
     */
    const config = read(path.join(ROOT, 'next.config.ts'))
    const block = /async redirects\(\)[\s\S]*?\n  \},/.exec(config)
    expect(block, 'redirects bloğu bulunamadı').not.toBeNull()
    expect(block![0]).not.toContain('permanent: true')
  })

  it('robots hem yeni hem ESKİ panel yolunu kapatıyor', () => {
    // Eski adres arama motorunun dizininde kalmış olabilir; listeden
    // çıkarmak onun taranmasına izin vermek olurdu.
    const rules = read(path.join(SRC, 'lib/seo/robots-rules.ts'))
    expect(rules).toContain("'/admin/'")
    expect(rules).toContain("'/yonetim/'")
  })

  it('middleware /admin’i koruyor ve giriş sayfasını dışarıda bırakıyor', () => {
    const mw = stripComments(read(path.join(SRC, 'middleware.ts')))
    expect(mw).toContain("'/admin'")
    expect(mw).toContain("'/admin/giris'")
    expect(mw).toContain("'/admin/:path*'")
  })

  it('⚠️ middleware API uçlarını KAPSAMIYOR', () => {
    /**
     * `/api/v1/admin/**` çerez varlığına bakan bir yönlendirmeye girseydi,
     * JSON bekleyen istemciye HTML giriş sayfası dönerdi. API uçları kendi
     * `adminHandler` sarmalayıcısıyla korunur.
     */
    const mw = read(path.join(SRC, 'middleware.ts'))
    const matcher = /matcher: \[([\s\S]*?)\]/.exec(mw)
    expect(matcher).not.toBeNull()
    expect(matcher![1]).not.toContain('/api')
  })
})

// ===========================================================================
describe('panel kabuğu', () => {
  const panelLayout = read(path.join(ADMIN_DIR, '(panel)/layout.tsx'))

  it('istenen bölümler menüde', () => {
    for (const label of ['Panel', 'Bildirimler', 'Kullanıcılar', 'Kasa', 'Hesabım']) {
      expect(panelLayout, `menüde "${label}" yok`).toContain(label)
    }
  })

  it('⚠️ KATALOG MENÜDE YOK — kaldırıldı, unutulmadı', () => {
    /**
     * Bu test eskiden Katalog'un VARLIĞINI doğruluyordu. Gereksinim
     * değiştiği için testin yönü çevrildi; silinmedi. Silinseydi, sekme
     * bir gün yanlışlıkla geri eklendiğinde hiçbir şey uyarmazdı.
     */
    expect(stripComments(panelLayout)).not.toContain('/admin/katalog')
  })

  it('⚠️ rol kapıları korundu', () => {
    const code = stripComments(panelLayout)
    // Kullanıcılar ADMIN+, Kasa yalnızca SUPERADMIN.
    expect(code).toContain('ROLE_LEVEL[user.role] >= ROLE_LEVEL.ADMIN')
    expect(code).toContain("user.role === 'SUPERADMIN'")
    // Panelin tamamı en az SUPPORT ister.
    expect(code).toContain('ROLE_LEVEL[user.role] < ROLE_LEVEL.SUPPORT')
  })

  it('oturumsuz istek personel kapısına gider', () => {
    expect(stripComments(panelLayout)).toContain("redirect('/admin/giris")
  })
})

// ---------------------------------------------------------------------------
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}
