import { defineConfig, devices } from '@playwright/test'

/**
 * PLAYWRIGHT E2E YAPILANDIRMASI
 *
 * `webServer` üretim derlemesini ayağa kaldırır — dev sunucusundaki HMR
 * gürültüsü ve dev overlay'i olmadan gerçek davranış test edilir.
 *
 * CI'da çalıştırmadan önce veritabanı hazır olmalıdır:
 *   npm run db:deploy && npm run db:seed && npm run build && npm run test:e2e
 */
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
        command: 'npx next start -p 3100',
        url: 'http://127.0.0.1:3100',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
