/**
 * GÖRSEL KONTROL — Faz 6
 *
 * Gerçek Chromium ile 12 ekranın görüntüsünü alır ve her genişlikte YATAY
 * TAŞMA ölçer. Test yeşil olsa bile gözle görülür bir sorun kalmasın diye
 * ayrı bir araçtır; CI'ın parçası değildir.
 *
 *   node scripts/screenshots.mjs [baseURL]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, devices } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000'
const OUT = 'screenshots'
mkdirSync(OUT, { recursive: true })

const ADMIN = { email: 'admin@medya333.local', password: 'Medya333-Admin-2026' }
const WIDTHS = [375, 390, 430, 768, 1024, 1440]

const report = []

async function shoot(page, name, { full = true } = {}) {
  await page.waitForTimeout(350)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  const file = `${OUT}/${name}.png`
  await page.screenshot({ path: file, fullPage: full })
  report.push({ name, width: page.viewportSize()?.width ?? 0, overflow, file })
  console.log(`  ${overflow > 0 ? '✗' : '✓'} ${name.padEnd(34)} taşma=${overflow}px`)
}

/** Sihirbazda hedef + miktar seçilmiş duruma getirir. */
async function fillWizard(page, { platform = 'instagram', service = 'takipci' } = {}) {
  await page.goto(`${BASE}/?p=${platform}&s=${service}#siparis`)
  const section = page.locator('section[aria-labelledby="step-target"]')
  await section.locator('input').first().fill('@medya333')
  const cb = page.getByRole('checkbox').first()
  await cb.waitFor({ state: 'visible', timeout: 15000 })
  await cb.check()
}

async function guestOrder(page, email) {
  await fillWizard(page)
  await page.getByTestId('preset-1000').click()
  await page.getByLabel('Ad', { exact: true }).fill('Ayşe')
  await page.getByLabel('Soyad', { exact: true }).fill('Yılmaz')
  await page.getByLabel('E-posta', { exact: true }).fill(email)
  for (const name of [
    /Hizmet \/ Satış Sözleşmesi/,
    /İptal ve İade Koşulları/,
    /KVKK \/ Gizlilik Metni/,
  ]) {
    await page.getByRole('checkbox', { name }).check()
  }
  await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
  await page.getByTestId('order-no').waitFor({ timeout: 20000 })
  return page.getByTestId('order-no').innerText()
}

// ⚠️ Bu ortamda Playwright'ın indirdiği tarayıcı yerine önceden kurulmuş
// Chromium kullanılır (playwright.config.ts ile aynı yaklaşım).
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)

try {
  // ------------------------------------------------------------------ masaüstü
  console.log('\nMASAÜSTÜ (1440px)')
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await desktop.newPage()

  await page.goto(BASE)
  await shoot(page, '01-home-desktop')

  await page.goto(`${BASE}/#hizmetler`)
  await shoot(page, '03-platform-selection')

  await page.goto(`${BASE}/?p=youtube#siparis`)
  await shoot(page, '04-service-selection')

  await page.goto(`${BASE}/?p=instagram&s=takipci#siparis`)
  await shoot(page, '05-variant-selection')

  await fillWizard(page)
  await shoot(page, '06-target')

  await page.getByTestId('preset-1000').click()
  await shoot(page, '07-quantity-package')

  const email = `shot-${Date.now()}@ornek.test`
  const orderNo = await guestOrder(page, email)
  await shoot(page, '08-checkout')

  await page.getByTestId('start-payment').click()
  await page.waitForURL(/\/odeme\/test\//, { timeout: 20000 })
  await page.getByTestId('mock-pay-success').click()
  await page.getByTestId('payment-success').waitFor({ timeout: 30000 })
  await shoot(page, '09-success')

  await page.getByRole('link', { name: 'Siparişimi Görüntüle' }).click()
  await page.getByTestId('fulfillment-progress').waitFor({ timeout: 20000 })
  await shoot(page, '12-customer-fulfillment-detail')

  await page.goto(`${BASE}/siparis-takip?o=${orderNo}`)
  await shoot(page, '11-order-tracking')

  await page.goto(`${BASE}/yardim`)
  await shoot(page, '13-help')

  // Hesabım — admin hesabıyla (müşteri paneli, yönetim ekranına DOKUNULMAZ)
  await page.goto(`${BASE}/giris`)
  await page.getByLabel('E-posta').fill(ADMIN.email)
  await page.getByLabel('Şifre').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Giriş Yap' }).click()
  await page.waitForURL(/\/hesabim/, { timeout: 20000 })
  await shoot(page, '10-account')

  await desktop.close()

  // -------------------------------------------------------------------- mobil
  console.log('\nMOBİL (390px)')
  const mobile = await browser.newContext({ ...devices['Pixel 7'] })
  const m = await mobile.newPage()

  await m.goto(BASE)
  await shoot(m, '02-home-mobile')

  await fillWizard(m)
  await m.getByTestId('preset-1000').click()
  await shoot(m, '07b-quantity-package-mobile')
  await mobile.close()

  // ------------------------------------------- her kırılma noktasında taşma
  console.log('\nKIRILMA NOKTALARI')
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    const p = await ctx.newPage()
    for (const [label, url] of [
      ['home', '/'],
      ['wizard', '/?p=instagram&s=takipci#siparis'],
      ['yardim', '/yardim'],
      ['takip', '/siparis-takip'],
    ]) {
      await p.goto(`${BASE}${url}`)
      await p.waitForTimeout(250)
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      report.push({ name: `${label}@${width}`, width, overflow, file: null })
      console.log(`  ${overflow > 0 ? '✗' : '✓'} ${label}@${width}px taşma=${overflow}px`)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
const bad = report.filter((r) => r.overflow > 0)
console.log(`\n${bad.length === 0 ? '✓ Yatay taşma yok.' : `✗ ${bad.length} ekranda taşma var!`}`)
if (bad.length > 0) {
  for (const b of bad) console.log(`   ${b.name} → ${b.overflow}px`)
  process.exitCode = 1
}
