import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ PAKET LİSTESİ — TABLO OLARAK OKUNABİLİR OLMASI
 *
 * Bu dosya bir GÖRÜNÜM sözleşmesini kilitler. Sebebi ölçüldü: her satırda
 * üç işlem düğmesi açıkta duruyor, hizmet adı beş satıra sarıyordu; bir
 * paket satırı yüz pikselden uzun bir bloğa dönüşüyor ve ekrana dört paket
 * sığıyordu. Tablo, tablo gibi değil paragraf yığını gibi okunuyordu.
 *
 * ⚠️⚠️ EN KRİTİK KISIM: "TAHSİL ET" KALDIRILMADI, MENÜYE GİRDİ.
 * Tahsilat, banka bakiyesini artıran TEK yoldur (bkz.
 * `src/server/kasa/packages.ts` → `collectPayment`). Düğme büsbütün
 * silinseydi paket cirosu kasaya hiç yansımazdı ve bu, hiçbir hata
 * üretmeden yalnızca bakiyeyi eksik gösterirdi.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const page = stripComments(read('src/app/(admin)/admin/(panel)/kasa/paketler/page.tsx'))
const server = stripComments(read('src/server/kasa/packages.ts'))
const menu = stripComments(read('src/components/kasa/RowMenu.tsx'))

// ===========================================================================
describe('sıralama', () => {
  it('liste sırasını sunucu veriyor — ekran kendi sıralamıyor', () => {
    expect(server).toContain('compareForList')
    expect(page).not.toContain('.sort(')
  })

  it('⚠️ SIRA VERİTABANI SIRASINA BIRAKILMIYOR', () => {
    /**
     * `orderBy` tek başına yetmez: sıra, veritabanında olmayan bir alana —
     * tarihten türetilen duruma — dayanıyor. Prisma sırası yalnızca sonucu
     * deterministik kılar.
     */
    expect(server).toMatch(/sort\(compareForList\)/)
  })

  it('kalan gün SUNUCUDA hesaplanıyor', () => {
    /**
     * ⚠️ Sayfa `todayForOperator()`u kendi çağırsaydı, sunucunun UTC gününe
     * düşme hatası (her gece 21:00–24:00 arası bir gün geride kalma)
     * oradan geri girerdi.
     */
    expect(server).toContain('daysLeft: daysRemaining(p, today)')
    expect(page).not.toContain('todayForOperator')
    expect(page).not.toContain('daysRemaining(')
  })

  it('sıranın kuralı ekranda YAZILI', () => {
    // Yazılmazsa "neden bu sırada?" her seferinde tabloya bakılarak tahmin edilir.
    expect(page).toContain('Bitişi en yakın olan üstte')
  })
})

// ===========================================================================
describe('satır işlem menüsü', () => {
  it('⚠️⚠️ TAHSİLAT YETENEĞİ DURUYOR — yalnızca menüye girdi', () => {
    expect(page).toContain('PackageActions')
    expect(page).toContain('canCollect=')
    const rowMenu = page.slice(page.indexOf('<RowMenu>'), page.indexOf('</RowMenu>'))
    expect(rowMenu, 'PackageActions menünün içinde değil').toContain('PackageActions')
    expect(rowMenu, 'InlineEdit menünün içinde değil').toContain('InlineEdit')
  })

  it('⚠️ MENÜ AÇILIR KUTU DEĞİL — kırpılma riski yok', () => {
    /**
     * Tablo `overflow-x-auto` bir kabın içinde; mutlak konumlanmış bir
     * panel o kabın kenarında kırpılırdı. Dar ekranda ortaya çıkan,
     * geniş ekranda çıkmayan bir hata sınıfı — yani geliştirirken
     * görünmez, kullanırken görünür.
     */
    expect(menu).not.toContain('absolute')
    expect(menu).not.toContain('z-')
    expect(menu).not.toContain('createPortal')
  })

  it('menü kapalıyken içerik hiç render edilmiyor', () => {
    // 50 paketlik listede satır başına üç form kurmak, 150 gereksiz ağaç demek.
    expect(menu).toMatch(/if \(!open\)[\s\S]{0,400}return \(/)
  })

  it('ESC ile kapanıyor', () => {
    expect(menu).toContain("e.key === 'Escape'")
  })
})

// ===========================================================================
describe('tablo yoğunluğu', () => {
  it('⚠️ UZUN HİZMET ADI KIRPILIYOR AMA KAYBOLMUYOR', () => {
    /**
     * Kırpma tek başına bilgi gizlemek olurdu; tam metin `title`da ve
     * düzenleme kutusunda duruyor.
     */
    expect(page).toContain('line-clamp-2')
    expect(page).toContain('title={r.serviceName}')
  })

  it('para sütunları hizalı ve tek satır', () => {
    const money = page.match(/tabular whitespace-nowrap px-3 py-2 text-right/g) ?? []
    expect(money.length, 'satış / maliyet / net kâr sağa hizalı değil').toBeGreaterThanOrEqual(3)
  })

  it('⚠️ EKSİ NET KÂR AYIRT EDİLİYOR', () => {
    /**
     * Ekranda 250 ₺ satışa karşı 1.250 ₺ maliyetli bir paket duruyordu ve
     * eksi kâr diğerleriyle aynı siyahtı — hiç göze çarpmıyordu.
     */
    expect(page).toMatch(/r\.netMinor < 0[\s\S]{0,60}text-danger-600/)
  })

  it('satırlar zebra — dokuz sütunda göz kaymasın', () => {
    expect(page).toContain('even:bg-ink-50')
  })
})
