import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCsp } from '@/lib/security/csp'
import { isDeploymentAliasUrl } from '@/server/production-guard'

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

/**
 * ⚠️ Yorumları çıkarır.
 * Bu dosyadaki denetimler KODU tarar. Yorum satırları çoğu zaman tam olarak
 * yasakladığımız kalıbı AÇIKLAR ("skip: (page-1)*size kullanılmaz") ve
 * çıkarılmazsa test kendi belgelendirmemizi ihlal sayar.
 */
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
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
    // Instagram Graph API — token istemciye ULAŞMAMALIDIR.
    'IG_ACCESS_TOKEN',
    'IG_APP_SECRET',
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

  /**
   * ⚠️ BU TEST GEVŞETİLMEDİ — GÜÇLENDİRİLDİ.
   *
   * Eskiden `next.config.ts` METNİ taranıyordu: `expect(config)
   * .not.toContain('unsafe-eval')`. Bu, politika tek bir sabit dize olduğu
   * sürece yeterliydi. Politika artık ortama göre üretildiği için metin
   * taraması YANLIŞ SORUYU sorar: bir dizenin dosyada geçmesi, üretimde
   * gönderilen başlıkta olduğu anlamına gelmez — geçmemesi de olmadığı
   * anlamına gelmez.
   *
   * Artık ÜRETİLEN POLİTİKA doğrulanıyor. Kapsam daralmadı, genişledi:
   * geliştirme dalının üretim politikasını kirletmediği de sabitlendi.
   * Ayrıntılı senaryolar: `tests/unit/csp.test.ts`
   */
  it('CSP tanımlı ve ÜRETİMDE tehlikeli direktif içermiyor', () => {
    expect(config).toContain('Content-Security-Policy')
    expect(config).toContain('buildCsp')

    const production = buildCsp({ dev: false, googleAds: false })
    expect(production).toContain("frame-ancestors 'none'")
    expect(production).toContain("object-src 'none'")
    expect(production).toContain("base-uri 'self'")
    // `unsafe-eval` ÜRETİMDE ASLA açılmaz
    expect(production).not.toContain('unsafe-eval')
    // Geliştirme izinleri üretime sızmaz
    expect(production).not.toContain('ws:')
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
  it('panel, hesap ve kimlik yolları taranmaya kapalı', () => {
    /**
     * ⚠️ Faz 11: kurallar rota dosyasından SAF fonksiyona taşındı
     * (`lib/seo/robots-rules.ts`) ki hem canlı hem canlı-olmayan dal test
     * edilebilsin. Tarama da o dosyaya bakar.
     */
    const rules = read(path.join(SRC, 'lib/seo/robots-rules.ts'))
    for (const p of [
      '/api/', '/admin/', '/panel/', '/hesabim', '/siparisler/', '/odeme/',
      '/giris', '/kayit', '/siparis-olusturuldu',
    ]) {
      expect(rules, `${p} disallow listesinde yok`).toContain(p)
    }

    // Rota dosyası yalnızca ince bir kabuktur ve saf fonksiyonu çağırır.
    const route = read(path.join(SRC, 'app/robots.ts'))
    expect(route).toContain('buildRobots')
    expect(route).toContain('isLiveDeployment')
  })

  it('⚠️ sitemap ÖZEL ve TOKEN taşıyan adresleri İÇERMEZ', () => {
    const sitemap = stripComments(read(path.join(SRC, 'app/sitemap.ts')))
    expect(sitemap, 'taban adres sabitlenmiş').toContain('appBaseUrl')
    for (const banned of [
      '/siparisler/', // takip token'ı taşır
      '/admin', '/panel', '/hesabim',
      '/odeme/', '/siparis-olusturuldu',
      '/giris', '/kayit',
      '?p=', '?t=', // sihirbaz derin bağlantıları ve token parametresi
    ]) {
      expect(sitemap, `site haritasında "${banned}"`).not.toContain(banned)
    }
    // İndekslenmesini istediğimiz sayfalar duruyor
    for (const wanted of ['/yardim', '/siparis-takip', '/kvkk-gizlilik']) {
      expect(sitemap, `site haritasında "${wanted}" yok`).toContain(wanted)
    }
  })
})

