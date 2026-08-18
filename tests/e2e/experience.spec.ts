import { expect, test, type Page } from '@playwright/test'

/**
 * E2E — FAZ 6 MÜŞTERİ DENEYİMİ (brief'teki 20 senaryo)
 *
 *  1 ana sayfa · 2 platform seçimi · 3 Instagram takipçi · 4 varyantlar
 *  5 365 gün garanti görünümü · 6 YouTube abone · 7 YouTube izlenme
 *  8 Facebook · 9 TikTok · 10 hazır paket · 11 hedef doğrulama
 * 12 mobil sihirbaz · 13 checkout · 14 misafir sipariş · 15 giriş/kayıt
 * 16 hesabım · 17 sipariş takip · 18 müşteri fulfillment durumu
 * 19 hata durumu · 20 erişilebilirlik
 */

let ipSeq = 0
async function isolateClient(page: Page) {
  ipSeq++
  const octet = test.info().project.name === 'mobile' ? 8 : 7
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.10${octet}.${ipSeq % 250}` })
}

/** Sihirbazda platform + hizmet seçer (keşif bağlantısı üzerinden). */
async function openService(page: Page, platform: string, service: string) {
  await isolateClient(page)
  await page.goto(`/?p=${platform}&s=${service}#siparis`)
  await expect(page.locator('#step-target')).toBeVisible({ timeout: 15_000 })
}

/** `#step-*` id'leri BAŞLIKTA durur; alanlar bölümün içindedir. */
function stepSection(page: Page, name: string) {
  return page.locator(`section[aria-labelledby="step-${name}"]`)
}

async function confirmTarget(page: Page, value: string) {
  await stepSection(page, 'target').locator('input').first().fill(value)
  const checkbox = page.getByRole('checkbox').first()
  await expect(checkbox).toBeVisible({ timeout: 15_000 })
  await checkbox.check()
}

