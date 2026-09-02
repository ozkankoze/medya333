import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ DENEME PAKETLERİ + ALACAK SATIRINDAN TAHSİLAT
 *
 * ⚠️⚠️ EN KRİTİK KURAL: DENEME PAKETLERİ AYLIK PAKETLERLE AYNI TABLODA
 * DURUR ve yalnızca `isTrial` bayrağıyla ayrılır. Bu yüzden her okuma
 * filtreyi AÇIKÇA vermek zorundadır — biri unutulursa denemeler aylık
 * ciroya karışır ve hiçbir hata düşmez, rakam sadece yanlış olur.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const server = stripComments(read('src/server/kasa/packages.ts'))
const deneme = stripComments(read('src/app/(admin)/admin/(panel)/kasa/deneme/page.tsx'))
const aylik = stripComments(read('src/app/(admin)/admin/(panel)/kasa/paketler/page.tsx'))
const kasa = stripComments(read('src/app/(admin)/admin/(panel)/kasa/page.tsx'))
const form = stripComments(read('src/components/kasa/PackageForm.tsx'))

// ===========================================================================
describe('ayrım', () => {
  it('⚠️⚠️ FİLTRE ZORUNLU — varsayılanı yok', () => {
    /**
     * İsteğe bağlı olsaydı, çağıran kod filtreyi yazmayı unuttuğunda ekran
     * ikisini birden gösterir; deneme paketleri aylık ciroya karışırdı.
     * TypeScript'in unutmayı derleme anında yakalaması için parametre
     * zorunlu tutuldu.
     */
    expect(server).toMatch(/opts: \{ trial: boolean \}/)
    expect(server).toContain('where: { isTrial: opts.trial }')
  })

  it('her okuma hangisini istediğini açıkça söylüyor', () => {
    expect(aylik).toContain('{ trial: false }')
    expect(kasa).toContain('{ trial: false }')
    expect(deneme).toContain('{ trial: true }')
  })

  it('⚠️ FORM BAYRAĞI GÖNDERİYOR', () => {
    // Gönderilmezse kayıt normal paket olarak açılır ve aylık ciroya karışır.
    expect(form).toContain('isTrial,')
    expect(deneme).toContain('<PackageForm isTrial />')
    expect(aylik).toContain('<PackageForm />')
  })

  it('⚠️ AYRI TABLO AÇILMADI', () => {
    /**
     * Ayrı tablo; tahsilat akışını, tutar dondurma tetikleyicilerini ve
     * silme korumalarını ikinci kez yazmak demekti. İki kopya er geç
     * ayrışır — birinde düzeltilen kusur diğerinde yaşamaya devam eder.
     */
    const schema = read('prisma/schema.prisma')
    expect(schema).not.toContain('model TrialPackage')
    expect(schema).toContain('isTrial Boolean @default(false)')
    const sql = read('prisma/migrations/20260902090000_deneme_paketleri/migration.sql')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "isTrial"')
    expect(sql).not.toMatch(/CREATE TABLE/i)
  })
})

// ===========================================================================
describe('dönüşüm', () => {
  const fn = server.slice(server.indexOf('export async function getTrialConversion'))

  it('⚠️⚠️ "SONRA BAŞLAYAN" ŞARTI VAR', () => {
    /**
     * Yalnızca "ücretli paketi var mı?" diye bakılsaydı, denemeden ÖNCE
     * zaten müşteri olan biri de dönüşüm sayılır ve kampanyanın başarısı
     * olduğundan yüksek görünürdü.
     */
    expect(fn).toMatch(/s\.getTime\(\) > t\.endDate\.getTime\(\)/)
  })

  it('⚠️ DENEMESİ BİTMEMİŞ OLAN HİÇBİR TARAFA YAZILMAZ', () => {
    // "Henüz belli değil"i "dönüşmedi" saymak, oranı haksız yere düşürürdü.
    expect(fn).toMatch(/pending: t\.endDate\.getTime\(\) >= today\.getTime\(\)/)
    expect(fn).toContain('const bitmis = rows.filter((r) => !r.pending)')
  })

  it('iptaller sayılmaz', () => {
    expect(fn).toContain('canceledAt: null')
  })

  it('⚠️ İSİM KARŞILAŞTIRMASI TÜRKÇE KÜÇÜLTMEYLE', () => {
    // İngilizce küçültme "I" harfini yanlış çevirir; "IŞIL" ile "ışıl"
    // aynı müşteri sayılmazdı.
    expect(fn).toContain("toLocaleLowerCase('tr-TR')")
  })

  it('kural ekranda YAZILI', () => {
    expect(deneme).toContain('Dönüşüm bir çıkarımdır:')
    expect(deneme).toContain('sonra başlayan')
  })

  it('⚠️ DEVAMLILIK BLOĞU DENEME EKRANINDA YOK', () => {
    /**
     * Denemede sorulan soru "yenilendi mi?" değil "ücretliye dönüştü mü?".
     * İkisi birden gösterilseydi iki benzer ama farklı oran yan yana
     * durur, hangisine bakılacağı belirsizleşirdi.
     */
    expect(deneme).not.toContain('RetentionList')
    expect(aylik).toContain('RetentionList')
  })
})

// ===========================================================================
describe('alacak satırından tahsilat', () => {
  const cell = stripComments(read('src/components/kasa/AlacakOdeme.tsx'))
  const home = stripComments(read('src/app/(admin)/admin/(panel)/page.tsx'))

  it('⚠️ ALACAK GÖRÜLDÜĞÜ YERDE KAPATILABİLİYOR', () => {
    /**
     * Liste salt okunurdu: para geldiğinde kullanıcı Siparişler sayfasına
     * gidip satırı aramak zorunda kalıyordu. Kayıt ertelenirse liste
     * gerçeği göstermeyi bırakır.
     */
    expect(home).toContain('<AlacakOdeme')
    expect(home).toContain('hesaplar={hesapSecenekleri}')
  })

  it('⚠️ SİPARİŞ DALINDA ÇÖZÜMLEME SUNUCUDA', () => {
    // Tek doğruluk kaynağı: ham metin sunucuya gider, orada çözülür.
    expect(cell).toMatch(/siparisler\/\$\{id\}\/odeme`, \{ odeme: value \}/)
  })

  it('alacak dalında aynı saf işlev kullanılıyor', () => {
    // İki ekranda iki farklı kural olsaydı hangisinin ne yaptığı
    // ezberlenmek zorunda kalırdı.
    expect(cell).toContain("from '@/lib/kasa/odeme-alani'")
    expect(cell).toContain('odemeCozumle(value, hesaplar)')
  })

  it('form elemanı senkron yakalanıyor', () => {
    expect(cell).toContain('function withForm(')
    const kaydet = cell.slice(cell.indexOf('async function kaydet'))
    expect(kaydet).not.toContain('currentTarget')
  })
})
