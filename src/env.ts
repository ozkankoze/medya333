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

    // --- Vergi ---
    /** Varsayılan KDV oranı, basis point. %20 → 2000. DB'deki TaxRate önceliklidir. */
    DEFAULT_TAX_RATE_BP: z.coerce.number().int().min(0).max(10_000).default(2000),

    // --- ÖDEME (Faz 4 — Faz 0'da entegrasyon YOK, alanlar opsiyonel) ---
    PAYMENT_PROVIDER: z.enum(['iyzico', 'paytr']).default('iyzico'),
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

    // --- Gözlemlenebilirlik ---
    SENTRY_DSN: z.string().url().optional(),
  },

  client: {
    NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
    NEXT_PUBLIC_SITE_NAME: z.string().default('Medya 333'),
    /** Fiyatların KDV dahil gösterildiğini UI'da belirtmek için */
    NEXT_PUBLIC_PRICES_TAX_INCLUSIVE: z.coerce.boolean().default(true),
  },

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
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
    DEFAULT_TAX_RATE_BP: process.env.DEFAULT_TAX_RATE_BP,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
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
    SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_PRICES_TAX_INCLUSIVE: process.env.NEXT_PUBLIC_PRICES_TAX_INCLUSIVE,
  },

  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
})
