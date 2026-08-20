import { defineConfig, devices } from '@playwright/test'

/**
 * ⭐ DUMAN TESTİ YAPILANDIRMASI — OKUMA KATMANI (Faz 11)
 *
 *   SMOKE_BASE_URL=https://<hedef> npm run test:smoke
 *
 * ⚠️ `webServer` YOKTUR. Bu paket, DAĞITILMIŞ bir ortamı doğrular; yerelde
 * sunucu ayağa kaldırmaz. Hedef verilmezse çalışmaz — "neyi test ettiğini
 * bilmeden yeşil olmak" en tehlikeli test sonucudur.
 *
 * ⚠️ Bu paket HİÇBİR KAYIT OLUŞTURMAZ ve bu yüzden canlı ortama karşı da
 * çalıştırılabilir. Yazma katmanı `playwright.config.ts` altındadır ve orası
 * canlı alan adını REDDEDER.
 */

const BASE = process.env.SMOKE_BASE_URL ?? process.env.E2E_BASE_URL

if (!BASE) {
  throw new Error(
    '\n\n  SMOKE_BASE_URL tanımlı değil.\n' +
      '\n' +
      '    SMOKE_BASE_URL=https://www.medya333.com npm run test:smoke\n' +
      '    SMOKE_BASE_URL=http://127.0.0.1:3100    npm run test:smoke\n\n',
  )
}

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // ⚠️ Ağ üzerinden gerçek bir ortam test edilir; tek seferlik takılma
  // dağıtımı bloke etmesin diye bir kez tekrar denenir.
  retries: 1,
  workers: 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  timeout: 45_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE,
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    // ⚠️ Duman testi gerçek bir tarayıcı gibi davranır; UA gizlenmez.
    extraHTTPHeaders: { 'x-medya333-smoke': '1' },
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
