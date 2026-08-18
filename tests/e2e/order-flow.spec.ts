import { expect, test, type Page } from '@playwright/test'

/**
 * E2E — SİPARİŞ AKIŞI
 *
 * Faz 0'da konteynerde elle çalıştırdığım `audit.mjs` kontrollerinin
 * CI'da koşabilen kalıcı hali.
 *
 * Kapsam (kullanıcının istediği 11 senaryo):
 *   1 site açılır · 2 platform · 3 hizmet · 4 varyant · 5 hedef · 6 onay
 *   7 miktar · 8 fiyat güncellenir · 9 sipariş özeti · 10 geçersiz hedef
 *   11 mobil sticky bar
 * Ayrıca: boş durum, loading, disabled state, a11y, fiyat formatı, unitLabel.
 */

const IG = /Instagram/
const FOLLOWERS = /Takipçi/

async function selectPlatform(page: Page, name = IG) {
  await page.getByRole('button', { name }).first().click()
  await expect(page.locator('#step-service')).toBeVisible()
}

async function selectService(page: Page, name = FOLLOWERS) {
  await page.getByRole('button', { name }).first().click()
  await expect(page.locator('#step-target')).toBeVisible()
}

async function enterTarget(page: Page, value = '@medya333') {
  await page.getByPlaceholder(/@medya333/).fill(value)
}

async function confirmTarget(page: Page) {
  // Hedef onay kutusu — müşteri onay kutuları henüz DOM'da değil
  const checkbox = page.getByRole('checkbox').first()
  await expect(checkbox).toBeVisible({ timeout: 15_000 })
  await checkbox.check()
  await expect(page.locator('#step-quantity')).toBeVisible()
}

/** Adım 6: müşteri bilgileri + 3 zorunlu onay */
async function fillCustomer(page: Page, email = 'e2e-misafir@ornek.test') {
  await expect(page.locator('#step-customer')).toBeVisible()
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
}

const CREATE_CTA = 'Siparişi Oluştur'

// ---------------------------------------------------------------------------

