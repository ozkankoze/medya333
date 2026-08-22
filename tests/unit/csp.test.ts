/**
 * ⭐ CONTENT-SECURITY-POLICY — SAF ÜRETİCİ TESTİ
 *
 * ⚠️ NEDEN VAR?
 *
 * `next dev` altında React Fast Refresh çalışma zamanı `eval` kullanır. CSP
 * bunu engellediğinde tarayıcı `main-app.js` yüklenirken `EvalError` atar ve
 * **istemci paketi hiç çalışmaz**: React hidre olmaz. Sayfa doğru görünür,
 * butonlar gerçek `<button>`'dır, ama hiçbir `onClick` bağlanmaz — tıklamalar
 * sessizce hiçbir şey yapmaz.
 *
 * Bu, teşhisi en zor arıza türüdür: görünürde hata yoktur, sadece "hiçbir şey
 * olmaz". Bu yüzden hem iznin geliştirmede VERİLDİĞİ hem de üretime
 * SIZMADIĞI ayrı ayrı sabitlenir.
 */

import { describe, expect, it } from 'vitest'
import { buildCsp, PAYMENT_FRAME_SRC } from '@/lib/security/csp'

/** `script-src ...` gibi tek bir direktifi ayıklar. */
function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((d) => d.startsWith(`${name} `) || d === name)
  return found ?? ''
}

describe('⚠️ ÜRETİM — gevşetme yok', () => {
  const prod = buildCsp({ dev: false, googleAds: false })

  it('`unsafe-eval` HİÇBİR direktifte yok', () => {
    expect(prod).not.toContain('unsafe-eval')
  })

  it('geliştirmeye özgü izinler sızmıyor', () => {
    expect(prod).not.toContain('ws:')
    expect(prod).not.toContain('wss:')
  })

  it('script-src tam olarak eskisi gibi', () => {
    expect(directive(prod, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
  })

  it('connect-src tam olarak eskisi gibi', () => {
    expect(directive(prod, 'connect-src')).toBe("connect-src 'self'")
  })

  it('kilitleyici direktifler korunuyor', () => {
    expect(prod).toContain("frame-ancestors 'none'")
    expect(prod).toContain("object-src 'none'")
    expect(prod).toContain("base-uri 'self'")
    expect(prod).toContain("default-src 'self'")
    expect(prod).toContain('upgrade-insecure-requests')
  })

  it('ödeme sağlayıcıları hâlâ çerçevelenebiliyor (3D Secure)', () => {
    for (const origin of PAYMENT_FRAME_SRC) {
      expect(directive(prod, 'frame-src')).toContain(origin)
      expect(directive(prod, 'form-action')).toContain(origin)
    }
  })
})

describe('GELİŞTİRME — Fast Refresh çalışabilmeli', () => {
  const dev = buildCsp({ dev: true, googleAds: false })

  it("script-src 'unsafe-eval' içerir", () => {
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'")
  })

  it('HMR WebSocket bağlanabilir', () => {
    expect(directive(dev, 'connect-src')).toContain('ws:')
  })

  it('⚠️ `upgrade-insecure-requests` YOK — http://localhost kırılmasın', () => {
    expect(dev).not.toContain('upgrade-insecure-requests')
  })

  it('güvenlik kilitleri geliştirmede de duruyor', () => {
    // Gevşetme YALNIZCA eval ve ws ile sınırlıdır; kapıları ardına kadar
    // açmak, geliştirmede çalışıp üretimde patlayan koda davetiye olurdu.
    expect(dev).toContain("frame-ancestors 'none'")
    expect(dev).toContain("object-src 'none'")
    expect(dev).toContain("base-uri 'self'")
  })
})

describe('⚠️ İKİ ORTAM ARASINDAKİ TEK FARK ÖLÇÜLÜR', () => {
  it('yalnızca script-src, connect-src ve upgrade-insecure-requests değişir', () => {
    const prodSet = new Set(buildCsp({ dev: false, googleAds: false }).split('; '))
    const devSet = new Set(buildCsp({ dev: true, googleAds: false }).split('; '))

    const onlyInProd = [...prodSet].filter((d) => !devSet.has(d))
    const onlyInDev = [...devSet].filter((d) => !prodSet.has(d))

    expect(onlyInProd.sort()).toEqual([
      "connect-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      'upgrade-insecure-requests',
    ])
    expect(onlyInDev.sort()).toEqual([
      "connect-src 'self' ws: wss:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    ])
  })
})

/**
 * ⭐ GOOGLE ADS — ETİKET VE POLİTİKA AYNI ANDA AÇILIR
 *
 * ⚠️ Bu testlerin varlık sebebi çok belirli bir sessiz arıza: script sayfaya
 * eklenir, tarayıcı CSP yüzünden engeller, konsolda kimse bakmaz ve
 * DÖNÜŞÜMLER HİÇ DÜŞMEZ. Reklam bütçesi haftalarca körlemesine harcanır.
 * Alan adları Google'ın kendi CSP kılavuzundan alınmıştır.
 */
describe('Google Ads dönüşüm takibi — CSP', () => {
  const off = buildCsp({ dev: false, googleAds: false })
  const on = buildCsp({ dev: false, googleAds: true })

  it('⚠️ ETİKET KAPALIYKEN hiçbir Google alan adı politikada YOK', () => {
    for (const host of ['googletagmanager', 'googleadservices', 'doubleclick', 'googlesyndication']) {
      expect(off, host).not.toContain(host)
    }
    // Kapalıyken politika eskisiyle birebir aynı kalmalı.
    expect(directive(off, 'img-src')).toBe("img-src 'self' data: blob:")
    expect(directive(off, 'connect-src')).toBe("connect-src 'self'")
  })

  it('etiket açıkken gtag.js YÜKLENEBİLİR', () => {
    expect(directive(on, 'script-src')).toContain('https://www.googletagmanager.com')
  })

  it('etiket açıkken dönüşüm işaretçileri GÖNDERİLEBİLİR', () => {
    const connect = directive(on, 'connect-src')
    for (const origin of [
      'https://www.googleadservices.com',
      'https://googleads.g.doubleclick.net',
      'https://pagead2.googlesyndication.com',
    ]) {
      expect(connect, origin).toContain(origin)
    }
  })

  it('⚠️ TÜRKİYE ALAN ADI ŞART — dönüşüm pikseli www.google.com.tr\'ye gider', () => {
    // Google pikseli kullanıcının ülke alan adına atar; `www.google.com`
    // tek başına Türkiye trafiğinde YETMEZ.
    expect(directive(on, 'img-src')).toContain('https://www.google.com.tr')
    expect(directive(on, 'connect-src')).toContain('https://www.google.com.tr')
  })

  it('⚠️ Google izinleri ödeme/kilit direktiflerini BOZMAZ', () => {
    for (const origin of PAYMENT_FRAME_SRC) {
      expect(directive(on, 'frame-src')).toContain(origin)
    }
    expect(on).toContain("frame-ancestors 'none'")
    expect(on).toContain("object-src 'none'")
    expect(on).toContain("base-uri 'self'")
    expect(on).not.toContain('unsafe-eval')
  })
})
