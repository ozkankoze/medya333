import { describe, expect, it } from 'vitest'

/**
 * ⭐ HİZMET AÇILIŞ SAYFALARI — KAPI SAYFASI KORUMASI
 *
 * ⚠️ Buradaki testlerin çoğu "fonksiyon doğru mu?" diye sormaz; **kural
 * hâlâ yürürlükte mi?** diye sorar. Kapı sayfası (doorway) cezası sessizdir:
 * kimse hata almaz, trafik aylar içinde erir. Tek savunmamız, metni olmayan
 * hizmetin indekslenememesi kuralıdır — ve o kural yalnızca burada
 * kilitlidir.
 */
import {
  SERVICE_COPY,
  copyFor,
  indexableServiceSlugs,
  isIndexable,
  parseServiceSlug,
  serviceSlug,
} from '@/lib/seo/service-pages'

/** Testte kullanılan sahte katalog — gerçek katalog DB'den gelir. */
const PLATFORMS = [
  { slug: 'instagram', services: [{ slug: 'takipci' }, { slug: 'begeni' }, { slug: 'kaydet' }] },
  { slug: 'tiktok', services: [{ slug: 'takipci' }, { slug: 'izlenme' }] },
] as const

describe('hizmet sayfası adresi', () => {
  it('platform ve hizmet slug\'ını birleştirir', () => {
    expect(serviceSlug('instagram', 'takipci')).toBe('instagram-takipci')
  })

  it('adres tekrar (platform, hizmet) ikilisine çözülür', () => {
    expect(parseServiceSlug('tiktok-izlenme', PLATFORMS)).toEqual({
      platformSlug: 'tiktok',
      serviceSlug: 'izlenme',
    })
  })

  it('⚠️ KATALOGDA OLMAYAN adres çözülmez — 404 verilebilsin', () => {
    // Aksi hâlde uydurma adresler boş sayfa üretir ve indekse sızar.
    expect(parseServiceSlug('instagram-yokboyle', PLATFORMS)).toBeNull()
    expect(parseServiceSlug('', PLATFORMS)).toBeNull()
    expect(parseServiceSlug('instagram', PLATFORMS)).toBeNull()
  })

  it('⚠️ AYNI HİZMET ADI FARKLI PLATFORMDA ÇAKIŞMAZ', () => {
    // "takipci" hem Instagram'da hem TikTok'ta var; iki ayrı sayfa olmalı.
    expect(parseServiceSlug('instagram-takipci', PLATFORMS)?.platformSlug).toBe('instagram')
    expect(parseServiceSlug('tiktok-takipci', PLATFORMS)?.platformSlug).toBe('tiktok')
  })
})

describe('⭐ kapı sayfası koruması', () => {
  it('editoryal metni OLAN hizmet indekslenebilir', () => {
    expect(isIndexable('instagram-takipci')).toBe(true)
    expect(copyFor('instagram-takipci')).not.toBeNull()
  })

  it('⚠️ METNİ OLMAYAN hizmet indekslenEMEZ', () => {
    // Sayfa yine açılır (kullanıcı gezebilir) ama `noindex` alır.
    expect(isIndexable('instagram-kaydet')).toBe(false)
    expect(copyFor('instagram-kaydet')).toBeNull()
  })

  it('⚠️ SİTEMAP yalnızca metni olanları içerir — katalogla birlikte şişmez', () => {
    const slugs = indexableServiceSlugs(PLATFORMS)
    expect(slugs).toContain('instagram-takipci')
    expect(slugs).toContain('instagram-begeni')
    // TikTok hizmetlerinin metni henüz yazılmadı: listeye GİRMEMELİ.
    expect(slugs).not.toContain('tiktok-takipci')
    expect(slugs).not.toContain('instagram-kaydet')
  })

  it('⚠️ sitemap listesi ile noindex kararı ASLA ayrışmaz', () => {
    // İki ayrı yerde iki ayrı kural olsaydı, biri "indeksle" derken diğeri
    // "indeksleme" derdi — Search Console'da teşhisi en zor hata sınıfı.
    for (const slug of indexableServiceSlugs(PLATFORMS)) {
      expect(isIndexable(slug)).toBe(true)
    }
  })
})

