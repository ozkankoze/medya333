/**
 * robots.txt KURALLARI — her iki dal da test edilir (Faz 11)
 *
 * ⚠️ Bu test neden var? E2E paketi `APP_ENV=e2e` ile koşar; yani rota
 * dosyasını test etmek yalnızca CANLI OLMAYAN dalı doğrular. Canlıda ne
 * yazacağı — sitemap bildirimi, disallow listesi — ancak saf fonksiyon
 * üzerinden, canlıya çıkmadan doğrulanabilir.
 */

import { describe, expect, it } from 'vitest'
import { DISALLOWED_PATHS, buildRobots } from '@/lib/seo/robots-rules'

const BASE = 'https://www.medya333.com'

describe('CANLI dağıtım', () => {
  const r = buildRobots({ base: BASE, live: true })
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
    for (const p of ['/api/', '/yonetim/', '/panel/', '/hesabim', '/siparisler/', '/odeme/']) {
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
  const r = buildRobots({ base: 'https://onizleme-abc123.vercel.app', live: false })
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
    const live = JSON.stringify(buildRobots({ base: BASE, live: true }))
    const preview = JSON.stringify(buildRobots({ base: BASE, live: false }))
    expect(live).not.toBe(preview)
  })

  it('canlı-olmayan çıktı hiçbir alan adı sızdırmaz', () => {
    const preview = JSON.stringify(buildRobots({ base: BASE, live: false }))
    expect(preview).not.toContain('medya333.com')
  })
})
