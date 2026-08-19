import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⭐ ÜRETİM AÇILIŞ KAPISI TESTLERİ (Faz 7)
 *
 * `auditProductionConfig` env'i modül yüklenirken okuduğu için her senaryoda
 * modül taze yüklenir (`vi.resetModules`).
 */

const BASE_ENV = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.internal:5432/medya333',
  AUTH_SECRET: 'K7pQx2mNvR8sT4wY6zA1bC3dE5fG9hJ0kL2mN4pQ',
  ORDER_TOKEN_SECRET: 'Z9yX8wV7uT6sR5qP4oN3mL2kJ1hG0fE9dC8bA7zY',
  IP_HASH_SALT: 'a1b2c3d4e5f60718293a4b5c',
  REDIS_URL: 'redis://cache.internal:6379',
  APP_BASE_URL: 'https://medya333.com',
  NEXT_PUBLIC_SITE_URL: 'https://medya333.com',
  PAYMENT_PROVIDER: 'iyzico',
  PAYMENT_ENVIRONMENT: 'production',
  IYZICO_API_KEY: 'live-api-key-value',
  IYZICO_SECRET_KEY: 'live-secret-key-value',
  IYZICO_BASE_URL: 'https://api.iyzipay.com',
  SKIP_ENV_VALIDATION: '',
} as const

const original = { ...process.env }

async function auditWith(overrides: Record<string, string | undefined>) {
  vi.resetModules()
  process.env = { ...original, ...BASE_ENV, ...overrides } as NodeJS.ProcessEnv
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
  }
  const mod = await import('@/server/production-guard')
  return { ...mod, findings: mod.auditProductionConfig() }
}

const codes = (findings: Array<{ code: string; level: string }>) =>
  findings.filter((f) => f.level === 'blocker').map((f) => f.code)

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...original }
})

describe('sağlam üretim yapılandırması', () => {
  it('blocker üretmez ve boot açılır', async () => {
    const { findings, assertProductionReady } = await auditWith({})
    expect(codes(findings)).toEqual([])
    expect(() => assertProductionReady()).not.toThrow()
  })

  it('e-posta ve hata izleme eksikse UYARI verir, boot\'u durdurmaz', async () => {
    const { findings, assertProductionReady } = await auditWith({})
    const warnings = findings.filter((f) => f.level === 'warning').map((f) => f.code)
    expect(warnings).toContain('EMAIL_NOT_CONFIGURED')
    expect(warnings).toContain('ERROR_TRACKING_NOT_CONFIGURED')
    expect(() => assertProductionReady()).not.toThrow()
  })
})

