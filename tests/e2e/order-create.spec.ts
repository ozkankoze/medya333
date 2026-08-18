import { expect, test, type Page } from '@playwright/test'

/**
 * E2E — SİPARİŞ OLUŞTURMA VE TAKİP (Faz 2)
 *
 * Uçtan uca gerçek akış: platform → hizmet → hedef → onay → miktar → özet →
 * müşteri bilgileri → 3 onay → SİPARİŞ OLUŞTUR → başarı ekranı → takip.
 *
 * Doğrulanan kritik kurallar:
 *   • Başarı ekranı "ÖDEME BEKLENİYOR" der; "işleme alındı" DEMEZ
 *   • Sipariş numarası gösterilir, iki CTA vardır
 *   • Takip bağlantısı çalışır; sipariş numarası TEK BAŞINA yetmez
 *   • Misafir takip sayfası orderNo + e-posta ister
 */

const EMAIL = `e2e-${Date.now()}@ornek.test`

let ipSeq = 0
/**
 * Sipariş oluşturma ucu IP başına 5/dk ile sınırlıdır — bu KASITLIDIR.
 * Paralel koşan testler tek IP'den geldiği için birbirini tetiklerdi;
 * her teste ayrı bir istemci IP'si verilir. (Üretimde bu başlığı ters
 * proxy yazar; uygulama onu tek başına güvenilir kabul etmez.)
 */
