/**
 * robots.txt KURALLARI — her iki dal da test edilir (Faz 11)
 *
 * ⚠️ Bu test neden var? E2E paketi `APP_ENV=e2e` ile koşar; yani rota
 * dosyasını test etmek yalnızca CANLI OLMAYAN dalı doğrular. Canlıda ne
 * yazacağı — sitemap bildirimi, disallow listesi — ancak saf fonksiyon
 * üzerinden, canlıya çıkmadan doğrulanabilir.
 */

import { describe, expect, it } from 'vitest'
import { DISALLOWED_PATHS, buildRobots, isIndexableRequest } from '@/lib/seo/robots-rules'

const BASE = 'https://www.medya333.com'

describe('CANLI dağıtım', () => {
  const r = buildRobots({ base: BASE, indexable: true })
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules]
  const rule = rules[0]!

  it('site taranmaya açıktır', () => {
    expect(rule.allow).toBe('/')
    expect(rule.userAgent).toBe('*')
  })

  it('sitemap ve host üretim alan adını gösterir', () => {
    expect(r.sitemap).toBe(`${BASE}/sitemap.xml`)
    expect(r.host).toBe(BASE)
  })

  it('⚠️ panel, hesap, sipariş ve ödeme yolları engellenir', () => {
    const disallow = rule.disallow as string[]
    for (const p of ['/api/', '/admin/', '/panel/', '/hesabim', '/siparisler/', '/odeme/']) {
      expect(disallow, `${p} engellenmemiş`).toContain(p)
    }
  })

  it('⚠️ giriş ve kayıt engellenir (?next= adresleri birikmesin)', () => {
    const disallow = rule.disallow as string[]
    expect(disallow).toContain('/giris')
    expect(disallow).toContain('/kayit')
  })

  it('disallow listesi tek kaynaktan gelir', () => {
    expect(rule.disallow).toEqual([...DISALLOWED_PATHS])
  })
})

describe('⭐ CANLI OLMAYAN dağıtım (preview / staging / e2e)', () => {
  const r = buildRobots({ base: 'https://onizleme-abc123.vercel.app', indexable: false })
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules]
  const rule = rules[0]!

  it('⚠️ TÜM site kapatılır — aynı içerik iki adreste indekslenmez', () => {
    expect(rule.disallow).toBe('/')
    expect(rule.allow).toBeUndefined()
  })

  it('⚠️ sitemap BİLDİRİLMEZ — kapalı ortamın haritası verilmez', () => {
    expect(r.sitemap).toBeUndefined()
    expect(r.host).toBeUndefined()
  })
})

describe('iki dal birbirine karışmaz', () => {
  it('canlı çıktı ile canlı-olmayan çıktı AYNI DEĞİL', () => {
    const live = JSON.stringify(buildRobots({ base: BASE, indexable: true }))
    const preview = JSON.stringify(buildRobots({ base: BASE, indexable: false }))
    expect(live).not.toBe(preview)
  })

  it('canlı-olmayan çıktı hiçbir alan adı sızdırmaz', () => {
    const preview = JSON.stringify(buildRobots({ base: BASE, indexable: false }))
    expect(preview).not.toContain('medya333.com')
  })
})

// ===========================================================================
/**
 * ⭐⭐ İNDEKSLENEBİLİRLİK KARARI — GERÇEK BİR KESİNTİDEN DOĞDU
 *
 * `www.medya333.com/robots.txt` bir gün TÜM SİTEYİ Google'a kapattı. Sebep:
 * canlı projede `APP_ENV` "production" değildi, dolayısıyla kod kendini bir
 * preview sandı. Hiçbir hata düşmedi, hiçbir test kırılmadı — site yalnızca
 * arama motoruna görünmez oldu.
 *
 * Daha derin sorun: `APP_ENV` aynı anda "gerçek para tahsil edilebilir mi?"
 * sorusunu da yönetiyordu. PayTR onayı beklenirken o soruya "hayır" demek
 * zorunluydu ve bu, indekslenmeye de zorla "hayır" dedirtiyordu.
 *
 * Karar artık şuna bağlı: istek KANONİK ALAN ADINA mı geldi?
 */
