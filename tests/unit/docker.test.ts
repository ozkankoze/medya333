/**
 * ⭐ DAĞITIM YAPILANDIRMASI DENETİMİ (Faz 10)
 *
 * Bu testler İMAJI DEĞİL, imajı üreten TARİFİ denetler. İmajın kendisini
 * denetlemek Docker daemon'ı ister ve `scripts/verify-image.sh` ile yapılır;
 * o script bu ortamda ÇALIŞTIRILAMAZ ve çalıştırılmış gibi raporlanmaz.
 *
 * Buradaki testler, imajın yanlış üretilmesine yol açacak yapılandırma
 * hatalarını yakalar: `.env` kopyalanması, dev bağımlılığı taşınması, root
 * kullanıcı, gömülü sır, gömülü aşama.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

const dockerfile = read('Dockerfile')
const dockerignore = read('.dockerignore')
const compose = read('docker-compose.production.yml')

/** Yorum satırları çıkarılır — açıklamalar tam olarak yasakladığımız kalıbı anlatır. */
const code = (body: string) =>
  body
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')

const dockerfileCode = code(dockerfile)
const composeCode = code(compose)

/** Ortamlar arası ASLA imaja girmemesi gereken değişkenler. */
const SECRET_ENV = [
  'AUTH_SECRET',
  'ORDER_TOKEN_SECRET',
  'IP_HASH_SALT',
  'DATABASE_URL',
  'REDIS_URL',
  'RESEND_API_KEY',
  'PAYTR_MERCHANT_ID',
  'PAYTR_MERCHANT_KEY',
  'PAYTR_MERCHANT_SALT',
  'IYZICO_API_KEY',
  'IYZICO_SECRET_KEY',
  'SENTRY_DSN',
]

// ===========================================================================
describe('dağıtım dosyaları mevcut', () => {
  it('Dockerfile · .dockerignore · docker-compose.production.yml', () => {
    for (const f of ['Dockerfile', '.dockerignore', 'docker-compose.production.yml']) {
      expect(existsSync(path.join(ROOT, f)), `${f} yok`).toBe(true)
    }
  })

  it('imaj denetim scripti mevcut ve çalıştırılabilir olarak belgelenmiş', () => {
    const script = read('scripts/verify-image.sh')
    expect(script).toContain('#!/usr/bin/env bash')
    expect(script).toContain('set -uo pipefail')
  })
})

// ===========================================================================
describe('⚠️ imajda SIR YOK', () => {
  it('Dockerfile hiçbir sır değişkenini ENV/ARG olarak tanımlamaz', () => {
    for (const name of SECRET_ENV) {
      expect(dockerfileCode, `${name} Dockerfile'da tanımlı`).not.toMatch(
        new RegExp(`^\\s*(ENV|ARG)\\s+${name}[\\s=]`, 'm'),
      )
    }
  })

  it('Dockerfile .env dosyası KOPYALAMAZ', () => {
    expect(dockerfileCode).not.toMatch(/^\s*COPY\s+.*\.env/m)
    expect(dockerfileCode).not.toMatch(/^\s*ADD\s+.*\.env/m)
  })

  it('.dockerignore .env kalıplarını dışarıda bırakır', () => {
    for (const pattern of ['.env', '.env.*', '*.pem', '*.key']) {
      expect(dockerignore.split('\n').map((l) => l.trim())).toContain(pattern)
    }
  })

  it('⚠️ derleme, standalone çıktısındaki .env dosyasını da yakalar', () => {
    // `next build` derleme bağlamındaki `.env`i `.next/standalone/.env`
    // olarak KOPYALAR. Bu, bu fazda ölçülerek bulunmuş gerçek bir davranıştır.
    expect(dockerfileCode).toContain('.next/standalone')
    expect(dockerfileCode).toMatch(/find \.next\/standalone .*-name '\.env\*'/)
  })

  it('.dockerignore .git ve node_modules dışarıda bırakır', () => {
    const lines = dockerignore.split('\n').map((l) => l.trim())
    // .git: silinmiş bir commit'teki sır hâlâ oradadır
    expect(lines).toContain('.git')
    expect(lines).toContain('node_modules')
  })

  it('⚠️ .dockerignore hiçbir .env kalıbını GERİ ALMAZ (! ile istisna yok)', () => {
    const negations = dockerignore
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('!'))
    for (const n of negations) {
      expect(n.toLowerCase(), `"${n}" .env istisnası açıyor`).not.toContain('env')
      expect(n.toLowerCase()).not.toContain('pem')
      expect(n.toLowerCase()).not.toContain('key')
    }
  })

  it('compose dosyasında GÖMÜLÜ değer yok — hepsi ${...} ile dışarıdan gelir', () => {
    for (const name of SECRET_ENV) {
      const line = composeCode.split('\n').find((l) => l.trim().startsWith(`${name}:`))
      if (!line) continue
      expect(line, `${name} compose içinde sabit değer taşıyor`).toMatch(/\$\{/)
    }
  })

  it('compose dosyası .env dosyasını konteynere BAĞLAMAZ', () => {
    expect(composeCode).not.toMatch(/\.env\s*:/)
    expect(composeCode).not.toMatch(/env_file/)
  })
})

