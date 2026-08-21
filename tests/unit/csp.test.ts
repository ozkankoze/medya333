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
  const prod = buildCsp({ dev: false })

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
  const dev = buildCsp({ dev: true })

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
    const prodSet = new Set(buildCsp({ dev: false }).split('; '))
    const devSet = new Set(buildCsp({ dev: true }).split('; '))

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
