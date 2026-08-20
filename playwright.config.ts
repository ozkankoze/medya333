import { defineConfig, devices } from '@playwright/test'
import { assertNotProductionTarget } from './tests/smoke/guard'

/**
 * PLAYWRIGHT E2E YAPILANDIRMASI
 *
 * `webServer` üretim derlemesini ayağa kaldırır — dev sunucusundaki HMR
 * gürültüsü ve dev overlay'i olmadan gerçek davranış test edilir.
 *
 * CI'da çalıştırmadan önce veritabanı hazır olmalıdır:
 *   npm run db:deploy && npm run db:seed && npm run build && npm run test:e2e
 */
/**
 * ⛔ CANLI ALAN ADI HEDEF OLARAK REDDEDİLİR (Faz 11)
 *
 * Bu paket sipariş, kullanıcı, hedef ve fulfillment KAYDI oluşturur. Canlı
 * veritabanında demo kayıt üretmek geri alınamaz ve gerçek sipariş
 * numaralarıyla karışır.
 *
 * Kontrol bir uyarı değil, bir KAPIDIR: eşleşme varsa Playwright hiç başlamaz.
 * Canlıya karşı yalnızca OKUMA duman testi çalıştırılır:
 *     SMOKE_BASE_URL=https://www.medya333.com npm run test:smoke
 */
assertNotProductionTarget(process.env.E2E_BASE_URL)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    /**
     * Normalde `npx playwright install` ile inen tarayıcı kullanılır.
     * Chromium'un önceden kurulu olduğu (ve indirmenin engellendiği)
     * ortamlarda PW_CHROMIUM_PATH ile yol verilebilir.
     */
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // ⚠️ E2E'de mock sağlayıcı: gerçek merchant bilgisi yok, canlı uca
        // istek atılmaz. Ödeme yolu ATLANMAZ — imza/doğrulama aynen çalışır.
        command: 'npx next start -p 3100',
        env: {
          ...process.env,
          /**
           * ⚠️ `next start` NODE_ENV'i her zaman "production" yapar. Üretim
           * açılış kapısı (server/production-guard.ts) bu yüzden aşamayı
           * APP_ENV'den okur: burada "e2e" olduğu için mock ödeme ve
           * localhost adresi blocker değil UYARI olur.
           *
           * Bu bir kaçış kapısı DEĞİLDİR: APP_ENV production değilken
           * PAYMENT_ENVIRONMENT=production açılamaz (STAGE_REAL_PAYMENT).
           */
          APP_ENV: 'e2e',
          PAYMENT_PROVIDER: 'mock',
          PAYMENT_ENVIRONMENT: 'sandbox',
          // ⚠️ Sağlayıcıya giden callback/success/checkout adresleri bundan
          // üretilir. NEXT_PUBLIC_SITE_URL derlemeye gömüldüğü için çalışma
          // zamanında değiştirilemez; APP_BASE_URL tam da bunun için var.
          APP_BASE_URL: 'http://127.0.0.1:3100',
        },
        url: 'http://127.0.0.1:3100',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
