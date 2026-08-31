import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ PANEL KAYITLARINI DÜZENLEME — DONMA KURALI
 *
 * ⚠️⚠️ TEK KURAL, DÖRT TABLODA AYNI:
 *   METİN ve TARİH her zaman düzenlenebilir.
 *   TUTAR yalnızca o kayda bağlı bir KASA HAREKETİ YOKKEN.
 *
 * Sebep bu oturumda kanıtlandı: tahsil edilmiş bir paketin satış tutarı
 * 20.000'den 99.000'e çekildiğinde kasa hareketi 20.000'de kalıyor ve arada
 * 79.000 TL'lik sessiz bir fark oluşuyordu.
 *
 * Canlı veritabanında ölçüldü: metin düzenlemesi bakiyeyi değiştirmedi,
 * bağlı olmayan tutar düzenlemesi bakiyeyi doğru değiştirdi, bağlı tutar
 * hem API'den hem SQL'den reddedildi.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const edit = stripComments(read('src/server/kasa/edit.ts'))

// ===========================================================================
describe('donma kuralı', () => {
  it('⚠️ DÖRT KAYIT TÜRÜNDE DE tutar donuyor', () => {
    for (const code of ['SALE_FROZEN', 'COST_FROZEN', 'AMOUNT_FROZEN', 'ENTRY_LINKED']) {
      expect(edit, `${code} yok`).toContain(code)
    }
  })

  it('paket: bağlı hareket varken satış ve maliyet ayrı ayrı kilitli', () => {
    expect(edit).toMatch(/pkg\.paymentEntryId &&[\s\S]{0,120}salePriceMinor/)
    expect(edit).toMatch(/pkg\.costEntryId &&[\s\S]{0,120}costMinor/)
  })

  it('sipariş: aynı kural', () => {
    expect(edit).toMatch(/order\.paymentEntryId &&[\s\S]{0,120}salePriceMinor/)
    expect(edit).toMatch(/order\.costEntryId &&[\s\S]{0,120}costMinor/)
  })

  it('alacak/borç: tahsil veya ödeme yapılmışsa tutar kilitli', () => {
    expect(edit).toMatch(/r\.settledEntryId &&[\s\S]{0,120}amountMinor/)
    expect(edit).toMatch(/p\.paidEntryId &&[\s\S]{0,120}amountMinor/)
  })

  it('⚠️ METİN VE TARİH KİLİTLENMEZ', () => {
    /**
     * Hepsini kilitlemek gereksiz katılık olurdu: bir yazım hatasını
     * düzeltmek parayı bozmaz. Kilit yalnızca paraya dokunan alanlardadır.
     */
    expect(edit).not.toMatch(/paymentEntryId &&[\s\S]{0,80}customerName/)
    expect(edit).not.toMatch(/paymentEntryId &&[\s\S]{0,80}description/)
  })

  it('⚠️ ASIL ENGEL VERİTABANINDA — uygulama kontrolü tek başına değil', () => {
    /**
     * Uygulama katmanı atlanabilir (elle SQL, ileride bir script);
     * tetikleyici atlanamaz. Bu test, tetikleyicilerin migration'larda
     * durduğunu doğrular.
     */
    const migrations = [
      'prisma/migrations/20260825110000_kasa_butunluk/migration.sql',
      'prisma/migrations/20260831090000_kasa_siparisler/migration.sql',
      'prisma/migrations/20260901120000_kasa_odeme_durumu/migration.sql',
    ]
    const all = migrations.map(read).join('\n')
    for (const fn of [
      'kasa_paket_tutar_dondur',
      'kasa_siparis_tutar_dondur',
      'kasa_alacak_tutar_dondur',
      'kasa_borc_tutar_dondur',
      'kasa_bagli_hareket_dondur',
    ]) {
      expect(all, `${fn} tetikleyicisi yok`).toContain(fn)
    }
  })
})

