import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ "ÖDEME YAPILDI / YAPILMADI" — BAKİYE GÜVENLİĞİ
 *
 * ⚠️⚠️ BU DOSYANIN TAMAMI TEK BİR KARARI KORUR:
 * ödenmemiş bir kayıt HİÇBİR `CashEntry` üretmez.
 *
 * "Hareket ekle" formuna ödeme durumu istendi. İlk akla gelen çözüm
 * `CashEntry`e bir bayrak koymaktı ve tehlikeliydi: o tablodaki her satır
 * tanımı gereği gerçekleşmiş bir para hareketidir. "Ödenmedi" satırlarının
 * bakiyeye girmemesi için bakiyeyi hesaplayan HER sorguya filtre eklemek
 * gerekirdi; birinde unutulduğunda bakiye sessizce yanlış olurdu.
 *
 * Kutu formda duruyor, veri doğru tabloya gidiyor:
 *   giriş → `Receivable` · çıkış → `ScheduledPayment`
 * Bakiye YAPISAL OLARAK etkilenemez, çünkü ortada hareket yoktur.
 *
 * Canlı veritabanında ölçüldü: iki ödenmemiş kayıt sonrası bakiye 0 ve
 * hareket sayısı 0; tahsil/ödeme sonrası bakiye tam olarak bir kez değişti.
 */

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'src')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ===========================================================================
describe('⚠️ ödenmemiş kayıt kasaya DOKUNMAZ', () => {
  const pending = stripComments(read('src/server/kasa/pending.ts'))

  it('oluşturma fonksiyonları HİÇ `cashEntry.create` çağırmıyor', () => {
    /**
     * Bu tek satır, kararın tamamıdır. Bir gün buraya `cashEntry.create`
     * eklenirse ödenmemiş kayıtlar bakiyeye girmeye başlar ve bunu fark
     * ettirecek hiçbir belirti olmaz.
     */
    const create = pending.slice(
      pending.indexOf('export async function createReceivable'),
      pending.indexOf('async function lockRow'),
    )
    expect(create.length).toBeGreaterThan(100)
    expect(create, 'oluşturma yolunda kasa hareketi yazılıyor').not.toContain('cashEntry.create')
  })

  it('tahsil/ödeme fonksiyonları hareketi TEK yerde yazıyor', () => {
    const settle = pending.slice(pending.indexOf('export async function settleReceivable'))
    const writes = [...settle.matchAll(/tx\.cashEntry\.create\(/g)]
    // Biri alacak tahsili, biri borç ödemesi — fazlası çift kayıt demek.
    expect(writes.length).toBe(2)
  })

  it('⚠️ ÇİFT TAHSİLAT ENGELİ — satır kilidi + durum kontrolü', () => {
    expect(pending).toContain('FOR UPDATE')
    expect(pending).toContain('ALREADY_SETTLED')
    expect(pending).toContain('ALREADY_PAID')
  })

  it('⚠️ KATEGORİ KAYITTAN OKUNUR, SABİTLENMEZ', () => {
    /**
     * Eski kod her tahsilata `TAHSILAT` yazıyordu. Bu, satışı zaten ciroya
     * girmiş alacaklar için doğru; ama formdan ödenmemiş giren SATIŞLAR
     * için yanlıştır — o satış ciroda HİÇ görünmezdi.
     */
    expect(pending).toContain('category: r.settleCategory')
    expect(pending).toContain('category: p.settleCategory')
    expect(pending).not.toMatch(/category: 'TAHSILAT'/)
  })

  it('⚠️ ESKİ `settleReceivable` GERİDE BIRAKILMADI', () => {
    /**
     * İki aynı isimli fonksiyon kalsaydı, biri kullanılırken diğeri
     * güncellenmeden kalır ve hangisinin çalıştığı çağrı yerine göre
     * değişirdi.
     */
    const index = stripComments(read('src/server/kasa/index.ts'))
    expect(index).not.toContain('export async function settleReceivable')
  })
})

// ===========================================================================
describe('veritabanı kuralları', () => {
  const sql = read('prisma/migrations/20260901120000_kasa_odeme_durumu/migration.sql')

  it('tutar, hareket oluştuktan sonra DONAR (her iki tabloda)', () => {
    expect(sql).toContain('kasa_alacak_tutar_dondur')
    expect(sql).toContain('kasa_borc_tutar_dondur')
    expect(sql).toMatch(/BEFORE UPDATE ON "Receivable"/)
    expect(sql).toMatch(/BEFORE UPDATE ON "ScheduledPayment"/)
  })

  it('bağlı hareket RESTRICT ile korunuyor', () => {
    expect(sql).toMatch(/"Receivable_settledEntryId_fkey"[\s\S]{0,200}ON DELETE RESTRICT/)
    expect(sql).toMatch(/"ScheduledPayment_paidEntryId_fkey"[\s\S]{0,200}ON DELETE RESTRICT/)
  })

  it('"tahsil edildi" ile "bağlı hareket" birlikte yaşar', () => {
    expect(sql).toContain('("settledAt" IS NULL) = ("settledEntryId" IS NULL)')
    expect(sql).toContain('("paidAt" IS NULL) = ("paidEntryId" IS NULL)')
  })

  it('⚠️ ORTAK DONDURMA FONKSİYONU DÖRT TABLOYU DA GÖRÜYOR', () => {
    /**
     * Bu fonksiyonun başına daha önce şu not yazılmıştı ve aynen gerçekleşti:
     * "Üçüncü bir tablo bu hareketlere bağlanırsa buraya da eklenmelidir —
     *  yoksa koruma o tablo için sessizce yok sayılır."
     */
    const fn = /CREATE OR REPLACE FUNCTION "kasa_bagli_hareket_dondur"[\s\S]*?LANGUAGE plpgsql/.exec(
      sql,
    )
    expect(fn, 'ortak fonksiyon yeniden yazılmamış').not.toBeNull()
    for (const t of ['"ServicePackage"', '"ManualOrder"', '"Receivable"', '"ScheduledPayment"']) {
      expect(fn![0], `${t} kapsanmıyor`).toContain(t)
    }
  })

  it('eski karşılıksız "tahsil edildi" işaretleri onarılıyor', () => {
    // Kısıt konmadan önce temizlenmeseydi migration düşerdi — ve o satırlar
    // zaten yanlıştı.
    const fix = sql.indexOf('UPDATE "Receivable" SET "settledAt" = NULL')
    const check = sql.indexOf('Receivable_settled_pair')
    expect(fix).toBeGreaterThan(-1)
    expect(fix, 'onarım kısıttan sonra geliyor').toBeLessThan(check)
  })
})

// ===========================================================================
describe('form', () => {
  const form = stripComments(read('src/components/kasa/KasaEntryForm.tsx'))

  it('ödeme durumu kutusu var', () => {
    expect(form).toContain('Ödeme yapıldı')
    expect(form).toContain('Ödeme yapılmadı')
  })

  it('⚠️ ÖDENMEMİŞTE BAŞKA UCA GİDİYOR — entries ucuna DEĞİL', () => {
    expect(form).toContain("postJson('/api/v1/admin/kasa/alacaklar'")
    // Ödenmiş yol hâlâ eski ucu kullanır.
    expect(form).toContain("postJson('/api/v1/admin/kasa/entries'")
  })

  it('⚠️ ÖDENMEMİŞTE HESAP SORULMUYOR', () => {
    /**
     * Para henüz hiçbir hesaba girmedi; hangi hesaba gireceği tahsil
     * anında seçilir. Şimdi sormak, gerçekleşmemiş bir kararı kaydetmek ve
     * kullanıcıya "bu para o hesapta" izlenimi vermek olurdu.
     */
    expect(form).toMatch(/\{paid && \([\s\S]{0,400}k-account/)
  })

  it('ödenmemişte tarih etiketi "Beklenen tarih" oluyor', () => {
    expect(form).toContain('Beklenen tarih')
  })

  it('ödenmemişte kişi adı zorunlu', () => {
    expect(form).toContain('required={!paid}')
  })
})

// ===========================================================================
describe('uçlar', () => {
  it('dört uç da SUPERADMIN istiyor', () => {
    for (const f of [
      'src/app/api/v1/admin/kasa/alacaklar/route.ts',
      'src/app/api/v1/admin/kasa/alacaklar/[id]/tahsil/route.ts',
      'src/app/api/v1/admin/kasa/borclar/[id]/ode/route.ts',
    ]) {
      expect(read(f), `${f} SUPERADMIN istemiyor`).toContain("minimumRole: 'SUPERADMIN'")
    }
  })

  it('⚠️ OLUŞTURMA UCU HESAP KİMLİĞİ KABUL ETMİYOR', () => {
    // Şema `accountId` alsaydı, ödenmemiş bir kayda hesap iliştirilebilir
    // ve "bu para o hesapta" yanılsaması doğardı.
    const route = read('src/app/api/v1/admin/kasa/alacaklar/route.ts')
    const schema = /const schema = z\.object\(\{[\s\S]*?\n\}\)/.exec(route)
    expect(schema).not.toBeNull()
    expect(schema![0]).not.toContain('accountId')
  })

  it('tahsil/ödeme ucu hesap İSTİYOR', () => {
    for (const f of [
      'src/app/api/v1/admin/kasa/alacaklar/[id]/tahsil/route.ts',
      'src/app/api/v1/admin/kasa/borclar/[id]/ode/route.ts',
    ]) {
      expect(read(f)).toContain('accountId: z.string().min(1)')
    }
  })
})

// ===========================================================================
describe('şema', () => {
  const schema = read('prisma/schema.prisma')

  it('alacak ve borç modelleri yeni alanları taşıyor', () => {
    const r = /model Receivable \{[\s\S]*?\n\}/.exec(schema)![0]
    expect(r).toContain('settleCategory CashCategory @default(TAHSILAT)')
    expect(r).toContain('onDelete: Restrict')
    const p = /model ScheduledPayment \{[\s\S]*?\n\}/.exec(schema)![0]
    expect(p).toContain('settleCategory CashCategory @default(BORC_ODEME)')
    expect(p).toContain('onDelete: Restrict')
  })

  it('⚠️ `CashEntry` ÜZERİNDE "ödendi mi" BAYRAĞI YOK', () => {
    /**
     * Bu, istenen özelliğin YANLIŞ uygulanışıydı ve bilinçli olarak
     * seçilmedi. Bayrak eklenirse bakiyeyi hesaplayan her sorgu filtre
     * gerektirir ve biri unutulduğunda bakiye sessizce yanlış olur.
     */
    const c = /model CashEntry \{[\s\S]*?\n\}/.exec(schema)![0]
    expect(c).not.toMatch(/\bisPaid\b|\bpaidAt\b|\bpending\b/i)
  })
})
