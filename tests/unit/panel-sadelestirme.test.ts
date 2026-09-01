import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ PANEL SADELEŞTİRME — SÖZLEŞMELER
 *
 * Panel, kullanıcının yıllardır kullandığı e-tabloya benzetildi:
 * Tarih · Kullanıcı adı · İşlem · Fiyat · Maliyet · Net kâr · Ödeme.
 *
 * ⚠️⚠️ EN KRİTİK KURAL: "ÖDEME" KUTUSU TEK KUTUDUR AMA İKİ ŞEY YAPAR.
 *     tarih → hiçbir kasa hareketi YAZILMAZ, satır alacak olur
 *     hesap → gerçek gelir hareketi yazılır, BANKA BAKİYESİ ARTAR
 * Yanlış dalın çalışması, ya gelmemiş parayı bakiyeye eklemek ya da
 * gelmiş parayı hiç görmemek demektir.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const orders = stripComments(read('src/server/kasa/orders.ts'))
const panel = stripComments(read('src/server/kasa/panel.ts'))
const page = stripComments(read('src/app/(admin)/admin/(panel)/kasa/siparisler/page.tsx'))
const home = stripComments(read('src/app/(admin)/admin/(panel)/page.tsx'))

// ===========================================================================
describe('ödeme kutusu', () => {
  it('⚠️ TARİH DALI KASAYA HİÇ DOKUNMAZ', () => {
    /**
     * Tarih yazmak "para geldi" demek değildir. Bu dal bir `CashEntry`
     * üretseydi, henüz tahsil edilmemiş bir satış banka bakiyesine
     * eklenir ve "ödeyebilir miyim?" sorusuna yanlış cevap verilirdi.
     */
    const fn = orders.slice(orders.indexOf('export async function uygulaOdeme'))
    const tarihDali = fn.slice(fn.indexOf("girdi.kind === 'tarih'"), fn.indexOf('collectOrderPayment'))
    expect(tarihDali).toContain('setOrderDueDate')
    expect(tarihDali).not.toContain('cashEntry.create')
    expect(tarihDali).not.toContain('collectOrderPayment')
  })

  it('hesap dalı gerçek tahsilat yazar', () => {
    const fn = orders.slice(orders.indexOf('export async function uygulaOdeme'))
    expect(fn).toContain('collectOrderPayment')
  })

  it('⚠️ TAHSİL EDİLİNCE BEKLENEN TARİH SİLİNİR', () => {
    /**
     * Kalsaydı ödenmiş bir iş, düzenleme ekranında hâlâ "12.09'da
     * bekleniyor" yazardı — ödenmiş bir işin beklendiği izlenimi.
     */
    const fn = orders.slice(orders.indexOf('export async function uygulaOdeme'))
    expect(fn).toMatch(/data: \{ dueDate: null \}/)
  })

  it('⚠️ TAHSİL EDİLMİŞ SATIRA VADE YAZILAMAZ', () => {
    /**
     * Yazılabilseydi ana sayfadaki alacak listesine tahsil edilmiş bir iş
     * girerdi; toplam alacak olduğundan yüksek görünür ve o rakama
     * bakarak verilen her karar yanlış olurdu.
     */
    const fn = orders.slice(orders.indexOf('export async function setOrderDueDate'))
    expect(fn).toMatch(/order\.paidAt && dueDate/)
    expect(fn).toContain('ALREADY_PAID')
  })

  it('anlaşılmayan girdi siparişi ÇÖPE ATMAZ', () => {
    /**
     * ⚠️ Sipariş önce yazılır, ödeme kutusu SONRA uygulanır ve hatası ayrı
     * raporlanır. Tek işleme sokulsaydı, tanınmayan bir hesap adı yüzünden
     * doğru girilmiş sipariş de kaybolur, kullanıcı satırı baştan yazardı.
     */
    const route = stripComments(read('src/app/api/v1/admin/kasa/siparisler/route.ts'))
    expect(route).toContain('odemeHatasi')
    expect(route.indexOf('createOrder(')).toBeLessThan(route.indexOf('uygulaOdeme('))
  })

  it('hesap listesi her çözümlemede taze okunur', () => {
    // Yeni açılan bir hesabın adı ilk denemede tanınmalı.
    const fn = orders.slice(orders.indexOf('export async function cozumleOdeme'))
    expect(fn).toContain('db.cashAccount.findMany')
  })
})