async function isolateClient(page: Page) {
  ipSeq++
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${ipSeq % 250}` })
}

async function goThroughWizard(page: Page, email: string) {
  await isolateClient(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Instagram/ }).first().click()
  await page.getByRole('button', { name: /Takipçi/ }).first().click()
  await page.getByPlaceholder(/@medya333/).fill('@medya333')

  const targetCheckbox = page.getByRole('checkbox').first()
  await expect(targetCheckbox).toBeVisible({ timeout: 15_000 })
  await targetCheckbox.check()

  await page.getByTestId('preset-1000').click()
  await expect(page.locator('#step-review')).toBeVisible()

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

test.describe('sipariş oluşturma', () => {
  test('uçtan uca sipariş oluşur ve ÖDEME BEKLENİYOR olarak gösterilir', async ({ page }) => {
    await goThroughWizard(page, EMAIL)

    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()

    // --- Başarı ekranı ---
    await expect(page.getByRole('heading', { name: 'Siparişiniz oluşturuldu' })).toBeVisible({
      timeout: 20_000,
    })

    const orderNo = await page.getByTestId('order-no').innerText()
    expect(orderNo).toMatch(/^M333-[0-9A-HJKMNP-TV-Z]{8}$/)

    // ⚠️ Ödeme bekleniyor UYARISI AÇIKÇA vardır
    const notice = page.getByTestId('pending-payment-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Ödeme bekleniyor')
    await expect(notice).toContainText('ödeme tamamlanana kadar işleme alınmaz')

    // "işleme alındı / hazırlanıyor" gibi yanıltıcı ifade YOK
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('Hazırlanıyor')
    expect(body).not.toContain('İşlem Başladı')

    // İki CTA
    await expect(page.getByTestId('cta-track')).toBeVisible()
    await expect(page.getByTestId('cta-new-order')).toBeVisible()
  })

  test('takip CTA\'sı sipariş detayına götürür', async ({ page }) => {
    await goThroughWizard(page, `takip-${EMAIL}`)
    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })

    const orderNo = await page.getByTestId('order-no').innerText()
    await page.getByTestId('cta-track').click()

    await expect(page).toHaveURL(new RegExp(`/siparisler/${orderNo}\\?t=`))
    await expect(page.getByTestId('order-no')).toContainText(orderNo)
    await expect(page.getByTestId('pending-payment-notice')).toBeVisible()
  })

  test('🔒 sipariş numarası TEK BAŞINA erişim sağlamaz', async ({ page }) => {
    await goThroughWizard(page, `gizli-${EMAIL}`)
    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })
    const orderNo = await page.getByTestId('order-no').innerText()

    // Token'sız, oturumsuz erişim → 404
    const res = await page.goto(`/siparisler/${orderNo}`)
    expect(res?.status()).toBe(404)
  })

  test('başarı ekranı KENDİ sayfasındadır — pazarlama hero\'su üstte kalmaz', async ({ page }) => {
    await goThroughWizard(page, `sayfa-${EMAIL}`)
    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()

    await expect(page).toHaveURL(/\/siparis-olusturuldu$/, { timeout: 20_000 })
    // Hero ve sihirbaz artık ekranda DEĞİL
    await expect(page.getByText('Social Media Growth, Simplified.')).toHaveCount(0)
    await expect(page.locator('#step-platform')).toHaveCount(0)
    // Başlık ilk ekranda görünür (kaydırma gerektirmez)
    const box = (await page.getByRole('heading', { name: 'Siparişiniz oluşturuldu' }).boundingBox())!
    expect(box.y).toBeLessThan(page.viewportSize()!.height)
  })

  test('🔒 takip token\'ı URL\'e ve tarayıcı geçmişine YAZILMAZ', async ({ page }) => {
    await goThroughWizard(page, `token-${EMAIL}`)
    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })

    expect(page.url()).not.toContain('t=')
    expect(page.url()).toMatch(/\/siparis-olusturuldu$/)
  })

  test('"Yeni Sipariş Oluştur" sihirbaza döner', async ({ page }) => {
    await goThroughWizard(page, `yeni-${EMAIL}`)
    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
    await expect(page.getByTestId('cta-new-order')).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('cta-new-order').click()
    await expect(page.locator('#step-platform')).toBeVisible()
    await expect(page.locator('#step-service')).toHaveCount(0)
  })

  test('doğrudan /siparis-olusturuldu açılırsa takip sayfasına yönlendirir', async ({ page }) => {
    await page.goto('/siparis-olusturuldu')
    await expect(page).toHaveURL(/\/siparis-takip/)
  })

  test('onaylar işaretlenmeden sipariş oluşturulamaz', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')
    await page.getByRole('button', { name: /Instagram/ }).first().click()
    await page.getByRole('button', { name: /Takipçi/ }).first().click()
    await page.getByPlaceholder(/@medya333/).fill('@medya333')
    const targetCheckbox = page.getByRole('checkbox').first()
    await expect(targetCheckbox).toBeVisible({ timeout: 15_000 })
    await targetCheckbox.check()
    await page.getByTestId('preset-1000').click()

    await page.getByLabel('Ad', { exact: true }).fill('Ayşe')
    await page.getByLabel('Soyad', { exact: true }).fill('Yılmaz')
    await page.getByLabel('E-posta', { exact: true }).fill('onaysiz@ornek.test')

    // Onaylar boş → CTA pasif
    await expect(page.getByRole('button', { name: 'Siparişi Oluştur' }).first()).toBeDisabled()

    // Sadece ikisini işaretle → hâlâ pasif
    await page.getByRole('checkbox', { name: /Hizmet \/ Satış Sözleşmesi/ }).check()
    await page.getByRole('checkbox', { name: /İptal ve İade Koşulları/ }).check()
    await expect(page.getByRole('button', { name: 'Siparişi Oluştur' }).first()).toBeDisabled()

    await page.getByRole('checkbox', { name: /KVKK \/ Gizlilik Metni/ }).check()
    await expect(page.getByRole('button', { name: 'Siparişi Oluştur' }).first()).toBeEnabled()
  })

  test('yasal metin bağlantıları yeni sekmede açılır ve çalışır', async ({ page, context }) => {
    await goThroughWizard(page, `yasal-${EMAIL}`)

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page
        .getByRole('group', { name: 'Onaylar' })
        .getByRole('link', { name: 'Hizmet / Satış Sözleşmesi' })
        .click(),
    ])
    await popup.waitForLoadState()
    expect(new URL(popup.url()).pathname).toBe('/satis-sozlesmesi')
    await popup.close()
  })
})

// ---------------------------------------------------------------------------

test.describe('misafir sipariş takibi', () => {
  test('sayfa açılır ve İKİ alan birden ister', async ({ page }) => {
    await page.goto('/siparis-takip')
    await expect(page.getByRole('heading', { name: 'Sipariş Takibi' })).toBeVisible()
    await expect(page.getByLabel('Sipariş numarası')).toBeVisible()
    await expect(page.getByLabel('E-posta')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Siparişimi Sorgula' })).toBeDisabled()
  })

  test('doğru orderNo + e-posta ile sipariş görüntülenir', async ({ page }) => {
    const email = `takipform-${Date.now()}@ornek.test`
    await goThroughWizard(page, email)
    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })
    const orderNo = await page.getByTestId('order-no').innerText()

    await page.goto('/siparis-takip')
    await page.getByLabel('Sipariş numarası').fill(orderNo)
    await page.getByLabel('E-posta').fill(email)
    await page.getByRole('button', { name: 'Siparişimi Sorgula' }).click()

    await expect(page.getByTestId('order-no')).toContainText(orderNo)
    await expect(page.getByTestId('pending-payment-notice')).toBeVisible()
  })

  test('🔒 yanlış e-posta ile sipariş GÖRÜNTÜLENMEZ', async ({ page }) => {
    const email = `yanlis-${Date.now()}@ornek.test`
    await goThroughWizard(page, email)
    await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
    await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })
    const orderNo = await page.getByTestId('order-no').innerText()

    await page.goto('/siparis-takip')
    await page.getByLabel('Sipariş numarası').fill(orderNo)
    await page.getByLabel('E-posta').fill('baskasi@ornek.test')
    await page.getByRole('button', { name: 'Siparişimi Sorgula' }).click()

    await expect(page.getByText('Sipariş bulunamadı. Sipariş numarası ve e-posta adresini kontrol edin.')).toBeVisible()
    await expect(page.getByTestId('pending-payment-notice')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------

test.describe('hesap sayfaları', () => {
  test('/hesabim oturumsuz girişe yönlendirir', async ({ page }) => {
    await page.goto('/hesabim')
    await expect(page).toHaveURL(/\/giris/)
  })

  test('giriş ve kayıt sayfaları açılır', async ({ page }) => {
    await page.goto('/giris')
    await expect(page.getByRole('heading', { name: 'Giriş yapın' })).toBeVisible()

    await page.goto('/kayit')
    await expect(page.getByRole('heading', { name: 'Hesap oluşturun' })).toBeVisible()
    await expect(
      page.getByText(/Misafirken verdiğiniz siparişler otomatik olarak hesabınıza bağlanmaz/),
    ).toBeVisible()
  })
})

// ---------------------------------------------------------------------------

test.describe('kayıt ve giriş', () => {
  test('hesap açılır, giriş yapılır ve VERİTABANI OTURUMU kurulur', async ({ page }) => {
    const email = `hesap-${Date.now()}@ornek.test`

    await isolateClient(page)
    await page.goto('/kayit')
    await page.getByLabel('E-posta').fill(email)
    await page.getByLabel('Şifre').fill('Medya333-Test-2026')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Hesap Oluştur' }).click()

    // Kayıt sonrası otomatik giriş → hesabım
    await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Siparişlerim' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()

    // Oturum çerezi HttpOnly ve JWT DEĞİL (veritabanı oturum token'ı)
    const cookies = await page.context().cookies()
    const session = cookies.find((c) => c.name.includes('medya333.session'))
    expect(session).toBeTruthy()
    expect(session!.httpOnly).toBe(true)
    expect(session!.value.split('.').length).toBeLessThan(3) // JWT üç parçalıdır

    await expect(page.getByText('Henüz siparişiniz yok.')).toBeVisible()
  })

  test('yanlış şifre ile giriş reddedilir ve mesaj bilgi sızdırmaz', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/giris')
    await page.getByLabel('E-posta').fill('olmayan-kullanici@ornek.test')
    await page.getByLabel('Şifre').fill('YanlisSifre-123456')
    await page.getByRole('button', { name: 'Giriş Yap' }).click()

    await expect(page.getByText('E-posta veya şifre hatalı.')).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/giris/)
  })
})