// ===========================================================================
test.describe('1-2 · ana sayfa ve keşif', () => {
  test('1 · hero, CTA\'lar ve gerçek katalog sayıları', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sosyal Medyanızı Büyütün')
    await expect(page.getByRole('link', { name: 'Şimdi Başla' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Hizmetleri İncele' })).toBeVisible()

    // ⚠️ Sayılar KATALOGDAN gelir — sahte istatistik yok
    const catalog = await (await page.request.get('/api/v1/catalog/snapshot')).json()
    const platformCount = catalog.platforms.length
    const serviceCount = catalog.platforms.reduce(
      (n: number, p: { services: unknown[] }) => n + p.services.length,
      0,
    )
    const stats = page.locator('dl').first()
    await expect(stats).toContainText(String(platformCount))
    await expect(stats).toContainText(String(serviceCount))

    // Sahte sosyal kanıt İFADELERİ yok
    const body = (await page.locator('body').innerText()).toLowerCase()
    for (const banned of ['mutlu müşteri', 'son 3 saat', 'kaçırma', 'yıldız', 'stokta']) {
      expect(body, `sahte sosyal kanıt: ${banned}`).not.toContain(banned)
    }
  })

  test('2 · hizmet keşfi TAMAMEN katalogdan üretilir', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')

    const catalog = await (await page.request.get('/api/v1/catalog/snapshot')).json()
    for (const p of catalog.platforms) {
      const section = page.getByTestId(`explorer-${p.slug}`)
      await expect(section).toBeVisible()
      await expect(section).toContainText(`${p.services.length} hizmet`)
    }

    // Keşif bağlantısı sihirbazı DOĞRU adımdan açar
    await page.getByTestId('explorer-service-instagram-takipci').click()
    await expect(page.locator('#step-target')).toBeVisible({ timeout: 15_000 })
    // Seçili hizmet kartı işaretli gelir
    await expect(page.getByRole('button', { name: /Takipçi/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

// ===========================================================================
test.describe('3-5 · Instagram takipçi, varyantlar ve garanti', () => {
  test('3-4 · iki varyant ve açıklamaları görünür', async ({ page }) => {
    await openService(page, 'instagram', 'takipci')

    const yabanci = page.getByRole('button', { name: /Yabancı Takipçi/ })
    const turk = page.getByRole('button', { name: /Türk Takipçi/ })
    await expect(yabanci).toBeVisible()
    await expect(turk).toBeVisible()

    await turk.click()
    await expect(turk).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/Takipçiler Türk’tür/)).toBeVisible()
  })

  test('5 · ⭐ 365 Gün Telafi Garantisi rozeti görünür', async ({ page }) => {
    await openService(page, 'instagram', 'takipci')
    // ⚠️ Rozet katalogdaki refillDays'ten gelir, hardcode değil.
    await expect(page.getByText('365 Gün Telafi Garantisi').first()).toBeVisible()
  })

  test('5b · garanti süresi OLMAYAN hizmette rozet GÖSTERİLMEZ', async ({ page }) => {
    await openService(page, 'instagram', 'begeni')
    await expect(page.getByText(/Gün Telafi Garantisi/)).toHaveCount(0)
  })
})

// ===========================================================================
test.describe('6-9 · diğer platformlar', () => {
  test('6 · YouTube abone paketleri ve fiyatları', async ({ page }) => {
    await openService(page, 'youtube', 'abone')
    await confirmTarget(page, '@medya333')

    await expect(page.getByTestId('preset-100')).toContainText('1.000,00')
    await expect(page.getByTestId('preset-500')).toContainText('4.000,00')
    await expect(page.getByTestId('preset-1000')).toHaveCount(0) // maksimum 500
  })

  test('7 · YouTube izlenme video hedefi ister', async ({ page }) => {
    await openService(page, 'youtube', 'izlenme')
    await expect(stepSection(page, 'target')).toContainText('Video bağlantısı')
    await confirmTarget(page, 'https://youtube.com/watch?v=dQw4w9WgXcQ')
    await expect(page.getByTestId('preset-1000')).toContainText('400,00')
  })

  test('8 · Facebook hizmeti sipariş edilebilir', async ({ page }) => {
    await openService(page, 'facebook', 'begeni')
    await confirmTarget(page, 'https://facebook.com/medya333/posts/123456789')
    // Instagram 49,90 ₺ × 1,25 = 62,38 ₺
    await expect(page.getByTestId('preset-100')).toContainText('62,38')
  })

  test('9 · TikTok hizmeti sipariş edilebilir', async ({ page }) => {
    await openService(page, 'tiktok', 'begeni')
    await confirmTarget(page, 'https://tiktok.com/@medya333/video/7301234567890123456')
    await expect(page.getByTestId('preset-100')).toContainText('62,38')
  })
})

// ===========================================================================
test.describe('10-11 · paket ve hedef', () => {
  test('10 · hazır paket kartları — slider YOK, "Paket fiyatı" yazar', async ({ page }) => {
    await openService(page, 'instagram', 'takipci')
    await confirmTarget(page, '@medya333')

    await expect(page.getByTestId('preset-quantities')).toBeVisible()
    await expect(page.locator('input[type="range"]')).toHaveCount(0)
    await expect(page.getByTestId('preset-500')).toContainText('Paket fiyatı')
    // ⚠️ Sabit pakette birim fiyat GÖSTERİLMEZ
    await expect(page.getByTestId('preset-500')).not.toContainText('/ takipçi')
    await expect(stepSection(page, 'quantity')).not.toContainText('0,00 ₺')
  })

  test('11 · hedef doğrulanamadığında kullanıcı onayı istenir', async ({ page }) => {
    await openService(page, 'instagram', 'takipci')
    await stepSection(page, 'target').locator('input').first().fill('@medya333')

    await expect(page.getByText('Doğrulanamadı')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('checkbox').first()).toBeVisible()
    // ⚠️ Teknik adapter detayı müşteriye SIZMAZ
    const text = await stepSection(page, 'target').innerText()
    for (const t of ['adapter', 'oembed', 'API', 'scraping']) {
      expect(text.toLowerCase()).not.toContain(t.toLowerCase())
    }
  })

  test('11b · geçersiz hedef ne yapılacağını söyler', async ({ page }) => {
    await openService(page, 'instagram', 'takipci')
    await stepSection(page, 'target').locator('input').first().fill('https://tiktok.com/@medya333')
    const alert = page.locator('p[role="alert"]')
    await expect(alert).toContainText(/Instagram/)
    await expect(stepSection(page, 'target').locator('input').first()).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })
})

// ===========================================================================
test.describe('12-13 · sihirbaz ve checkout', () => {
  test('12 · fiyat özeti ara toplam ve KDV satırlarını gösterir', async ({ page }) => {
    await openService(page, 'instagram', 'takipci')
    await confirmTarget(page, '@medya333')
    await page.getByTestId('preset-1000').click()

    // Mobilde sticky çubuk, masaüstünde sağ kart
    const isMobile = test.info().project.name === 'mobile'
    if (isMobile) {
      await expect(page.locator('.sticky-price-bar')).toContainText('KDV dahil')
    } else {
      const aside = page.locator('aside')
      await expect(aside).toContainText('Ara toplam (matrah)')
      await expect(aside).toContainText('KDV (%20)')
      await expect(aside).toContainText('599,90')
    }
  })

  test('13 · checkout öncesi sipariş, hedef, miktar ve toplam son kez görünür', async ({ page }) => {
    const email = `faz6-${Date.now()}@ornek.test`
    await openService(page, 'instagram', 'takipci')
    await confirmTarget(page, '@medya333')
    await page.getByTestId('preset-1000').click()

    const summary = page.getByRole('region', { name: 'Sipariş özeti' })
    await expect(summary).toContainText('Instagram · Takipçi')
    await expect(summary).toContainText('@medya333')
    await expect(summary).toContainText('1.000 takipçi')

    await page.getByLabel('Ad', { exact: true }).fill('Ayşe')
    await page.getByLabel('Soyad', { exact: true }).fill('Yılmaz')
    await page.getByLabel('E-posta', { exact: true }).fill(email)

    // ⚠️ ÜÇ AYRI onay — "hepsini kabul et" YOK
    const consents = [
      /Hizmet \/ Satış Sözleşmesi/,
      /İptal ve İade Koşulları/,
      /KVKK \/ Gizlilik Metni/,
    ]
    for (const name of consents) await page.getByRole('checkbox', { name }).check()
    await expect(page.getByRole('checkbox', { name: /hepsini/i })).toHaveCount(0)

    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Ödeme bekleniyor/).first()).toBeVisible()
  })
})

// ===========================================================================
test.describe('14-18 · sipariş sonrası', () => {
  test('14 · misafir sipariş oluşturur ve takip eder', async ({ page }) => {
    const email = `misafir6-${Date.now()}@ornek.test`
    await openService(page, 'instagram', 'takipci')
    await confirmTarget(page, '@medya333')
    await page.getByTestId('preset-500').click()

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
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })
    const orderNo = await page.getByTestId('order-no').innerText()

    // 17 · takip sayfası: sipariş no TEK BAŞINA yetmez
    await page.goto('/siparis-takip')
    await expect(page.getByRole('heading', { name: 'Sipariş Takibi' })).toBeVisible()
    await expect(page.getByText(/Sipariş numaranızı bulamıyor musunuz/)).toBeVisible()

    await page.getByLabel(/Sipariş numarası/i).fill(orderNo)
    await page.getByLabel(/E-posta/i).fill(email)
    await page.getByRole('button', { name: /Siparişi Görüntüle|Sorgula/ }).click()
    await expect(page.getByTestId('order-no')).toContainText(orderNo, { timeout: 20_000 })
  })

  test('15-16 · kayıt sonrası hesabım premium görünür', async ({ page }) => {
    const email = `hesap6-${Date.now()}@ornek.test`
    await isolateClient(page)
    await page.goto('/kayit')
    await page.getByLabel('E-posta').fill(email)
    await page.getByLabel('Şifre').fill('Medya333-Test-2026')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Hesap Oluştur' }).click()

    await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /Hoş geldiniz/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Hesap bilgileri' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
    await expect(page.getByText('Henüz siparişiniz yok.')).toBeVisible()
  })

  test('18 · müşteri fulfillment durumu TEKNİK ENUM göstermez', async ({ page }) => {
    const email = `ful6-${Date.now()}@ornek.test`
    await openService(page, 'instagram', 'takipci')
    await confirmTarget(page, '@medya333')
    await page.getByTestId('preset-500').click()

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
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })

    // Ödeme
    await page.getByTestId('start-payment').click()
    await expect(page).toHaveURL(/\/odeme\/test\//, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page.getByTestId('payment-success')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('link', { name: 'Siparişimi Görüntüle' }).click()
    const card = page.getByTestId('fulfillment-progress')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('fulfillment-status')).toContainText('Sıraya alındı')

    // ⚠️ İç enum ve operasyon bilgisi SIZMAZ
    const text = (await page.locator('body').innerText()).toUpperCase()
    for (const enumName of ['READY', 'PROCESSING', 'REVIEW_REQUIRED', 'OPERATOR']) {
      expect(text, `iç enum sızdı: ${enumName}`).not.toContain(enumName)
    }

    // ⭐ 365 gün garanti bilgisi müşteriye görünür
    await expect(page.getByTestId('guarantee-info')).toContainText('365 Gün Telafi Garantisi')
  })
})