describe('⚠️ ÜRETİMDE REDDEDİLEN yapılandırmalar', () => {
  it('REDIS_URL yoksa boot FAIL', async () => {
    const { findings, assertProductionReady } = await auditWith({ REDIS_URL: undefined })
    expect(codes(findings)).toContain('REDIS_REQUIRED')
    expect(() => assertProductionReady()).toThrow(/REDIS_REQUIRED/)
  })

  it('mock ödeme sağlayıcısı boot FAIL', async () => {
    const { findings, assertProductionReady } = await auditWith({ PAYMENT_PROVIDER: 'mock' })
    expect(codes(findings)).toContain('MOCK_PAYMENT')
    expect(() => assertProductionReady()).toThrow()
  })

  it('PAYMENT_ENVIRONMENT=sandbox boot FAIL', async () => {
    const { findings } = await auditWith({ PAYMENT_ENVIRONMENT: 'sandbox' })
    expect(codes(findings)).toContain('PAYMENT_SANDBOX')
  })

  it('sağlayıcı credential eksikse boot FAIL', async () => {
    const { findings } = await auditWith({ IYZICO_SECRET_KEY: undefined })
    expect(codes(findings)).toContain('PROVIDER_CREDENTIALS_MISSING')
  })

  it('⚠️ eksik credential raporunda SECRET DEĞERİ geçmez', async () => {
    const { findings } = await auditWith({ IYZICO_API_KEY: undefined })
    const text = JSON.stringify(findings)
    expect(text).toContain('IYZICO_API_KEY')
    // Değerler değil, yalnızca ADLAR raporlanır
    expect(text).not.toContain('live-secret-key-value')
    expect(text).not.toContain(BASE_ENV.AUTH_SECRET)
    expect(text).not.toContain(BASE_ENV.ORDER_TOKEN_SECRET)
  })

  it('sandbox provider adresi boot FAIL', async () => {
    const { findings } = await auditWith({ IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com' })
    expect(codes(findings)).toContain('PROVIDER_SANDBOX_URL')
  })

  it('PayTR seçiliyse kendi credential\'ları aranır', async () => {
    const { findings } = await auditWith({ PAYMENT_PROVIDER: 'paytr' })
    expect(codes(findings)).toContain('PROVIDER_CREDENTIALS_MISSING')
  })

  it('HTTPS olmayan taban adres boot FAIL', async () => {
    const { findings } = await auditWith({
      APP_BASE_URL: 'http://medya333.com',
      NEXT_PUBLIC_SITE_URL: 'http://medya333.com',
    })
    expect(codes(findings)).toContain('BASE_URL_NOT_HTTPS')
  })

  it('localhost taban adres boot FAIL', async () => {
    const { findings } = await auditWith({
      APP_BASE_URL: 'https://localhost:3000',
      NEXT_PUBLIC_SITE_URL: 'https://localhost:3000',
    })
    expect(codes(findings)).toContain('BASE_URL_LOCALHOST')
  })

  it('placeholder sır boot FAIL', async () => {
    const { findings } = await auditWith({
      AUTH_SECRET: 'change-me-change-me-change-me-1234567890',
    })
    expect(codes(findings)).toContain('PLACEHOLDER_SECRET')
  })

  it('aynı sırrın iki yerde kullanılması boot FAIL', async () => {
    const shared = 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8L9z0'
    const { findings } = await auditWith({ AUTH_SECRET: shared, ORDER_TOKEN_SECRET: shared })
    expect(codes(findings)).toContain('SECRET_REUSE')
  })

  it('APP_BASE_URL yoksa uyarır (derlemeye gömülü adres riski)', async () => {
    const { findings } = await auditWith({ APP_BASE_URL: undefined })
    expect(findings.map((f) => f.code)).toContain('APP_BASE_URL_MISSING')
  })
})

describe('⭐ dağıtım AŞAMASI (üretim derlemesi ≠ canlı ortam)', () => {
  it('APP_ENV tanımsızsa CANLI kabul edilir — kapı gevşemez (fail-closed)', async () => {
    const { findings, assertProductionReady } = await auditWith({
      APP_ENV: undefined,
      PAYMENT_PROVIDER: 'mock',
    })
    expect(codes(findings)).toContain('MOCK_PAYMENT')
    expect(() => assertProductionReady()).toThrow()
  })

  it('E2E aşaması: üretim derlemesi mock ödeme ile açılabilir', async () => {
    const { findings, assertProductionReady } = await auditWith({
      APP_ENV: 'e2e',
      PAYMENT_PROVIDER: 'mock',
      PAYMENT_ENVIRONMENT: 'sandbox',
      APP_BASE_URL: 'http://127.0.0.1:3100',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3100',
      IYZICO_API_KEY: undefined,
      IYZICO_SECRET_KEY: undefined,
      IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
    })
    expect(codes(findings)).toEqual([])
    expect(() => assertProductionReady()).not.toThrow()
    // Bulgular kaybolmaz, yalnızca seviyeleri düşer
    expect(findings.map((f) => f.code)).toContain('MOCK_PAYMENT')
  })

  it('staging aşaması da aynı şekilde açılır', async () => {
    const { assertProductionReady } = await auditWith({
      APP_ENV: 'staging',
      PAYMENT_PROVIDER: 'mock',
      PAYMENT_ENVIRONMENT: 'sandbox',
    })
    expect(() => assertProductionReady()).not.toThrow()
  })

  it('⚠️ APP_ENV bir KAÇIŞ KAPISI değil: canlı olmayan aşamada gerçek tahsilat açılamaz', async () => {
    const { findings, assertProductionReady } = await auditWith({
      APP_ENV: 'staging',
      PAYMENT_ENVIRONMENT: 'production',
    })
    expect(codes(findings)).toContain('STAGE_REAL_PAYMENT')
    expect(() => assertProductionReady()).toThrow(/STAGE_REAL_PAYMENT/)
  })

  it('⚠️ development\'ta bile aşama/para tutarsızlığı blocker kalır', async () => {
    const { findings } = await auditWith({
      NODE_ENV: 'development',
      APP_ENV: 'e2e',
      PAYMENT_ENVIRONMENT: 'production',
    })
    expect(codes(findings)).toEqual(['STAGE_REAL_PAYMENT'])
  })
})

describe('geliştirme ortamı', () => {
  it('aynı hatalar development\'ta UYARI olur, boot\'u durdurmaz', async () => {
    const { findings, assertProductionReady } = await auditWith({
      NODE_ENV: 'development',
      APP_ENV: 'production',
      REDIS_URL: undefined,
      PAYMENT_PROVIDER: 'mock',
      PAYMENT_ENVIRONMENT: 'sandbox',
      APP_BASE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    })
    expect(findings.every((f) => f.level === 'warning')).toBe(true)
    expect(() => assertProductionReady()).not.toThrow()
    // Uyarılar yine de görünür
    expect(findings.map((f) => f.code)).toContain('MOCK_PAYMENT')
  })
})
