import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

/**
 * ENVIRONMENT DOĞRULAMA
 *
 * Eksik veya hatalı env değişkeni uygulamanın AÇILMASINI engeller —
 * canlıda çalışma zamanında patlamaz.
 *
 * KURAL: `NEXT_PUBLIC_` öneki SADECE gerçekten herkese açık değerler için.
 * Ödeme anahtarları, API anahtarları ve secret'lar `server` bloğunda kalır ve
 * istemci bundle'ına asla girmez.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /**
     * ⭐ DAĞITIM AŞAMASI — "üretim DERLEMESİ" ile "CANLI ortam" aynı şey değildir.
     *
     * `next start` NODE_ENV'i her zaman "production" yapar; E2E testleri ve
     * staging de üretim derlemesi çalıştırır. Bu yüzden "gerçekten canlıyız"
     * kararı NODE_ENV'e bırakılamaz.
     *
     * ⚠️ GÜVENLİ VARSAYILAN: tanımsızsa CANLI kabul edilir. Canlıda bu değişkeni
     * yazmayı unutmak kapıyı SIKI çalıştırır (fail-closed); staging/e2e'de
     * gevşetmek ise BİLİNÇLİ bir tercihtir. Üstelik gevşetme bedavaya gelmez:
     * `production` dışı bir aşamada gerçek tahsilat (PAYMENT_ENVIRONMENT=
     * production) açılamaz — bkz. server/production-guard.ts.
     */
    APP_ENV: z.enum(['production', 'staging', 'e2e']).default('production'),

    // --- Veritabanı ---
    DATABASE_URL: z.string().url(),
    DIRECT_DATABASE_URL: z.string().url().optional(),

    // --- Auth.js ---
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET en az 32 karakter olmalı'),
    AUTH_URL: z.string().url().optional(),
    AUTH_TRUST_HOST: z.coerce.boolean().default(true),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    // --- Kriptografik tuzlar ---
    /** IP adresleri ham saklanmaz; bu tuzla hash'lenir (KVKK) */
    IP_HASH_SALT: z.string().min(16),
    /** Misafir sipariş takip linki imzası */
    ORDER_TOKEN_SECRET: z.string().min(32),

    /**
     * Redis — rate limit ve katalog cache.
     * ÜRETİMDE ZORUNLU: yoksa uygulama boot'ta hata verir
     * (bkz. src/server/redis.ts → assertRedisInProduction).
     * Dev/test'te yoksa kontrollü bellek-içi yedeğe düşülür.
     */
    REDIS_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    /**
     * SUNUCU TARAFI TABAN ADRES.
     *
     * ⚠️ `NEXT_PUBLIC_SITE_URL` DERLEME ZAMANINDA gömülür (Next.js tüm
     * NEXT_PUBLIC_ değişkenlerini build sırasında metin olarak değiştirir).
     * Ödeme sağlayıcısına giden callback/success adresleri ise DAĞITIMA göre
     * değişir: aynı imaj staging'de ve canlıda farklı adresle çalışır.
     * Bu yüzden sunucu tarafı adresler bu ÇALIŞMA ZAMANI değişkeninden
     * okunur; tanımlı değilse NEXT_PUBLIC_SITE_URL'e düşülür.
     */
    APP_BASE_URL: z.string().url().optional(),

    /**
     * ⭐ GÜVENİLİR PROXY MODELİ (Faz 11) — İSTEMCİ IP'Sİ NEREDEN OKUNUR?
     *
     * Rate limit kimliğini istemci IP'sinden alır. Yanlış başlığa güvenmek
     * rate limit'i TAMAMEN atlatılabilir yapar (bkz. src/server/client-ip.ts).
     *
     *   xff-rightmost → `x-forwarded-for` zincirinin EN SAĞDAKİ değeri.
     *                   Tek güvenilir hop arkasında (nginx/Caddy/ALB/Vercel)
     *                   doğrudur. ⭐ VARSAYILAN — her iki dağıtım yolunda da
     *                   güvenlidir.
     *   vercel        → Vercel'in yazdığı `x-vercel-forwarded-for` tercih
     *                   edilir; Vercel'in üstünde bir proxy olsa bile korunur.
     *   cloudflare    → `cf-connecting-ip`. YALNIZCA origin'e Cloudflare
     *                   dışından erişilemiyorsa güvenlidir.
     *   none          → hiçbir başlığa güvenilmez; tüm istekler tek kova.
     *                   Aşırı kısıtlayıcıdır ama sınırsıza düşmez.
     *
     * ⚠️ Ortamdan otomatik tahmin EDİLMEZ: güvenlik davranışı dağıtım
     * ortamına göre kendiliğinden değişmemelidir.
     */
    TRUSTED_PROXY: z.enum(['vercel', 'xff-rightmost', 'cloudflare', 'none']).default('xff-rightmost'),

    /**
     * ⭐ SUNUCU BAŞINA VERİTABANI BAĞLANTI HAVUZU ÜST SINIRI (Faz 11)
     *
     * ⚠️ SERVERLESS'TE HAYATİ. Vercel'de her eşzamanlı fonksiyon örneği KENDİ
     * havuzunu açar. `pg` varsayılanı örnek başına 10'dur; 50 eşzamanlı örnek
     * 500 bağlantı demektir ve yönetilen PostgreSQL bunu çok önce reddeder —
     * sonuç, tam yük altında "too many connections" ile gelen tam kesintidir.
     *
     * Serverless'te doğru değer 1'dir: her istek zaten tek bir örnekte
     * sıralı çalışır. Tek süreçli (Docker/VM) dağıtımda daha yüksek olmalıdır.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    // --- Vergi ---
    /** Varsayılan KDV oranı, basis point. %20 → 2000. DB'deki TaxRate önceliklidir. */
    DEFAULT_TAX_RATE_BP: z.coerce.number().int().min(0).max(10_000).default(2000),

    // --- ÖDEME (Faz 3) ---
    /**
     * Yeni ödemeler için aktif sağlayıcı. Yalnızca SEÇİMİ belirler;
     * iş mantığı sağlayıcıya göre dallanmaz (bkz. server/payments/registry.ts).
     * "mock" yalnızca üretim DIŞINDA kullanılabilir.
     */
    PAYMENT_PROVIDER: z.enum(['iyzico', 'paytr', 'mock']).default('iyzico'),
    /** Sandbox/production ayrımı — Payment kaydına da yazılır. */
    PAYMENT_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    /**
     * ⚠️ Bu anahtarların hiçbiri NEXT_PUBLIC_ değildir; istemci bundle'ına
     * girmez. Yoksa ilgili sağlayıcı `isConfigured=false` olur ve ödeme
     * başlatma net bir hatayla reddedilir — sahte secret ÜRETİLMEZ.
     */
    IYZICO_API_KEY: z.string().optional(),
    IYZICO_SECRET_KEY: z.string().optional(),
    IYZICO_BASE_URL: z.string().url().default('https://sandbox-api.iyzipay.com'),
    PAYTR_MERCHANT_ID: z.string().optional(),
    PAYTR_MERCHANT_KEY: z.string().optional(),
    PAYTR_MERCHANT_SALT: z.string().optional(),

    // --- PLATFORM API'LERİ (Faz 6 — Faz 0'da entegrasyon YOK) ---
    YOUTUBE_API_KEY: z.string().optional(),
    INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: z.coerce.boolean().default(false),
    IG_APP_ID: z.string().optional(),
    IG_APP_SECRET: z.string().optional(),
    IG_ACCESS_TOKEN: z.string().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    X_BEARER_TOKEN: z.string().optional(),

    // --- FATURA (Faz 8 — alanlar hazır, sağlayıcı YOK) ---
    INVOICE_PROVIDER: z.enum(['none', 'parasut', 'nilvera', 'logo']).default('none'),
    INVOICE_API_KEY: z.string().optional(),
    INVOICE_API_SECRET: z.string().optional(),

    // --- E-posta ---
    MAIL_FROM: z.string().email().default('siparis@medya333.com'),
    RESEND_API_KEY: z.string().optional(),
    /**
     * ⭐ E-POSTA SAĞLAYICISI (Faz 8)
     *
     *   none    → gönderim YAPILMAZ ve başarılı SAYILMAZ. Canlı varsayılanı.
     *   console → yalnızca geliştirme. Üretimde seçilirse boot FAIL.
     *   resend  → gerçek gönderim; RESEND_API_KEY olmadan seçilemez.
     *
     * Tanımsızsa: anahtar varsa `resend`, test'te bellek, canlıda `none`,
     * geliştirmede `console` (bkz. server/mail/provider.ts).
     */
    EMAIL_PROVIDER: z.enum(['none', 'console', 'resend']).optional(),

    // --- Gözlemlenebilirlik (Faz 9) ---
    /**
     * ⚠️ SDK KURULU DEĞİL. DSN verilse bile gönderim YAPILMAZ; durum
     * `pending_sdk` olur ve hiçbir yerde "aktif" gösterilmez
     * (bkz. server/observability.ts).
     */
    SENTRY_DSN: z.string().url().optional(),
    /** Sentry ortam etiketi — verilmezse APP_ENV kullanılır. */
    SENTRY_ENVIRONMENT: z.string().optional(),
    /** Örnekleme oranı: 0–1. Varsayılan 1 (tüm hatalar). */
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  },

  client: {
    NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
    NEXT_PUBLIC_SITE_NAME: z.string().default('Medya 333'),
    /** Fiyatların KDV dahil gösterildiğini UI'da belirtmek için */
    NEXT_PUBLIC_PRICES_TAX_INCLUSIVE: z.coerce.boolean().default(true),
  },

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    IP_HASH_SALT: process.env.IP_HASH_SALT,
    ORDER_TOKEN_SECRET: process.env.ORDER_TOKEN_SECRET,
    REDIS_URL: process.env.REDIS_URL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    APP_BASE_URL: process.env.APP_BASE_URL,
    TRUSTED_PROXY: process.env.TRUSTED_PROXY,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    DEFAULT_TAX_RATE_BP: process.env.DEFAULT_TAX_RATE_BP,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    PAYMENT_ENVIRONMENT: process.env.PAYMENT_ENVIRONMENT,
    IYZICO_API_KEY: process.env.IYZICO_API_KEY,
    IYZICO_SECRET_KEY: process.env.IYZICO_SECRET_KEY,
    IYZICO_BASE_URL: process.env.IYZICO_BASE_URL,
    PAYTR_MERCHANT_ID: process.env.PAYTR_MERCHANT_ID,
    PAYTR_MERCHANT_KEY: process.env.PAYTR_MERCHANT_KEY,
    PAYTR_MERCHANT_SALT: process.env.PAYTR_MERCHANT_SALT,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: process.env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED,
    IG_APP_ID: process.env.IG_APP_ID,
    IG_APP_SECRET: process.env.IG_APP_SECRET,
    IG_ACCESS_TOKEN: process.env.IG_ACCESS_TOKEN,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
    INVOICE_PROVIDER: process.env.INVOICE_PROVIDER,
    INVOICE_API_KEY: process.env.INVOICE_API_KEY,
    INVOICE_API_SECRET: process.env.INVOICE_API_SECRET,
    MAIL_FROM: process.env.MAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_PRICES_TAX_INCLUSIVE: process.env.NEXT_PUBLIC_PRICES_TAX_INCLUSIVE,
  },

  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
})