test.describe('sipariş akışı', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('1 · site açılır ve ne yapılacağı belli', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Social Media Growth, Simplified.',
    )
    await expect(page.locator('#step-platform')).toBeVisible()
    await expect(page.getByText('Gerçek kullanıcılar · Bot ve sahte hesap yok')).toBeVisible()
    // tek h1 (a11y)
    expect(await page.locator('h1').count()).toBe(1)
  })

  test('boş durum: CTA pasif ve nedeni yazıyor', async ({ page }) => {
    const cta = page.getByRole('button', { name: CREATE_CTA }).first()
    await expect(cta).toBeDisabled()
    // Neden hem masaüstü kartında hem mobil çubukta yazar; görünür olanı doğrula
    await expect(
      page.getByText(/Başlamak için bir platform seçin/).locator('visible=true'),
    ).toBeVisible()
  })

  test('2 · platform seçilir', async ({ page }) => {
    await selectPlatform(page)
    await expect(page.getByRole('button', { name: IG }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('3-4 · hizmet ve varyant seçilir', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)

    // Takipçi'nin 2 görünür varyantı var → paket seçici görünür
    await expect(page.getByText('Paket', { exact: true })).toBeVisible()
    const premium = page.getByRole('button', { name: /Premium/ })
    await premium.click()
    await expect(premium).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('EN ÇOK TERCİH EDİLEN')).toBeVisible()
  })

  test('tek varyantlı hizmette paket seçici GÖSTERİLMEZ', async ({ page }) => {
    await selectPlatform(page)
    await page.getByRole('button', { name: /Görüntülenme/ }).first().click()
    await expect(page.locator('#step-target')).toBeVisible()
    await expect(page.getByText('Paket', { exact: true })).toHaveCount(0)
  })

  test('5-6 · hedef girilir, doğrulama kartı çıkar, onaylanır', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)
    await enterTarget(page)

    // loading göstergesi
    await expect(page.locator('svg.animate-spin')).toBeVisible()

    // Instagram fallback: UNVERIFIED + kanonik URL + onay kutusu
    await expect(page.getByText('Doğrulanamadı')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('https://www.instagram.com/medya333/')).toBeVisible()
    await expect(page.locator('svg.animate-spin')).toHaveCount(0)

    // onaydan ÖNCE miktar adımı açılmamalı
    await expect(page.locator('#step-quantity')).toHaveCount(0)

    await confirmTarget(page)
  })

  test('7-8 · miktar değişince fiyat anında güncellenir', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)
    await enterTarget(page)
    await confirmTarget(page)

    const total = page.locator('aside').getByText(/₺/).last()

    await page.getByRole('button', { name: '100 adet', exact: true }).click()
    await expect(total).toHaveText(/45,00\s*₺/)

    await page.getByRole('button', { name: '1.000 adet', exact: true }).click()
    await expect(total).toHaveText(/300,00\s*₺/)

    await page.getByRole('button', { name: '5.000 adet', exact: true }).click()
    await expect(total).toHaveText(/1\.200,00\s*₺/)
  })

  test('kademe ipucu gösterilir, toptan fiyat TABLOSU gösterilmez', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)
    await enterTarget(page)
    await confirmTarget(page)

    await page.getByRole('button', { name: '1.000 adet', exact: true }).click()
    await expect(page.getByText(/daha ekleyerek bir sonraki fiyat seviyesine/)).toBeVisible()
    await expect(page.getByText(/Yeni birim fiyat:/)).toBeVisible()
    expect(await page.locator('table').count()).toBe(0)
  })

  test('unitLabel: "adet" ve "hafta" doğru gösterilir', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)
    await enterTarget(page)
    await confirmTarget(page)
    await expect(page.getByText('en az 100 adet')).toBeVisible()

    await page.goto('/')
    await selectPlatform(page)
    await page.getByRole('button', { name: /Profil Tanıtımı/ }).click()
    await expect(page.locator('#step-target')).toBeVisible()
    await enterTarget(page)
    await confirmTarget(page)
    await expect(page.getByText('en az 1 hafta')).toBeVisible()
    await expect(page.getByRole('button', { name: '1 hafta', exact: true })).toBeVisible()
  })

  test('9 · sipariş özeti oluşur', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)
    await enterTarget(page)
    await confirmTarget(page)
    await page.getByRole('button', { name: '1.000 adet', exact: true }).click()

    const summary = page.locator('#step-review')
    await expect(summary).toBeVisible()
    const section = page.getByRole('region', { name: 'Sipariş özeti' })
    await expect(section).toContainText('Instagram · Takipçi')
    await expect(section).toContainText('@medya333')
    await expect(section).toContainText('1.000 adet')
    await expect(section).toContainText('Kullanıcı onayladı')

    // Bilgiler girilmeden CTA hâlâ pasif — özet tek başına yeterli değil
    await expect(page.getByRole('button', { name: CREATE_CTA }).first()).toBeDisabled()

    await fillCustomer(page)
    await expect(page.getByRole('button', { name: CREATE_CTA }).first()).toBeEnabled()
  })

  test('10 · geçersiz hedef doğru hata verir', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)

    await enterTarget(page, 'https://tiktok.com/@medya333')
    // Next'in route announcer'ı da role=alert taşır; kendi hata metnimizi hedefle
    await expect(page.locator('p[role="alert"]')).toContainText(/Instagram/)
    await expect(page.getByPlaceholder(/@medya333/)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#step-quantity')).toHaveCount(0)

    await enterTarget(page, '<script>alert(1)</script>')
    await expect(page.locator('p[role="alert"]')).toBeVisible()
  })

  test('fiyat formatı Türkçe: sembol sonda, KDV dahil ibaresi var', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)
    await enterTarget(page)
    await confirmTarget(page)
    await page.getByRole('button', { name: '1.000 adet', exact: true }).click()

    const aside = page.locator('aside')
    await expect(aside).toContainText('KDV dahil')
    await expect(aside.getByText(/₺/).last()).toHaveText(/^\d[\d.]*,\d{2}\s*₺$/)
    // "1.000 adet × 0,30 ₺" — birim adı TEKRAR ETMEZ
    await expect(aside).toContainText('1.000 adet × 0,30 ₺')
    await expect(aside).not.toContainText('₺ / adet')
  })

  test('a11y: focus görünür, aria-labelledby boşa işaret etmiyor', async ({ page }) => {
    await selectPlatform(page)
    const dangling = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-labelledby]')]
        .map((el) => el.getAttribute('aria-labelledby'))
        .filter((id) => id && !document.getElementById(id)),
    )
    expect(dangling).toEqual([])

    // :focus-visible yalnızca klavye ile tetiklenir — programatik focus() değil
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => {
      const el = document.activeElement
      return el ? getComputedStyle(el).outlineWidth : '0px'
    })
    expect(outline).not.toBe('0px')
  })

  test('URL adım durumunu taşır (paylaşılabilir, geri tuşu çalışır)', async ({ page }) => {
    await selectPlatform(page)
    await selectService(page)
    await expect(page).toHaveURL(/[?&]p=instagram/)
    await expect(page).toHaveURL(/[?&]s=takipci/)
  })
})

// ---------------------------------------------------------------------------

test.describe('mobil', () => {
  test.skip(({ isMobile }) => !isMobile, 'yalnızca mobil projede')

  test('11 · sticky fiyat çubuğu ekranın altında kalır', async ({ page }) => {
    await page.goto('/')
    const bar = page.locator('.sticky-price-bar')
    await expect(bar).toBeVisible()

    const viewport = page.viewportSize()!
    const box = (await bar.boundingBox())!
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(2)

    // sayfa kaydırılınca da altta kalır
    await page.mouse.wheel(0, 800)
    const after = (await bar.boundingBox())!
    expect(Math.abs(after.y + after.height - viewport.height)).toBeLessThan(2)

    // dokunma hedefi
    const cta = page.getByRole('button', { name: CREATE_CTA })
    expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(bar).toContainText('KDV dahil')
  })

  test('adım açılınca otomatik kaydırılır ve yatay taşma yok', async ({ page }) => {
    await page.goto('/')
    await selectPlatform(page)
    await page.waitForTimeout(700)
    const box = (await page.locator('#step-service').boundingBox())!
    expect(box.y).toBeLessThan(300)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('mobil akış uçtan uca çalışır', async ({ page }) => {
    await page.goto('/')
    await selectPlatform(page)
    await selectService(page)
    await enterTarget(page)
    await confirmTarget(page)
    await page.getByRole('button', { name: '1.000 adet', exact: true }).click()
    await expect(page.locator('.sticky-price-bar')).toContainText(/300,00\s*₺/)
    await fillCustomer(page, 'e2e-mobil@ornek.test')
    await expect(page.getByRole('button', { name: CREATE_CTA })).toBeEnabled()
  })
})