describe('indekslenebilirlik — kanonik host ölçütü', () => {
  const CANONICAL = 'https://www.medya333.com'

  it('⭐ KANONİK HOST\'A gelen istek indekslenebilir — APP_ENV\'den BAĞIMSIZ', () => {
    // Kesintinin tam senaryosu: live=false ama istek canlı alan adına geldi.
    expect(
      isIndexableRequest({ base: CANONICAL, requestHost: 'www.medya333.com', live: false }),
    ).toBe(true)
  })

  it('⚠️ PREVIEW dağıtımı indekslenMEZ — kendi alias\'ında cevap verir', () => {
    expect(
      isIndexableRequest({
        base: CANONICAL,
        requestHost: 'medya333-git-main-abc.vercel.app',
        live: false,
      }),
    ).toBe(false)
    // live=true olsa bile: host eşleşmiyorsa indekslenmez.
    expect(
      isIndexableRequest({
        base: CANONICAL,
        requestHost: 'medya333-ex86.vercel.app',
        live: true,
      }),
    ).toBe(false)
  })

  it('⚠️ TABAN ADRES ALIAS ise HİÇBİR ŞEY indekslenmez (fail-closed)', () => {
    /**
     * `APP_BASE_URL` yanlışlıkla `*.vercel.app` bırakılmışsa, o adrese gelen
     * istek host olarak eşleşse bile indekslenmemeli: aksi hâlde site iki
     * ayrı host üzerinden indekslenir ve yinelenen içerik doğar.
     */
    expect(
      isIndexableRequest({
        base: 'https://medya333.vercel.app',
        requestHost: 'medya333.vercel.app',
        live: true,
      }),
    ).toBe(false)
  })

  it('⚠️ YEREL GELİŞTİRME indekslenmez — HTTPS değil', () => {
    expect(
      isIndexableRequest({ base: 'http://localhost:3000', requestHost: 'localhost:3000', live: true }),
    ).toBe(false)
  })

  it('host okunamazsa ESKİ ölçüte düşer', () => {
    // Bilinmeyen durumda yeni kural uydurulmaz; önceki bilinen davranış sürer.
    expect(isIndexableRequest({ base: CANONICAL, requestHost: null, live: true })).toBe(true)
    expect(isIndexableRequest({ base: CANONICAL, requestHost: null, live: false })).toBe(false)
  })

  it('host karşılaştırması büyük/küçük harf ve :443 farkını yutar', () => {
    expect(
      isIndexableRequest({ base: CANONICAL, requestHost: 'WWW.Medya333.com', live: false }),
    ).toBe(true)
    expect(
      isIndexableRequest({ base: CANONICAL, requestHost: 'www.medya333.com:443', live: false }),
    ).toBe(true)
  })

  it('⚠️ APEX ve WWW AYRI HOST\'TUR — apex indekslenmez', () => {
    /**
     * `medya333.com` → `www.medya333.com` 308 ile yönlendirilir; yönlendiren
     * adresin kendi robots.txt'sini açmak, iki host'un da taranabilir
     * görünmesine yol açardı.
     */
    expect(
      isIndexableRequest({ base: CANONICAL, requestHost: 'medya333.com', live: true }),
    ).toBe(false)
  })

  it('⚠️ TAKLİT HOST eşleşmez', () => {
    expect(
      isIndexableRequest({
        base: CANONICAL,
        requestHost: 'www.medya333.com.saldirgan.net',
        live: true,
      }),
    ).toBe(false)
  })

  it('bozuk taban adres indekslenebilirlik üretmez', () => {
    expect(isIndexableRequest({ base: 'bu adres degil', requestHost: 'x', live: true })).toBe(false)
  })
})