// ===========================================================================
describe('Faz 8 — operasyon denetimi', () => {
  it('⚠️ SAĞLIK UCU sır, sürüm veya bağlantı adresi DÖNDÜRMEZ', () => {
    const blob = stripComments(
      read(path.join(SRC, 'app/api/health/route.ts')) + read(path.join(SRC, 'server/health.ts')),
    )
    for (const banned of [
      'DATABASE_URL',
      'REDIS_URL',
      'AUTH_SECRET',
      'process.env',
      'version',
      'err.message',
      '(err as Error).message',
    ]) {
      expect(blob, `sağlık ucunda "${banned}"`).not.toContain(banned)
    }
  })

  it('⚠️ ÖDEME SAĞLAYICISI sağlık kontrolünde çağrılmaz', () => {
    const impl = stripComments(read(path.join(SRC, 'server/health.ts')))
    for (const banned of ['payments', 'iyzico', 'paytr', 'PAYMENT_']) {
      expect(impl, `sağlık kontrolünde "${banned}"`).not.toContain(banned)
    }
  })

  it('⚠️ KUYRUK SAYFALAMASI OFFSET KULLANMAZ', () => {
    const queue = stripComments(read(path.join(SRC, 'server/fulfillment/queue.ts')))
    // Prisma'da OFFSET `skip: n`'dir. Cursor ile birlikte kullanilan
    // skip degeri 1 olmalidir: yalnizca cursor kaydinin kendisini atlar.
    const skips = [...queue.matchAll(/skip:\s*([^,\n}]+)/g)].map((m) => m[1]!.trim())
    for (const s of skips) {
      expect(s, `OFFSET sayfalama: skip: ${s}`).toBe('1')
    }
    expect(queue, 'cursor sayfalaması yok').toContain('cursor:')
  })

  it('⚠️ SIRALAMA HER ZAMAN id ile biter (kararlı sayfalama)', () => {
    const queue = stripComments(read(path.join(SRC, 'server/fulfillment/queue.ts')))
    const block = queue.slice(queue.indexOf('const SORT_ORDERS'), queue.indexOf('export type QueueSort'))
    const orders = [...block.matchAll(/\[(.*?)\],?\n/gs)].map((m) => m[1]!)
    expect(orders.length).toBeGreaterThan(0)
    for (const o of orders) {
      expect(o, `tie-breaker yok: ${o}`).toMatch(/\{ id: '(asc|desc)' \}\s*$/)
    }
  })

  it('⚠️ AUDIT KAPSAMI: şart koşulan admin aksiyonları kayıt yazar', () => {
    const catalog = read(path.join(SRC, 'server/catalog/admin.ts'))
    const operate = read(path.join(SRC, 'server/fulfillment/operate.ts'))
    const replacement = read(path.join(SRC, 'server/fulfillment/replacement.ts'))
    const blob = catalog + operate + replacement

    for (const action of [
      // katalog oluştur / güncelle / aktiflik
      'platform.create', 'platform.update', 'platform.deactivate',
      'service.create', 'service.update', 'service.deactivate',
      'variant.create', 'variant.update', 'variant.deactivate',
      // fiyat
      'pricing_rule.create', 'pricing_rule.update',
      // fulfillment
      'fulfillment.assign', 'fulfillment.reassign', 'fulfillment.status_change',
      'fulfillment.progress', 'fulfillment.note',
      // telafi
      'fulfillment.replacement_create', 'fulfillment.replacement_advance',
    ]) {
      expect(blob, `audit eksik: ${action}`).toContain(`'${action}'`)
    }
  })

  it('⚠️ AUDIT PAYLOAD\'INA hassas alanlar giremez', () => {
    const audit = read(path.join(SRC, 'server/audit.ts'))
    for (const key of [
      'passwordHash',
      'twoFactorSecret',
      'accessTokenHash',
      'rawInitPayload',
      'rawResultPayload',
    ]) {
      expect(audit, `REDACTED listesinde yok: ${key}`).toContain(key)
    }
  })

  it('⚠️ MÜŞTERİ GÖRÜNÜMÜ ham olay türü döndürmez', () => {
    const lookup = stripComments(read(path.join(SRC, 'server/orders/lookup.ts')))
    const block = lookup.slice(lookup.indexOf('timeline: order.events.map'), lookup.indexOf('steps,'))
    expect(block, 'zaman çizelgesinde ham enum').not.toMatch(/type:\s*e\.type/)
  })
})