// ===========================================================================
describe('bakiye düzeltmesi', () => {
  it('⚠️⚠️ BAKİYE DOĞRUDAN YAZILMAZ — FARK KADAR HAREKET YAZILIR', () => {
    /**
     * Bakiye saklanmıyor, hesaplanıyor. Yazılabilir bir sütun olsaydı
     * defterle bakiye ilk fırsatta ayrışır ve hangisinin doğru olduğu
     * bilinemezdi.
     */
    const fn = panel.slice(panel.indexOf('export async function adjustAccountBalance'))
    expect(fn).toContain('const diff = params.targetMinor - current')
    expect(fn).toContain("category: 'DUZELTME'")
    expect(fn).toMatch(/direction: diff > 0 \? 'IN' : 'OUT'/)
    expect(fn).not.toContain('balanceMinor:')
  })

  it('⚠️ SATIR KİLİDİ VAR — iki eşzamanlı düzeltme bakiyeyi ikiye katlamaz', () => {
    const fn = panel.slice(panel.indexOf('export async function adjustAccountBalance'))
    expect(fn).toContain('FOR UPDATE')
    expect(fn).toContain('$transaction')
  })

  it('fark sıfırsa hareket yazılmaz', () => {
    const fn = panel.slice(panel.indexOf('export async function adjustAccountBalance'))
    expect(fn).toMatch(/if \(diff === 0\)/)
  })

  it('⚠️ DÜZELTME KÂRA GİRMEZ', () => {
    /**
     * Kâra katılsaydı, unutulmuş bir hareketi sonradan eklemek "kâr" gibi
     * görünürdü. `profitOf` yalnızca SATIS/GIDER/MALIYET/BORC_ODEME sayar;
     * DUZELTME varsayılan dala düşer.
     */
    const calc = stripComments(read('src/lib/kasa/calc.ts'))
    const fn = calc.slice(calc.indexOf('export function profitOf'))
    expect(fn).not.toContain('DUZELTME')
  })

  it('düzeltme kategorisi migration ile eklendi', () => {
    const sql = read('prisma/migrations/20260901160000_panel_sadelestirme/migration.sql')
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'DUZELTME'")
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "dueDate"')
  })
})

// ===========================================================================
describe('ana sayfa', () => {
  it('⚠️ ALACAK İKİ KAYNAKTAN BİRLEŞTİRİLİR', () => {
    /**
     * Yalnızca birini göstermek "toplam alacağım" sorusuna eksik cevap
     * vermek olurdu — eksik bir toplam, yanlış bir toplamdan daha
     * tehlikelidir çünkü doğru görünür.
     */
    const fn = panel.slice(panel.indexOf('export async function getPanelHome'))
    expect(fn).toContain('db.manualOrder.findMany')
    expect(fn).toContain('db.receivable.findMany')
  })

  it('yalnızca ÖDENMEMİŞ ve tarihi olan siparişler alacaktır', () => {
    const fn = panel.slice(panel.indexOf('export async function getPanelHome'))
    expect(fn).toMatch(/paidAt: null, dueDate: \{ not: null \}/)
  })

  it('⚠️ TARİHSİZ ALACAKLAR EN ALTA', () => {
    // `null`ı 0 sayan bir sıralama onları 1970 gibi görüp en üste taşırdı.
    const fn = panel.slice(panel.indexOf('export async function getPanelHome'))
    expect(fn).toMatch(/a\.dueDate === null\) return b\.dueDate === null \? 0 : 1/)
  })

  it('bakiye tek geçişte hesaplanıyor — hesap başına tarama yok', () => {
    expect(panel).toContain('balancesByAccount(accounts, entries)')
  })

  it('ana sayfa gerçekten /admin adresinde', () => {
    expect(existsSync(path.join(ROOT, 'src/app/(admin)/admin/(panel)/page.tsx'))).toBe(true)
    const config = read('next.config.ts')
    // ⚠️ Eski yönlendirme kalsaydı /admin sonsuza dek silinmiş bir sayfaya giderdi.
    expect(config).not.toContain("destination: '/admin/fulfillment'")
  })

  it('gecikmiş alacak ayırt ediliyor', () => {
    expect(home).toMatch(/daysLeft < 0[\s\S]{0,80}text-danger-600/)
  })
})

// ===========================================================================
describe('sipariş tablosu e-tabloyla aynı sırada', () => {
  it('⚠️ SÜTUN SIRASI BİREBİR', () => {
    /**
     * Alışılmış bir düzeni "daha mantıklı" diye değiştirmek, yıllardır
     * aynı sırayla okuyan gözü her satırda yavaşlatır.
     */
    const basliklar = [...page.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]!.trim())
    expect(basliklar).toEqual([
      'Tarih',
      'Kullanıcı adı',
      'İşlem',
      'Fiyat',
      'Maliyet',
      'Net kâr',
      'Ödeme',
      'İşlem',
    ])
  })

  it('ödeme hücresi tahsil edilmişse kutu göstermez', () => {
    /**
     * ⚠️ Kutu açık kalsaydı ikinci kez hesap adı yazmak mümkün görünürdü;
     * sunucu reddeder ama kullanıcı sebebini anlamazdı.
     */
    const cell = stripComments(read('src/components/kasa/OdemeCell.tsx'))
    expect(cell).toMatch(/if \(paidLabel\)[\s\S]{0,200}return </)
  })

  it('hangi hesaba girdiği satırda yazıyor', () => {
    // Dört hesabı olan biri, parayı bulmak için döküm taramak zorunda kalmasın.
    expect(page).toContain('r.paidAccountName')
    expect(orders).toContain('paidAccountName')
  })
})