// ===========================================================================
describe('⚠️ imajda DEV BAĞIMLILIĞI YOK', () => {
  it('çalışma katmanı standalone çıktısını taşır, node_modules kopyalamaz', () => {
    const runner = dockerfileCode.slice(dockerfileCode.lastIndexOf('AS runner'))
    expect(runner).toContain('.next/standalone')
    // `COPY --from=deps /app/node_modules` yalnızca DERLEME katmanında olmalı
    expect(runner).not.toMatch(/COPY\s+--from=\w+(\s+--chown=\S+)?\s+\/app\/node_modules/)
  })

  it('next.config.ts standalone çıktı üretir', () => {
    expect(read('next.config.ts')).toMatch(/output:\s*'standalone'/)
  })

  it('bağımlılıklar `npm ci` ile kurulur (npm install değil)', () => {
    expect(dockerfileCode).toMatch(/npm ci\b/)
    expect(dockerfileCode).not.toMatch(/npm i(nstall)?\s+(?!--)/)
  })
})

// ===========================================================================
describe('⚠️ NON-ROOT çalışma', () => {
  it('USER direktifi var ve root değil', () => {
    const users = [...dockerfileCode.matchAll(/^\s*USER\s+(\S+)/gm)].map((m) => m[1]!)
    expect(users.length, 'USER direktifi yok').toBeGreaterThan(0)
    expect(users.at(-1)).not.toBe('root')
    expect(users.at(-1)).not.toBe('0')
  })

  it('USER, son (runner) katmanda tanımlıdır', () => {
    const runner = dockerfileCode.slice(dockerfileCode.lastIndexOf('AS runner'))
    expect(runner).toMatch(/^\s*USER\s+\S+/m)
  })

  it('compose: yetki yükseltme kapalı, yetenekler düşürülmüş', () => {
    expect(composeCode).toContain('no-new-privileges:true')
    expect(composeCode).toContain('cap_drop')
  })
})

// ===========================================================================
describe('sağlık ucu', () => {
  it('HEALTHCHECK tanımlı ve /api/health kullanıyor', () => {
    expect(dockerfileCode).toMatch(/^\s*HEALTHCHECK\s/m)
    expect(dockerfileCode).toContain('/api/health')
  })

  it('sağlık uçları gerçekten var', () => {
    expect(existsSync(path.join(ROOT, 'src/app/api/health/route.ts'))).toBe(true)
    expect(existsSync(path.join(ROOT, 'src/app/api/health/live/route.ts'))).toBe(true)
  })
})

// ===========================================================================
describe('taşınabilirlik ve tekrarlanabilirlik', () => {
  it('taban imaj sürümü SABİTLENMİŞ (latest yok)', () => {
    expect(dockerfileCode).not.toMatch(/FROM\s+\S+:latest/)
    expect(dockerfileCode).toMatch(/ARG NODE_VERSION=\d+\.\d+\.\d+/)
  })

  it('⚠️ APP_ENV imaja GÖMÜLMEZ — aynı imaj staging ve canlıda çalışır', () => {
    expect(dockerfileCode).not.toMatch(/^\s*ENV\s+APP_ENV/m)
  })

  it('giriş noktası `node server.js` — npm ara süreci yok (SIGTERM iletimi)', () => {
    expect(dockerfileCode).toMatch(/CMD\s+\["node",\s*"server\.js"\]/)
    expect(dockerfileCode).not.toMatch(/CMD\s+\[?"?npm/)
  })

  it('hosting sağlayıcısına özgü hiçbir şey yok', () => {
    const all = `${dockerfile}\n${compose}`.toLowerCase()
    for (const vendor of ['vercel', 'heroku', 'netlify', 'railway.app', 'fly.io', 'render.com']) {
      expect(all, `${vendor} referansı var`).not.toContain(vendor)
    }
  })

  it('compose imaj etiketi zorunlu — `latest` varsayılanı yok', () => {
    expect(composeCode).toMatch(/image:\s*\$\{APP_IMAGE:\?/)
  })
})

// ===========================================================================
describe('source map davranışı bilinçli', () => {
  it('productionBrowserSourceMaps açıkça false', () => {
    expect(read('next.config.ts')).toMatch(/productionBrowserSourceMaps:\s*false/)
  })
})