// ===========================================================================
test.describe('19-20 · hata durumları ve erişilebilirlik', () => {
  test('19 · olmayan sipariş için yönlendirici mesaj (teknik detay yok)', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/siparis-takip')
    await page.getByLabel(/Sipariş numarası/i).fill('M333-ZZZZZZZZ')
    await page.getByLabel(/E-posta/i).fill('yok@ornek.test')
    await page.getByRole('button', { name: /Siparişi Görüntüle|Sorgula/ }).click()

    // ⚠️ Next'in route announcer'ı da role=alert taşır ve BOŞTUR; kendi
    // mesajımızı hedeflemek için içerik alanına kapsamlanır.
    const alert = page.locator('#icerik [role="alert"]').first()
    await expect(alert).toBeVisible({ timeout: 20_000 })
    const msg = await alert.innerText()
    expect(msg.length).toBeGreaterThan(15)
    expect(msg.toLowerCase()).not.toMatch(/prisma|sql|stack|undefined|null/)
  })

  test('19b · yardım sayfası açılır ve destek yolu gösterir', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/yardim')
    await expect(page.getByRole('heading', { level: 1, name: 'Yardım' })).toBeVisible()
    await expect(page.getByText(/şifrenizi istemeyiz/i)).toBeVisible()
    await expect(
      page.locator('#icerik').getByRole('link', { name: 'destek@medya333.com' }),
    ).toBeVisible()
  })

  test('20 · erişilebilirlik: başlık hiyerarşisi, focus, atlama bağlantısı', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')

    // Tek h1
    expect(await page.locator('h1').count()).toBe(1)

    // Boşa işaret eden aria-labelledby yok
    const dangling = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-labelledby]')]
        .map((el) => el.getAttribute('aria-labelledby'))
        .filter((id) => id && !document.getElementById(id)),
    )
    expect(dangling).toEqual([])

    // İlk Tab → "İçeriğe geç"
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toContainText('İçeriğe geç')

    // Focus ring görünür
    const outline = await page.evaluate(() => {
      const el = document.activeElement
      return el ? getComputedStyle(el).outlineWidth : '0px'
    })
    expect(outline).not.toBe('0px')

    // Yatay taşma yok
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('20b · SEO başlığı ve açıklaması Türkçe', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')
    await expect(page).toHaveTitle(/Medya 333 \| Sosyal Medya Hizmetleri/)
    const desc = await page.locator('meta[name="description"]').getAttribute('content')
    expect(desc).toContain('gerçek kullanıcılarla')
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
    expect(ogTitle).toContain('Medya 333')
  })
})