// ===========================================================================
describe('Faz 9 — canlıya çıkış denetimi', () => {
  it('⚠️ SUNUCU TARAFI ADRESLER APP_BASE_URL\'den üretilir', () => {
    /**
     * `NEXT_PUBLIC_SITE_URL` derlemeye gömülür. Callback, e-posta bağlantısı,
     * canonical ve OG adresleri ondan üretilirse aynı imaj farklı ortamlarda
     * YANLIŞ adres yayınlar — ve hiçbir hata alınmaz.
     */
    const offenders: string[] = []
    for (const file of sourceFiles) {
      if (file.endsWith('env.ts')) continue
      if (file.endsWith(`server${path.sep}base-url.ts`)) continue // tek meşru düşüş noktası
      if (file.endsWith(`server${path.sep}production-guard.ts`)) continue // karşılaştırma yapar
      const body = stripComments(read(file))
      if (/NEXT_PUBLIC_SITE_URL/.test(body)) offenders.push(rel(file))
    }
    expect(offenders, 'NEXT_PUBLIC_SITE_URL doğrudan kullanılmış').toEqual([])
  })

  it('⚠️ KAYNAK KODDA sabitlenmiş geliştirme adresi yok', () => {
    /**
     * İki dosya bilinçli olarak muaftır:
     *   • `env.ts` — geliştirme varsayılanı burada tanımlıdır ve canlıda
     *     `BASE_URL_LOCALHOST` / `BASE_URL_MISMATCH` ile yakalanır.
     *   • `production-guard.ts` — bu adresleri YASAKLAYAN kodun kendisi;
     *     yasakladığı dizeleri içermesi zorunludur.
     */
    const exempt = [`${path.sep}env.ts`, `server${path.sep}production-guard.ts`]
    const offenders: string[] = []
    for (const file of sourceFiles) {
      if (exempt.some((e) => file.endsWith(e))) continue
      const body = stripComments(read(file))
      for (const bad of ['http://localhost', 'http://127.0.0.1', '0.0.0.0', 'example.com', 'staging.']) {
        if (body.includes(bad)) offenders.push(`${rel(file)} → ${bad}`)
      }
    }
    expect(offenders, 'üretim çıktısına sızabilecek geliştirme adresi').toEqual([])
  })

  it('⚠️ ÇEREZ GÜVENLİĞİ derleme zamanı değişkenine bağlı DEĞİL', () => {
    const cookies = stripComments(read(path.join(SRC, 'server/auth/cookies.ts')))
    expect(cookies, 'çerez şeması derlemeye gömülü adresten okunuyor').not.toContain(
      'NEXT_PUBLIC_SITE_URL',
    )
    expect(cookies).toContain('appBaseUrl')
  })

  it('⚠️ metadataBase ÇALIŞMA ZAMANINDA çözülür (localhost fallback yok)', () => {
    const layout = stripComments(read(path.join(SRC, 'app/(site)/layout.tsx')))
    expect(layout).toContain('generateMetadata')
    expect(layout).toContain('appBaseUrl()')
    expect(layout, 'dil etiketi tr-TR olmalı').toContain('lang="tr-TR"')
  })

  /**
   * ⚠️ BU TEST TERSİNE ÇEVRİLDİ, SİLİNMEDİ.
   *
   * Eski hâli `images:` tanımlanmasını TAMAMEN yasaklıyordu, çünkü o gün
   * gerçek bir OG görseli yoktu ve var olmayan dosyaya işaret etmek
   * paylaşımlarda kırık önizleme üretiyordu. Görsel üretildiğinde bu yasak
   * anlamını yitirdi — ama korumaya devam ettiği DEĞİŞMEZ hâlâ geçerli:
   *
   *     bildirilen her OG/Twitter görseli DİSKTE GERÇEKTEN VAR OLMALI.
   *
   * Testi silmek o değişmezi kaybetmek olurdu; yasağı sürdürmek ise
   * gerçek bir görseli engellemek. Doğru cevap, iddiayı dosya varlığına
   * bağlamaktır.
   */
  it('⚠️ BİLDİRİLEN OG/TWITTER GÖRSELİ DİSKTE VAR', () => {
    const layout = read(path.join(SRC, 'app/(site)/layout.tsx'))
    const refs = [...layout.matchAll(/['"](\/[^'"]+\.(?:png|jpg|jpeg|webp))['"]/g)].map((m) => m[1])

    expect(refs.length, 'layout hiçbir paylaşım görseli bildirmiyor').toBeGreaterThan(0)

    for (const ref of refs) {
      // `/og.png` → `public/og.png`. Next `public/` altını kökten servis eder.
      const onDisk = path.join(SRC, '..', 'public', ref!.replace(/^\//, ''))
      expect(
        existsSync(onDisk),
        `layout "${ref}" bildiriyor ama dosya yok → paylaşımda kırık önizleme`,
      ).toBe(true)
    }
  })

  /**
   * ⚠️ `summary_large_image` GÖRSELSİZ ÇALIŞMAZ.
   * X, kart tipi büyük görsel derken görsel bulamazsa kartı sessizce düz
   * bağlantıya düşürür — hata yok, sadece önizleme yok.
   */
  it('⚠️ Twitter kart tipi ile görsel BİRLİKTE durur', () => {
    const layout = stripComments(read(path.join(SRC, 'app/(site)/layout.tsx')))
    const twitter = layout.slice(layout.indexOf('twitter:'), layout.indexOf('robots:'))
    if (twitter.includes('summary_large_image')) {
      expect(twitter, 'summary_large_image bildirildi ama görsel yok').toMatch(/images:/)
    }
  })

  /**
   * ⚠️ `keywords` GERİ GELMESİN.
   * Google meta keywords'ü 2009'dan beri sıralamada kullanmıyor. Tek gerçek
   * etkisi hedef kelimeleri rakiplere bedava bildirmektir.
   */
  it('⚠️ meta keywords ETİKETİ YOK', () => {
    const layout = stripComments(read(path.join(SRC, 'app/(site)/layout.tsx')))
    expect(layout, 'meta keywords geri eklenmiş').not.toMatch(/^\s*keywords:/m)
  })

  /**
   * ⚠️ META DESCRIPTION ARAMA SONUCUNDA KESİLMEMELİ.
   * 188 karakterdi ve son cümle kesiliyordu — kesilen yer tam da tıklamaya
   * ikna eden kısımdı.
   */
  it('⚠️ meta description 160 karakteri aşmıyor', () => {
    const layout = read(path.join(SRC, 'app/(site)/layout.tsx'))
    const m = layout.match(/\n {2}description:\s*([\s\S]*?)\n {2}applicationName:/)
    expect(m, 'layout description alanı bulunamadı').not.toBeNull()
    // Kaynak birden çok string parçasına bölünmüş olabilir; hepsini birleştir.
    const text = [...m![1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]).join('')
    expect(text.length, `description ${text.length} karakter: "${text}"`).toBeLessThanOrEqual(160)
    expect(text.length, 'description şüpheli derecede kısa').toBeGreaterThan(80)
  })

  it('⚠️ HATA İZLEME credential olmadan "aktif" GÖSTERİLMEZ', () => {
    const obs = stripComments(read(path.join(SRC, 'server/observability.ts')))
    // SDK kurulmadan `active` durumuna geçilemez
    expect(obs).toContain('SENTRY_SDK_INSTALLED = false')
    expect(obs).toMatch(/if \(!env\.SENTRY_DSN\) return 'not_configured'/)
  })

  it('⚠️ İZLEME BAĞLAMI beyaz liste ile temizlenir (PII geçemez)', () => {
    const obs = read(path.join(SRC, 'server/observability.ts'))
    expect(obs).toContain('ALLOWED_CONTEXT_KEYS')
    // Beyaz listede PII alanı OLMAMALI
    const block = obs.slice(obs.indexOf('ALLOWED_CONTEXT_KEYS'), obs.indexOf('])', obs.indexOf('ALLOWED_CONTEXT_KEYS')))
    for (const pii of ['email', 'phone', 'ip', 'name', 'token', 'password']) {
      expect(block.toLowerCase(), `bağlam beyaz listesinde "${pii}"`).not.toContain(pii)
    }
  })

  it('⚠️ FİYAT OTORİTESİ CACHE\'TE DEĞİL, VERİTABANINDA', () => {
    const resolve = stripComments(read(path.join(SRC, 'server/pricing/resolve.ts')))
    // Fiyat çözümleyici katalog cache'ini OKUMAZ
    expect(resolve, 'fiyat cache\'ten okunuyor').not.toContain('getCatalog')
    expect(resolve, 'fiyat Redis\'ten okunuyor').not.toContain('getRedis')
    // Doğrudan veritabanı sorgusu yapar
    expect(resolve).toContain('db.serviceVariant.findFirst')
  })

  it('⚠️ RATE LIMIT üretimde FAIL-CLOSED (Redis düşerse açılmaz)', () => {
    const rl = stripComments(read(path.join(SRC, 'server/ratelimit.ts')))
    // Redis erişilemezse üretimde `ok: false` döner
    expect(rl).toMatch(/env\.NODE_ENV === 'production'[\s\S]{0,200}ok: false/)
  })

  it('⚠️ ROL YÜKSELTME sunucuda engelli', () => {
    const users = read(path.join(SRC, 'server/users/admin.ts'))
    for (const rule of [
      'SELF_ROLE_CHANGE', // kimse kendi rolünü değiştiremez
      'ROLE_ABOVE_ACTOR', // kendi seviyesinde/üstünde rol atayamaz
      'TARGET_ABOVE_ACTOR', // kendi seviyesinde/üstünde kullanıcıya dokunamaz
      'LAST_SUPERADMIN', // kilitlenme koruması
    ]) {
      expect(users, `rol kuralı eksik: ${rule}`).toContain(rule)
    }
    // Rol değişikliği denetim kaydına yazılır
    expect(users).toContain("'user.role_change'")
  })

  it('⚠️ BİLDİRİM PANELİ ham adres/token/sağlayıcı gövdesi göstermez', () => {
    const admin = stripComments(read(path.join(SRC, 'server/notifications/admin.ts')))
    // Seçilen alanlar arasında ham e-posta YOK
    expect(admin).toContain('recipientMasked')
    expect(admin).not.toMatch(/select:\s*\{[^}]*\bemail:\s*true/)
    // Otomatik tekrar kuyruğu yok
    expect(admin).not.toContain('setInterval')
    expect(admin).not.toContain('setTimeout')
  })
})

// ===========================================================================
/**
 * ⭐⭐ TABAN ADRES BİR DAĞITIM ALIAS'I OLAMAZ (canlıda)
 *
 * ⚠️ Bu testler GERÇEK BİR OLAYDAN doğdu. Canlı projede `APP_BASE_URL`
 * `https://medya333.vercel.app` olarak kalmıştı — üstelik o adres, siteyi
 * sunan projenin kendi alias'ı bile değildi. Sonuç: `sitemap.xml`,
 * `canonical`, `og:url` ve ödeme callback adreslerinin TAMAMI yanlış alan
 * adını gösteriyordu.
 *
 * Mevcut kontroller neden yakalamadı? Çünkü `https://…vercel.app` geçerli
 * bir HTTPS adresidir ve localhost/example.com listesinde yoktur. Biçimsel
 * olarak doğru, anlamsal olarak yanlış — sessiz hataların klasik şekli.
 */
describe('taban adres — dağıtım alias tespiti', () => {
  it('⚠️ vercel.app alias\'ları YAKALANIR', () => {
    expect(isDeploymentAliasUrl('https://medya333.vercel.app')).toBe(true)
    expect(isDeploymentAliasUrl('https://medya333.vercel.app/')).toBe(true)
    // Preview alias'ları da alias'tır — canonical olarak kullanılamaz.
    expect(isDeploymentAliasUrl('https://medya333-git-main-abc.vercel.app')).toBe(true)
    expect(isDeploymentAliasUrl('https://medya333-ex86.vercel.app/')).toBe(true)
  })

  it('gerçek alan adları alias SAYILMAZ', () => {
    expect(isDeploymentAliasUrl('https://www.medya333.com')).toBe(false)
    expect(isDeploymentAliasUrl('https://medya333.com/')).toBe(false)
  })

  it('⚠️ TAKLİT ADRESLER alias sayılmaz — eşleşme host SONUNDA olmalı', () => {
    // Saldırgan kontrollü bir alan adı "vercel.app" dizesini içerebilir;
    // `includes()` ile yazılsaydı bu adres yanlışlıkla alias sayılırdı.
    expect(isDeploymentAliasUrl('https://vercel.app.medya333.com')).toBe(false)
    expect(isDeploymentAliasUrl('https://notvercel.app.example.org')).toBe(false)
    // Tersi de doğru olmalı: "…xvercel.app" bizim alias'ımız değildir.
    expect(isDeploymentAliasUrl('https://fakevercel.app')).toBe(false)
  })

  it('ayrıştırılamayan adres burada patlamaz', () => {
    // Bu durum BASE_URL_NOT_HTTPS tarafından raporlanır; burada sessizce
    // false dönmek, tek bir hatanın iki ayrı bulguya bölünmesini önler.
    expect(isDeploymentAliasUrl('bu bir adres degil')).toBe(false)
    expect(isDeploymentAliasUrl('')).toBe(false)
  })
})
