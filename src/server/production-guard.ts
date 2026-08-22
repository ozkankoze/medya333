import 'server-only'

import { env } from '@/env'
import { trustedProxyWarning } from '@/server/client-ip'

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
  if (
    base.includes('localhost') ||
    base.includes('127.0.0.1') ||
    base.includes('0.0.0.0') ||
    base.includes('example.com') ||
    base.includes('.local')
  ) {
    findings.push({
      level: 'blocker',
      code: 'BASE_URL_LOCALHOST',
      message:
        'Taban adres geliştirme/örnek bir adres gösteriyor (localhost, 127.0.0.1, ' +
        '0.0.0.0, example.com, .local). Canlı adres kullanılmalıdır.',
    })
  }

  /**
   * ⚠️ TABAN ADRES İLE DERLEMEYE GÖMÜLEN ADRES AYNI OLMALI (Faz 9).
   *
   * `NEXT_PUBLIC_SITE_URL` derleme sırasında istemci paketine gömülür;
   * `APP_BASE_URL` çalışma zamanında okunur. İkisi ayrışırsa sayfa
   * kaynağındaki adresler bir alan adını, e-posta ve ödeme callback'leri
   * başka bir alan adını gösterir. Hiçbir hata alınmaz — yalnızca sessizce
   * yanlış olur.
   */
  if (env.APP_BASE_URL && env.APP_BASE_URL !== env.NEXT_PUBLIC_SITE_URL) {
    findings.push({
      level: 'warning',
      code: 'BASE_URL_MISMATCH',
      message:
        `APP_BASE_URL ("${env.APP_BASE_URL}") ile NEXT_PUBLIC_SITE_URL ` +
        `("${env.NEXT_PUBLIC_SITE_URL}") farklı. Derlemeye gömülen adres ile ` +
        'çalışma zamanı adresi aynı olmalıdır.',
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
  /**
   * ⭐ INSTAGRAM BUSINESS DISCOVERY — YARIM YAPILANDIRMA SESSİZ KALMASIN
   *
   * İki yönlü kontrol, çünkü iki yönlü de yanılgı üretir:
   *
   *   (a) Bayrak AÇIK ama credential eksik → operatör "Instagram önizlemesi
   *       çalışıyor" sanır, oysa her hedef UNVERIFIED'a düşer. Sahte başarı
   *       değil ama SAHTE BEKLENTİ üretir.
   *   (b) Credential VAR ama bayrak kapalı → üretim ortamında hiçbir işe
   *       yaramayan bir SIR duruyor demektir. Kullanılmayan secret, sızma
   *       yüzeyidir; ya açılmalı ya silinmelidir.
   *
   * ⚠️ BLOCKER DEĞİL, UYARI: Instagram önizlemesi bir zenginleştirmedir;
   *    yokluğunda sipariş akışı eksiksiz çalışır. Siteyi bu yüzden
   *    kapatmak orantısız olurdu.
   */
  const igCredentials = Boolean(env.IG_ACCESS_TOKEN && env.IG_USER_ID)
  if (env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED && !igCredentials) {
    const missing = [
      !env.IG_ACCESS_TOKEN && 'IG_ACCESS_TOKEN',
      !env.IG_USER_ID && 'IG_USER_ID',
    ].filter(Boolean)
    findings.push({
      level: 'warning',
      code: 'INSTAGRAM_API_INCOMPLETE',
      message:
        `INSTAGRAM_BUSINESS_DISCOVERY_ENABLED=true ama eksik değişken(ler): ${missing.join(', ')}. ` +
        'Instagram profil önizlemesi ÇALIŞMAZ; her hedef doğrulanmadan kullanıcı onayına düşer.',
    })
  }
  if (!env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED && (env.IG_ACCESS_TOKEN || env.IG_APP_SECRET)) {
    findings.push({
      level: 'warning',
      code: 'INSTAGRAM_CREDENTIALS_IDLE',
      message:
        'Instagram sırrı tanımlı ama INSTAGRAM_BUSINESS_DISCOVERY_ENABLED kapalı — ' +
        'hiçbir işe yaramayan bir sır ortamda duruyor. Ya bayrağı açın ya değişkenleri kaldırın.',
    })
  }

  if (!env.SENTRY_DSN) {
    findings.push({
      level: 'warning',
      code: 'ERROR_TRACKING_NOT_CONFIGURED',
      message:
        'SENTRY_DSN yok. Hatalar yalnızca sunucu log\'unda görünür; ' +
        'canlıda bir istisna olduğunda kimse haberdar olmaz.',
    })
  } else {
    /**
     * ⚠️ DSN VAR AMA SDK YOK.
     * Bu durumu sessiz geçmek en kötüsüdür: ortamda DSN gören kişi
     * "hata izleme kurulu" sanır, oysa hiçbir olay gönderilmiyordur.
     */
    findings.push({
      level: 'warning',
      code: 'ERROR_TRACKING_SDK_MISSING',
      message:
        'SENTRY_DSN tanımlı ama Sentry SDK projeye kurulu değil — HİÇBİR OLAY ' +
        'GÖNDERİLMİYOR. Kurulum adımları: docs/PRODUCTION_CHECKLIST.md § 10.',
    })
  }

  /**
   * ⭐ GÜVENİLİR PROXY MODELİ (Faz 11)
   *
   * Rate limit kimliğini istemci IP'sinden alır. Yanlış yapılandırılmış bir
   * güven modeli ya rate limit'i atlatılabilir yapar (`cloudflare` modu
   * gerçekten Cloudflare arkasında değilken) ya da tüm kullanıcıları tek
   * kovaya sıkıştırır (`none`). İkisi de sessiz kalmamalıdır.
   */
  const proxyWarning = trustedProxyWarning()
  if (proxyWarning) {
    findings.push({
      level: 'warning',
      code: 'TRUSTED_PROXY_RISK',
      message: proxyWarning,
    })
  }

  /**
   * ⭐ SERVERLESS'TE BAĞLANTI HAVUZU (Faz 11)
   *
   * Vercel'de her eşzamanlı fonksiyon örneği KENDİ havuzunu açar. Yüksek bir
   * `DATABASE_POOL_MAX`, tam yük altında "too many connections" ile gelen tam
   * kesinti demektir. Bunu ancak dağıtım biçimini bilen kişi karara bağlar;
   * biz yalnızca riskli bileşimi GÖRÜNÜR yaparız.
   */
  const onServerless = Boolean(process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME)
  if (onServerless && env.DATABASE_POOL_MAX > 1) {
    findings.push({
      level: 'warning',
      code: 'POOL_MAX_TOO_HIGH_FOR_SERVERLESS',
      message:
        `DATABASE_POOL_MAX=${env.DATABASE_POOL_MAX} — serverless ortamda her ` +
        'fonksiyon örneği kendi havuzunu açar. Eşzamanlı örnek sayısı × bu ' +
        'değer, veritabanının bağlantı sınırını aşabilir. Serverless\'te 1 ' +
        'kullanın ve HAVUZLU bağlantı adresi (PgBouncer / pooler) verin.',
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