describe('editoryal metnin kendisi', () => {
  const entries = Object.entries(SERVICE_COPY)

  it('en az bir hizmetin metni yazılmış', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s — başlık, açıklama ve gövde dolu', (_slug, copy) => {
    expect(copy.heading.trim().length).toBeGreaterThan(0)
    expect(copy.body.length).toBeGreaterThanOrEqual(2)
    for (const p of copy.body) expect(p.trim().length).toBeGreaterThan(80)
  })

  /**
   * ⚠️ `<title>` 60 KARAKTERİ AŞMAMALI — aşarsa Google arama sonucunda
   * başlığı keser veya kendi yazdığıyla değiştirir; her iki durumda da
   * tıklama oranı üzerindeki kontrolümüzü kaybederiz.
   */
  it.each(entries)('%s — title 60 karakteri aşmıyor', (_slug, copy) => {
    /**
     * Kök düzendeki şablon `"%s · Medya 333"` — yani ekranda görünen başlık
     * buradaki metinden 12 karakter UZUNDUR. Toplam 60 sınırı, ham başlık
     * için 48'e iner. Şablon değişirse bu sayı da değişmelidir.
     */
    const SUFFIX = ' · Medya 333'.length
    expect(copy.title.length + SUFFIX).toBeLessThanOrEqual(60)
  })

  /**
   * ⚠️ META AÇIKLAMASI ~160 KARAKTERDE KESİLİR. Kesilen cümle yarım kalır
   * ve sonuç ucuz görünür.
   */
  it.each(entries)('%s — description 120–170 karakter arasında', (_slug, copy) => {
    expect(copy.description.length).toBeGreaterThanOrEqual(120)
    expect(copy.description.length).toBeLessThanOrEqual(170)
  })

  /**
   * ⚠️ EN BÜYÜK RİSK BURADA ÖLÇÜLÜR: sayfalar birbirinin kopyası olamaz.
   * Aynı gövde paragrafının iki hizmette görünmesi, şablon doldurmaya
   * kaydığımızın ilk işaretidir.
   */
  it('⚠️ HİÇBİR GÖVDE PARAGRAFI İKİ SAYFADA TEKRAR ETMEZ', () => {
    const seen = new Map<string, string>()
    for (const [slug, copy] of entries) {
      for (const p of copy.body) {
        const key = p.trim()
        const owner = seen.get(key)
        expect(owner, `"${slug}" paragrafı "${owner}" ile birebir aynı`).toBeUndefined()
        seen.set(key, slug)
      }
    }
  })

  it('⚠️ BAŞLIKLAR BENZERSİZ — iki sayfa aynı H1 ile yarışmaz', () => {
    const headings = entries.map(([, c]) => c.heading)
    expect(new Set(headings).size).toBe(headings.length)
  })

  /**
   * ⚠️ İŞ MODELİ SÖZLEŞMESİ. Bu metinler pazarlama metnidir ve en kolay
   * kayılacak yer burasıdır: "otomatik", "bot" gibi bir kelime, hem
   * gerçeğe aykırı olur hem de reklam politikası ihlaline dönüşür.
   */
  it('⚠️ metinlerde BOT/OTOMATİK VAADİ GEÇMEZ', () => {
    const forbidden = ['bot ', 'botla', 'sahte hesap', 'otomatik etkileşim', 'hack']
    for (const [slug, copy] of entries) {
      const text = [copy.heading, copy.description, ...copy.body, ...copy.faq.map((f) => f.a)]
        .join(' ')
        .toLocaleLowerCase('tr-TR')
      for (const word of forbidden) {
        // "hiçbir otomatik istek göndermez" gibi OLUMSUZ cümleler serbest;
        // yasaklı olan bir VAAT olarak geçmesidir.
        if (text.includes(word)) {
          expect(text, `"${slug}" içinde yasaklı ifade: ${word}`).toMatch(
            new RegExp(`(hiçbir|değil|yok|kullanılmaz|göndermez)[^.]{0,60}${word}`),
          )
        }
      }
    }
  })

  it('⚠️ ŞİFRE İSTENMEDİĞİ İDDİASI metinlerde tutarlı', () => {
    // Bir sayfada "şifre istemiyoruz" derken başka bir sayfada istemek,
    // güveni tek seferde bitirir. Şifre geçen her cümle olumsuz olmalı.
    for (const [slug, copy] of entries) {
      const text = [...copy.body, ...copy.faq.map((f) => f.a)].join(' ')
      for (const sentence of text.split(/(?<=\.)\s+/)) {
        if (!/şifre/i.test(sentence)) continue
        expect(sentence, `"${slug}" içinde şifre isteyen cümle`).toMatch(
          /(istemiyoruz|istemeyiz|gerekmez|hayır|istenmez|bizden gelmemiştir|istemez)/i,
        )
      }
    }
  })
})
