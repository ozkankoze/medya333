import 'server-only'

import { env } from '@/env'

/**
 * ⭐ ÜRETİM AÇILIŞ KAPISI (Faz 7)
 *
 * Uygulama üretimde AÇILMADAN önce, "geliştirme kolaylığı" ayarlarının canlıya
 * sızmadığını doğrular. Bunlar çalışma zamanında fark edilirse geç kalınmış
 * olur: mock ödeme ile canlıya çıkmak, ödeme almadan sipariş onaylamak demektir.
 *
 * ⚠️ HİÇBİR SECRET LOGLANMAZ. Rapor yalnızca "hangi değişken eksik/yanlış"
 * bilgisini verir; değerin kendisi asla yazılmaz.
 *
 * ⚠️ KAPI NE ZAMAN SERTTİR?
 * `NODE_ENV=production` TEK BAŞINA yeterli DEĞİLDİR: `next start` NODE_ENV'i her
 * zaman "production" yapar, dolayısıyla E2E ve staging de üretim derlemesi
 * çalıştırır. Karar `NODE_ENV=production` VE `APP_ENV=production` bileşimidir.
 *
 * `APP_ENV` tanımsızsa "production" varsayılır (fail-closed): canlıda değişkeni
 * yazmayı unutmak kapıyı GEVŞETMEZ. Gevşetmenin bedeli de vardır — canlı
 * olmayan bir aşamada gerçek tahsilat açılamaz (STAGE_REAL_PAYMENT).
 */

export interface GuardFinding {
  /** `blocker` üretimde boot'u durdurur, `warning` yalnızca raporlanır. */
  level: 'blocker' | 'warning'
  code: string
  message: string
}

export class ProductionConfigError extends Error {
  constructor(readonly findings: GuardFinding[]) {
    super(
      'ÜRETİM YAPILANDIRMA HATASI — uygulama açılmadı:\n' +
        findings.map((f) => `  • [${f.code}] ${f.message}`).join('\n'),
    )
    this.name = 'ProductionConfigError'
  }
}

/** Geliştirme örneklerinde geçen, canlıda ASLA olmaması gereken sır kalıpları. */
const PLACEHOLDER_PATTERNS = [
  'change-me',
  'changeme',
  'placeholder',
  'example',
  'test-secret',
  'dev-secret',
  'localhost',
  'xxxxx',
]

function looksPlaceholder(value: string | undefined): boolean {
  if (!value) return false
  const v = value.toLowerCase()
  return PLACEHOLDER_PATTERNS.some((p) => v.includes(p))
}

/**
 * Bu süreç GERÇEKTEN canlı mı?
 *
 * Üretim DERLEMESİ (`NODE_ENV=production`) tek başına yetmez; aşama da
 * `production` olmalıdır. `APP_ENV` tanımsızsa `production` varsayılır.
 */
export function isLiveDeployment(): boolean {
  return env.NODE_ENV === 'production' && env.APP_ENV === 'production'
}

/**
 * Tüm üretim kontrollerini çalıştırır ve bulguları döner.
 * Boot'u durdurmaz — karar `assertProductionReady`'e aittir.
 */
