import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ ÜRETİM DENETİMİ — KAYNAK KODU TARAMASI (Faz 7)
 *
 * Bu testler davranış değil, KOD TABANININ KENDİSİNİ denetler. Amaç:
 * canlıya çıkmadan önce "geliştirme kolaylığı" kalıntılarını ve sır
 * sızıntılarını yakalamak.
 */

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'src')

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (entry === 'generated' || entry === 'node_modules' || entry === '.next') continue
    if (statSync(full).isDirectory()) out.push(...walk(full, filter))
    else if (filter(full)) out.push(full)
  }
  return out
}

const sourceFiles = walk(SRC, (p) => /\.(ts|tsx)$/.test(p))
const read = (p: string) => readFileSync(p, 'utf8')
const rel = (p: string) => path.relative(ROOT, p)

/** `src/server/**` dışındaki dosyalar istemciye ulaşabilir. */
const clientReachable = sourceFiles.filter(
  (p) => !p.includes(`${path.sep}server${path.sep}`) && !p.endsWith('env.ts'),
)

// ===========================================================================
describe('sır sızıntısı', () => {
  const SECRET_ENV_NAMES = [
    'AUTH_SECRET',
    'ORDER_TOKEN_SECRET',
    'IP_HASH_SALT',
    'IYZICO_SECRET_KEY',
    'IYZICO_API_KEY',
    'PAYTR_MERCHANT_KEY',
    'PAYTR_MERCHANT_SALT',
    'PAYTR_MERCHANT_ID',
    'GOOGLE_CLIENT_SECRET',
    'INVOICE_API_SECRET',
    'RESEND_API_KEY',
    'DATABASE_URL',
    'REDIS_URL',
  ]

  it('⚠️ hiçbir secret NEXT_PUBLIC_ olarak tanımlanmamıştır', () => {
    const envFile = read(path.join(SRC, 'env.ts'))
    const clientBlock = envFile.slice(envFile.indexOf('client: {'), envFile.indexOf('runtimeEnv:'))
    for (const name of SECRET_ENV_NAMES) {
      expect(clientBlock, `${name} client bloğunda`).not.toContain(name)
    }
    // client bloğundaki HER anahtar NEXT_PUBLIC_ ile başlamalı
    const keys = [...clientBlock.matchAll(/^\s{4}([A-Z0-9_]+):/gm)].map((m) => m[1]!)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(k.startsWith('NEXT_PUBLIC_'), `${k}`).toBe(true)
  })

  it('⚠️ istemciye ulaşabilen dosyalar secret env okumaz', () => {
    const offenders: string[] = []
    for (const file of clientReachable) {
      const body = read(file)
      for (const name of SECRET_ENV_NAMES) {
        // `env.X` veya `process.env.X`
        if (new RegExp(`(?:process\\.)?env\\.${name}\\b`).test(body)) {
          offenders.push(`${rel(file)} → ${name}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('⚠️ kaynak kodda gömülü kimlik bilgisi yok', () => {
    // Gerçek anahtar biçimleri: sk_live_, AIza…, uzun base64 secret ataması
    const patterns: Array<[string, RegExp]> = [
      ['stripe/sk_live', /\bsk_live_[A-Za-z0-9]{10,}/],
      ['google api key', /\bAIza[0-9A-Za-z_-]{30,}/],
      ['aws key', /\bAKIA[0-9A-Z]{16}\b/],
      ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ['bearer literal', /Bearer\s+[A-Za-z0-9._-]{24,}/],
    ]
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const body = read(file)
      for (const [label, re] of patterns) {
        if (re.test(body)) offenders.push(`${rel(file)} → ${label}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// ===========================================================================
describe('kart verisi', () => {
  it('⚠️ şemada PAN/CVV alanı YOK', () => {
    const schema = read(path.join(ROOT, 'prisma/schema.prisma'))
    // Alan ADI olarak arama — açıklama satırlarında geçmesi serbest
    const fieldNames = [...schema.matchAll(/^\s{2}(\w+)\s+\w/gm)].map((m) => m[1]!.toLowerCase())
    for (const banned of ['cardnumber', 'pan', 'cvv', 'cvc', 'cardholder', 'expirymonth', 'expiryyear']) {
      expect(fieldNames, `şemada "${banned}" alanı var`).not.toContain(banned)
    }
  })

  it('⚠️ kart alanı hiçbir yere yazılmıyor', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const body = read(file)
      // Atama/okuma biçimi: `.cardNumber`, `cvv:` gibi
      if (/\.(cardNumber|cvv|cvc|cardHolder)\b/i.test(body)) offenders.push(rel(file))
      if (/^\s*(cardNumber|cvv|cvc)\s*:/im.test(body)) offenders.push(rel(file))
    }
    expect(offenders).toEqual([])
  })
})

// ===========================================================================
describe('SQL güvenliği', () => {
  it('⚠️ ham SQL yalnızca parametreli tagged template ile yazılmış', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const body = read(file)
      // `$queryRawUnsafe` / `$executeRawUnsafe` uygulama kodunda kullanılmamalı
      if (/\$(query|execute)RawUnsafe\s*\(/.test(body)) offenders.push(`${rel(file)} → Unsafe`)
      // Tagged template İÇİNDE string birleştirme (SQL injection)
      if (/\$(query|execute)Raw`[^`]*\$\{[^}]*\}[^`]*\+/.test(body)) {
        offenders.push(`${rel(file)} → string birleştirme`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// ===========================================================================
describe('üretim kalıntıları', () => {
  it('⚠️ uygulama kodunda console.log ile PII/secret basılmıyor', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      for (const [i, line] of read(file).split('\n').entries()) {
        if (!/console\.(log|info|debug|warn|error)/.test(line)) continue
        // Şüpheli değişken adları doğrudan log'a veriliyor mu?
        if (/console\.\w+\([^)]*\b(password|passwordHash|secret|token|cvv|cardNumber|apiKey)\b/i.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('⚠️ TODO/FIXME içeren ödeme veya güvenlik kodu yok', () => {
    const critical = sourceFiles.filter(
      (p) => p.includes(`${path.sep}payments${path.sep}`) || p.includes(`${path.sep}auth${path.sep}`),
    )
    const offenders: string[] = []
    for (const file of critical) {
      if (/\b(FIXME|HACK|XXX)\b/.test(read(file))) offenders.push(rel(file))
    }
    expect(offenders).toEqual([])
  })

  it('⚠️ `debugger` ifadesi yok', () => {
    const offenders = sourceFiles.filter((p) => /^\s*debugger\b/m.test(read(p))).map(rel)
    expect(offenders).toEqual([])
  })
})

// ===========================================================================
describe('rate limit envanteri', () => {
  const rlFile = path.join(SRC, 'server/ratelimit.ts')
  const keys = [...read(rlFile).matchAll(/^\s{2}'([a-z0-9.]+)':\s*\{ limit:/gm)].map((m) => m[1]!)

  it('tablo boş değil', () => {
    expect(keys.length).toBeGreaterThan(15)
  })

  it('⚠️ tanımlı HER kural en az bir uçtan çağrılıyor (ölü kural = sahte koruma)', () => {
    const callSites = sourceFiles
      .filter((p) => p !== rlFile)
      .map(read)
      .join('\n')
    const unused = keys.filter((k) => !callSites.includes(`'${k}'`))
    expect(unused, `çağrılmayan rate limit kuralı: ${unused.join(', ')}`).toEqual([])
  })

  it('⚠️ para hareketi olan uçlar dar bir tavana sahip', () => {
    const body = read(rlFile)
    for (const key of ['orders.create.ip', 'payments.create.ip', 'admin.refund.user']) {
      const m = new RegExp(`'${key.replace(/\./g, '\\.')}': \\{ limit: (\\d+)`).exec(body)
      expect(m, `${key} tanımlı değil`).not.toBeNull()
      expect(Number(m![1]), `${key} çok cömert`).toBeLessThanOrEqual(20)
    }
  })

  it('⚠️ webhook ucu rate limit UYGULAMAZ (sağlayıcı yeniden denemesi kaybolmasın)', () => {
    const webhook = read(path.join(SRC, 'app/api/v1/payments/webhooks/[provider]/route.ts'))
    expect(webhook).not.toContain('rateLimit(')
    // Koruma imza doğrulamasıdır: uç, doğrulamayı ATLAYAMAZ — tek giriş
    // noktası `processWebhook` olmalı ve o da imzayı zorunlu tutar.
    expect(webhook).toContain('processWebhook')
    const engine = read(path.join(SRC, 'server/payments/webhook.ts'))
    expect(engine).toContain('if (!hook.signatureValid)')
    expect(engine).toContain('invalid_signature')
  })
})

// ===========================================================================
describe('güvenlik header yapılandırması', () => {
  const config = read(path.join(ROOT, 'next.config.ts'))

  it('CSP tanımlı ve tehlikeli direktif içermiyor', () => {
    expect(config).toContain('Content-Security-Policy')
    expect(config).toContain("frame-ancestors 'none'")
    expect(config).toContain("object-src 'none'")
    expect(config).toContain("base-uri 'self'")
    // `unsafe-eval` ASLA açılmaz
    expect(config).not.toContain('unsafe-eval')
  })

  it('temel güvenlik başlıkları tanımlı', () => {
    for (const h of [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ]) {
      expect(config, `${h} eksik`).toContain(h)
    }
  })

  it('poweredByHeader kapalı', () => {
    expect(config).toContain('poweredByHeader: false')
  })
})

// ===========================================================================
describe('çerez politikası', () => {
  const cookies = read(path.join(SRC, 'server/auth/cookies.ts'))

  it('oturum çerezi httpOnly + sameSite + secure kurallı', () => {
    expect(cookies).toContain('httpOnly')
    expect(cookies).toContain('sameSite')
    expect(cookies).toContain('secure')
    // `__Secure-` öneki HTTPS'te kullanılır
    expect(cookies).toContain('__Secure-')
  })
})

// ===========================================================================
describe('robots ve sitemap', () => {
  it('panel ve hesap yolları taranmaya kapalı', () => {
    const robots = read(path.join(SRC, 'app/robots.ts'))
    for (const p of ['/api/', '/yonetim/', '/hesabim', '/siparisler/', '/odeme/']) {
      expect(robots, `${p} disallow listesinde yok`).toContain(p)
    }
  })

  it('sitemap katalogdan üretilir, elle liste tutulmaz', () => {
    const sitemap = read(path.join(SRC, 'app/sitemap.ts'))
    expect(sitemap).toContain('getCatalog')
    expect(sitemap).toContain('appBaseUrl')
  })
})