// ===========================================================================
describe('kasa hareketi düzenleme', () => {
  it('⚠️ BAĞLILIK DÖRT TABLODA DA ARANIYOR', () => {
    /**
     * Biri unutulsaydı, o tabloya bağlı bir hareketin tutarı arayüzden
     * serbestçe değiştirilebilir görünürdü — sunucu tetikleyicisi
     * reddederdi ama kullanıcı sebebini anlamadığı bir hata alırdı.
     */
    const fn = edit.slice(edit.indexOf('async function entryLinkedTo'), edit.indexOf('export async function updateEntry'))
    for (const t of ['servicePackage', 'manualOrder', 'receivable', 'scheduledPayment']) {
      expect(fn, `${t} kontrol edilmiyor`).toContain(t)
    }
  })

  it('kategori ↔ yön eşleşmesi düzenlemede de uygulanıyor', () => {
    // Atlanırsa "SATIS ama para çıkışı" gibi bir satır üretilebilir ve
    // kâr hesabı sessizce bozulur.
    expect(edit).toContain('DIRECTION_OF')
    expect(edit).toContain('DIRECTION_MISMATCH')
  })

  it('maliyet yalnızca satış satırında', () => {
    expect(edit).toContain('COST_NOT_ALLOWED')
  })

  it('⚠️ TRANSFERİN İKİ BACAĞI BİRLİKTE SİLİNİYOR', () => {
    /**
     * Yalnızca biri silinseydi para bir hesaptan çıkmış ama diğerine hiç
     * girmemiş görünürdü — toplam bakiye sessizce değişirdi.
     */
    expect(edit).toContain('transferGroupId')
    expect(edit).toMatch(/deleteMany\(\{[\s\S]{0,120}transferGroupId/)
  })

  it('bağlı hareket silinemez', () => {
    const del = edit.slice(edit.indexOf('export async function deleteEntry'))
    expect(del).toContain('ENTRY_LINKED')
  })
})

// ===========================================================================
describe('uçlar', () => {
  const routes = [
    'src/app/api/v1/admin/kasa/entries/[id]/route.ts',
    'src/app/api/v1/admin/kasa/paketler/[id]/duzenle/route.ts',
    'src/app/api/v1/admin/kasa/siparisler/[id]/duzenle/route.ts',
    'src/app/api/v1/admin/kasa/alacaklar/[id]/route.ts',
  ]

  it('dört düzenleme ucu da SUPERADMIN istiyor', () => {
    for (const f of routes) {
      expect(read(f), `${f} SUPERADMIN istemiyor`).toContain("minimumRole: 'SUPERADMIN'")
    }
  })

  it('⚠️ TÜM ALANLAR OPSİYONEL — kısmi güncelleme', () => {
    /**
     * Zorunlu olsalardı arayüz her düzenlemede tüm alanları göndermek
     * zorunda kalırdı; donmuş bir alan gönderilemediği için de düzenleme
     * hiç yapılamazdı.
     */
    for (const f of routes) {
      const schema = /const (?:patch)?schema = z\.object\(\{[\s\S]*?\n\}\)/i.exec(read(f))
      expect(schema, `${f} şeması bulunamadı`).not.toBeNull()
      const lines = schema![0].split('\n').filter((l) => /:\s*z\./.test(l))
      const required = lines.filter((l) => !l.includes('.optional()') && !l.includes('kind:'))
      expect(required, `${f} zorunlu alan içeriyor: ${required.join(' ')}`).toEqual([])
    }
  })
})

// ===========================================================================
describe('arayüz', () => {
  const inline = stripComments(read('src/components/kasa/InlineEdit.tsx'))

  it('⚠️ DONMUŞ ALAN GİZLENMEZ, KİLİTLİ GÖSTERİLİR', () => {
    /**
     * Gizlemek kullanıcıya "düzenleme bozuk" hissi verirdi; kilitli
     * gösterip sebebini yazmak kuralı öğretir.
     */
    expect(inline).toContain('disabled={Boolean(f.frozen)}')
    expect(inline).toMatch(/f\.frozen &&[\s\S]{0,200}🔒/)
  })

  it('⚠️ DONMUŞ ALAN İSTEKTE GÖNDERİLMİYOR', () => {
    // Gönderilseydi sunucu gereksiz bir ret üretirdi.
    expect(inline).toMatch(/if \(f\.frozen\) continue/)
  })

  it('para alanı kuruşa çevriliyor', () => {
    expect(inline).toContain('parseMajorToMinor')
  })

  it('⚠️ DÜZENLEME KUTUSUNA PARA SEMBOLÜ YAZILMIYOR', () => {
    /**
     * İlk hâli `formatMinor()` çıktısından "₺" işaretini regex ile
     * siliyordu; o çıktı kırılmaz boşluk kullanıyor ve sembol kutuya
     * sızsaydı kullanıcı hiç dokunmadığı bir alan yüzünden "sayı olmalı"
     * hatası alırdı.
     */
    expect(inline).not.toContain('formatMinor(')
    expect(inline).toContain('minorToInput')
  })

  it('form elemanı await’ten ÖNCE yakalanıyor', () => {
    // Bu oturumda üç formda birden bulunan hatanın aynısı.
    const submit = inline.slice(inline.indexOf('async function submit'))
    const capture = submit.indexOf('const formEl = e.currentTarget')
    const firstAwait = submit.indexOf('await ')
    expect(capture).toBeGreaterThan(-1)
    expect(capture).toBeLessThan(firstAwait)
  })

  it('postJson sözleşmesini kullanıyor — ham fetch yok', () => {
    expect(inline).toContain('postJson(')
    expect(inline).not.toMatch(/\bawait fetch\(/)
  })
})

// ===========================================================================
describe('dört tablo da düzenlenebilir', () => {
  it('kasa dökümü, paketler, siparişler ve alacak/borç ekranlarında düzenleme var', () => {
    const pages = [
      'src/app/(admin)/admin/(panel)/kasa/page.tsx',
      'src/app/(admin)/admin/(panel)/kasa/paketler/page.tsx',
      'src/app/(admin)/admin/(panel)/kasa/siparisler/page.tsx',
    ]
    for (const f of pages) {
      expect(read(f), `${f} düzenleme içermiyor`).toContain('InlineEdit')
    }
    // Kasa sayfasında dört yerde: döküm + alacak + borç (+ import)
    const kasa = read('src/app/(admin)/admin/(panel)/kasa/page.tsx')
    expect([...kasa.matchAll(/<InlineEdit/g)].length).toBeGreaterThanOrEqual(3)
  })

  it('⚠️ satır başına EK SORGU YOK — bağlılık tek sorguda', () => {
    /**
     * 200 hareketlik bir ayda satır başına dört sorgu 800 ek sorgu demekti.
     */
    const index = read('src/server/kasa/index.ts')
    expect(index).toContain('packagePayment: { select: { id: true } }')
    expect(index).toContain('linkedTo')
  })
})