export function auditProductionConfig(): GuardFinding[] {
  const findings: GuardFinding[] = []
  const isProd = isLiveDeployment()

  // --- 0) Aşama tutarlılığı ------------------------------------------------
  /**
   * ⚠️ Kapıyı `APP_ENV=staging|e2e` ile gevşetip yine de GERÇEK PARA tahsil
   * etmek mümkün olmamalıdır. Bu kontrol aşamadan BAĞIMSIZ olarak blocker'dır;
   * aksi halde `APP_ENV` bir kaçış kapısına dönüşürdü.
   */
  if (env.APP_ENV !== 'production' && env.PAYMENT_ENVIRONMENT === 'production') {
    findings.push({
      level: 'blocker',
      code: 'STAGE_REAL_PAYMENT',
      message:
        `APP_ENV="${env.APP_ENV}" ama PAYMENT_ENVIRONMENT="production". Canlı olmayan bir ` +
        'aşamada gerçek tahsilat açılamaz. Ya APP_ENV=production yapın ya da sandbox\'a dönün.',
    })
  }

  // --- 1) Redis: çok örnekli üretimde bellek-içi rate limit koruma DEĞİLDİR --
  if (!env.REDIS_URL) {
    findings.push({
      level: 'blocker',
      code: 'REDIS_REQUIRED',
      message:
        'REDIS_URL tanımlı değil. Rate limit ve katalog cache üretimde Redis ister; ' +
        'bellek-içi yedek tek süreçliktir ve birden çok örnekte koruma sağlamaz.',
    })
  }

  // --- 2) Ödeme: mock ASLA canlıya çıkmaz -----------------------------------
  if (env.PAYMENT_PROVIDER === 'mock') {
    findings.push({
      level: 'blocker',
      code: 'MOCK_PAYMENT',
      message:
        'PAYMENT_PROVIDER=mock. Sahte ödeme sağlayıcısı üretimde çalışamaz; ' +
        'iyzico veya paytr seçilmelidir.',
    })
  }
  if (env.PAYMENT_ENVIRONMENT !== 'production') {
    findings.push({
      level: 'blocker',
      code: 'PAYMENT_SANDBOX',
      message:
        `PAYMENT_ENVIRONMENT="${env.PAYMENT_ENVIRONMENT}". Canlı ortamda "production" olmalıdır; ` +
        'aksi halde gerçek tahsilat yapılmaz.',
    })
  }

  // --- 3) Sağlayıcı kimlik bilgileri (DEĞERLER LOGLANMAZ) -------------------
  if (env.PAYMENT_PROVIDER === 'iyzico') {
    const missing = [
      !env.IYZICO_API_KEY && 'IYZICO_API_KEY',
      !env.IYZICO_SECRET_KEY && 'IYZICO_SECRET_KEY',
    ].filter(Boolean)
    if (missing.length > 0) {
      findings.push({
        level: 'blocker',
        code: 'PROVIDER_CREDENTIALS_MISSING',
        message: `iyzico seçili ama eksik değişken(ler): ${missing.join(', ')}.`,
      })
    }
    if (env.IYZICO_BASE_URL.includes('sandbox')) {
      findings.push({
        level: 'blocker',
        code: 'PROVIDER_SANDBOX_URL',
        message: 'IYZICO_BASE_URL hâlâ sandbox adresini gösteriyor.',
      })
    }
  }
  if (env.PAYMENT_PROVIDER === 'paytr') {
    const missing = [
      !env.PAYTR_MERCHANT_ID && 'PAYTR_MERCHANT_ID',
      !env.PAYTR_MERCHANT_KEY && 'PAYTR_MERCHANT_KEY',
      !env.PAYTR_MERCHANT_SALT && 'PAYTR_MERCHANT_SALT',
    ].filter(Boolean)
    if (missing.length > 0) {
      findings.push({
        level: 'blocker',
        code: 'PROVIDER_CREDENTIALS_MISSING',
        message: `PayTR seçili ama eksik değişken(ler): ${missing.join(', ')}.`,
      })
    }
  }

  // --- 4) Taban adres: callback/webhook adresleri buradan üretilir ----------
  const base = env.APP_BASE_URL ?? env.NEXT_PUBLIC_SITE_URL
  if (!env.APP_BASE_URL) {
    findings.push({
      level: 'warning',
      code: 'APP_BASE_URL_MISSING',
      message:
        'APP_BASE_URL tanımlı değil; NEXT_PUBLIC_SITE_URL kullanılacak. ' +
        'NEXT_PUBLIC_ değişkenleri DERLEMEYE gömülür — aynı imaj staging ve canlıda ' +
        'aynı callback adresini üretir.',
    })
  }
  if (!base.startsWith('https://')) {
    findings.push({
      level: 'blocker',
      code: 'BASE_URL_NOT_HTTPS',
      message: 'Taban adres HTTPS değil. Ödeme callback ve güvenli çerezler HTTPS ister.',
    })
  }
  if (base.includes('localhost') || base.includes('127.0.0.1')) {
    findings.push({
      level: 'blocker',
      code: 'BASE_URL_LOCALHOST',
      message: 'Taban adres localhost gösteriyor.',
    })
  }

  // --- 5) Sırlar: örnek/placeholder değerler canlıya çıkamaz ----------------
  for (const [name, value] of [
    ['AUTH_SECRET', env.AUTH_SECRET],
    ['ORDER_TOKEN_SECRET', env.ORDER_TOKEN_SECRET],
    ['IP_HASH_SALT', env.IP_HASH_SALT],
  ] as const) {
    if (looksPlaceholder(value)) {
      findings.push({
        level: 'blocker',
        code: 'PLACEHOLDER_SECRET',
        // ⚠️ Değerin kendisi YAZILMAZ.
        message: `${name} örnek/placeholder bir değere benziyor. Yeni bir sır üretin.`,
      })
    }
  }
  if (env.AUTH_SECRET === env.ORDER_TOKEN_SECRET) {
    findings.push({
      level: 'blocker',
      code: 'SECRET_REUSE',
      message: 'AUTH_SECRET ve ORDER_TOKEN_SECRET aynı. Her sır ayrı üretilmelidir.',
    })
  }

  // --- 6) Bilgilendirme: entegrasyonu OLMAYAN bileşenler --------------------
  /**
   * ⚠️ `console` sağlayıcısı CANLIDA BLOCKER'DIR — uyarı değil.
   * İki sebeple: (1) gönderim yapılmadığı hâlde `ok:true` döner, yani sistem
   * "gönderildi" sanır; (2) e-posta konuları sunucu log'una yazılır.
   * Yapılandırma eksikse doğru cevap `none`'dır: açıkça başarısız olur.
   */
  if (env.EMAIL_PROVIDER === 'console') {
    findings.push({
      level: 'blocker',
      code: 'EMAIL_CONSOLE_IN_PRODUCTION',
      message:
        'EMAIL_PROVIDER=console canlı ortamda kullanılamaz: e-posta teslim edilmediği ' +
        'hâlde başarılı sayılır. Sağlayıcı yoksa "none" kullanın.',
    })
  }
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    findings.push({
      level: 'blocker',
      code: 'EMAIL_PROVIDER_KEY_MISSING',
      message: 'EMAIL_PROVIDER=resend seçili ama RESEND_API_KEY tanımlı değil.',
    })
  }
  if (!env.RESEND_API_KEY) {
    findings.push({
      level: 'warning',
      code: 'EMAIL_NOT_CONFIGURED',
      message:
        'Gerçek e-posta sağlayıcısı bağlı değil (RESEND_API_KEY yok). Sipariş/ödeme ' +
        'bildirimleri GÖNDERİLEMEZ; her deneme FAILED olarak kaydedilir. ' +
        'Müşteriye E-POSTA GİTMEZ.',
    })
  }
  if (!env.SENTRY_DSN) {
    findings.push({
      level: 'warning',
      code: 'ERROR_TRACKING_NOT_CONFIGURED',
      message: 'SENTRY_DSN yok. Hatalar yalnızca sunucu log\'unda görünür.',
    })
  }

  /**
   * Canlı değilsek bulgular UYARIYA düşer — geliştirme ve E2E akışı durmaz.
   * ⚠️ TEK İSTİSNA: aşama/para tutarsızlığı her aşamada blocker kalır.
   */
  const ALWAYS_BLOCKING = new Set(['STAGE_REAL_PAYMENT'])
  if (isProd) return findings
  return findings.map((f) =>
    ALWAYS_BLOCKING.has(f.code) ? f : { ...f, level: 'warning' as const },
  )
}

/**
 * Üretimde blocker varsa uygulamayı AÇMAZ.
 * `instrumentation.ts` üzerinden süreç başlarken bir kez çağrılır.
 */
export function assertProductionReady(): GuardFinding[] {
  const findings = auditProductionConfig()
  const blockers = findings.filter((f) => f.level === 'blocker')
  if (blockers.length > 0) throw new ProductionConfigError(blockers)
  return findings
}
