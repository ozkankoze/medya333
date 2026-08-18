import { expect, test, type Page } from '@playwright/test'

/**
 * E2E — FAZ 4 FULFILLMENT (brief'teki 13 adım)
 *
 *   1. Mock ödeme başarılı
 *   2. Sipariş PAID olur
 *   3. Sipariş otomatik onaylanır
 *   4. Fulfillment otomatik READY olur
 *   5. Fulfillment PROCESSING OLMAZ
 *   6. Fulfillment STARTED OLMAZ
 *   7. Admin/Operator fulfillment'ı görür
 *   8. Operator atar
 *   9. Operator "İşleme Başlat" der
 *  10. İlerleme girer
 *  11. Müşteri ilerlemeyi görür
 *  12. Operator manuel "Tamamla" der
 *  13. Müşteri COMPLETED görür
 *
 * ⚠️ Ayrıca kilitlenen kurallar:
 *   • ödeme yapılmamış sipariş → fulfillment yok
 *   • teslim dolsa bile otomatik COMPLETED yok
 */

const ADMIN_EMAIL = 'admin@medya333.local'
const ADMIN_PASSWORD = 'Medya333-Admin-2026'

let ipSeq = 0
async function isolateClient(page: Page) {
  ipSeq++
  const octet = test.info().project.name === 'mobile' ? 4 : 3
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.10${octet}.${ipSeq % 250}` })
}

/** Sipariş oluşturur, ÖDEMEZ. Sipariş numarasını döndürür. */
async function createOrder(page: Page, email: string): Promise<string> {
  await isolateClient(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Instagram/ }).first().click()
  await page.getByRole('button', { name: /Takipçi/ }).first().click()
  await page.getByPlaceholder(/@medya333/).fill('@medya333')

  const targetCheckbox = page.getByRole('checkbox').first()
  await expect(targetCheckbox).toBeVisible({ timeout: 15_000 })
  await targetCheckbox.check()

  await page.getByTestId('preset-1000').click()
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

  await page.getByRole('button', { name: 'Siparişi Oluştur' }).first().click()
  await expect(page.getByTestId('order-no')).toBeVisible({ timeout: 20_000 })
  return page.getByTestId('order-no').innerText()
}

/** Ödemeyi mock sağlayıcı üzerinden tamamlar (imzalı bildirim). */
async function payOrder(page: Page) {
  await page.getByTestId('start-payment').click()
  await expect(page).toHaveURL(/\/odeme\/test\//, { timeout: 20_000 })
  await page.getByTestId('mock-pay-success').click()
  await expect(page.getByTestId('payment-success')).toBeVisible({ timeout: 30_000 })
}

async function loginAsAdmin(page: Page) {
  await isolateClient(page)
  await page.goto('/giris')
  await page.getByLabel('E-posta').fill(ADMIN_EMAIL)
  await page.getByLabel('Şifre').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Giriş Yap' }).click()
  await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })
}

test.describe('fulfillment operasyonu', () => {
  test('uçtan uca: ödeme → otomatik READY → manuel start/progress/complete', async ({
    page,
    context,
  }) => {
    const email = `ful-${Date.now()}@ornek.test`

    // --- 1-2. Ödeme ve PAID ------------------------------------------------
    const orderNo = await createOrder(page, email)
    await payOrder(page)

    // --- 3-4. Otomatik onay + READY (müşteri tarafından görünen hâli) ------
    await page.getByRole('link', { name: 'Siparişimi Görüntüle' }).click()
    await expect(page.getByTestId('fulfillment-progress')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('fulfillment-status')).toContainText('Sıraya alındı')
    await expect(page.getByTestId('fulfillment-progress')).toContainText(
      'Siparişiniz onaylandı ve işlem sırasına alındı.',
    )

    // --- 5-6. PROCESSING/STARTED DEĞİL -------------------------------------
    await expect(page.getByTestId('progress-percent')).toContainText('%0')
    await expect(page.getByTestId('fulfillment-progress')).not.toContainText('İşleminiz başladı.')

    // --- 7. Operatör kuyruğu görür -----------------------------------------
    const adminCtx = await context.browser()!.newContext()
    const admin = await adminCtx.newPage()
    await loginAsAdmin(admin)
    await admin.goto('/yonetim/fulfillment')

    await expect(admin.getByRole('heading', { name: 'Operasyon' })).toBeVisible()
    const row = admin.getByRole('link', { name: orderNo })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()

    await expect(admin.getByTestId('detail-order-no')).toContainText(orderNo)
    await expect(admin.getByTestId('detail-percent')).toContainText('%0')
    await expect(admin.getByTestId('detail-assignee')).toContainText('Atanmamış')

    // --- 8. Atama -----------------------------------------------------------
    await admin.getByTestId('assign-submit').click()
    await expect(admin.getByTestId('detail-assignee')).not.toContainText('Atanmamış', {
      timeout: 15_000,
    })

    // --- 9. MANUEL "İşleme Başlat" -----------------------------------------
    await expect(admin.getByTestId('start-fulfillment')).toBeVisible()
    await admin.getByTestId('initial-metric').fill('2340')
    await admin.getByTestId('start-fulfillment').click()
    await expect(admin.getByTestId('fulfillment-badge')).toContainText('Başladı', {
      timeout: 15_000,
    })

    // --- 10. İlerleme girer -------------------------------------------------
    await admin.getByTestId('current-metric').fill('2840')
    await admin.getByTestId('save-progress').click()
    await expect(admin.getByTestId('detail-percent')).toContainText('%50', { timeout: 15_000 })

    // --- 11. Müşteri ilerlemeyi görür --------------------------------------
    await page.reload()
    await expect(page.getByTestId('progress-percent')).toContainText('%50')
    await expect(page.getByTestId('progress-counts')).toContainText('500')
    await expect(page.getByTestId('fulfillment-progress')).toContainText('İşleminiz devam ediyor.')
    // ⚠️ İç bilgi sızmıyor
    await expect(page.getByText(ADMIN_EMAIL)).toHaveCount(0)

    // --- 12. Teslim tamamlansa bile OTOMATİK COMPLETED YOK -----------------
    await admin.getByTestId('current-metric').fill('3340')
    await admin.getByTestId('save-progress').click()
    await expect(admin.getByTestId('detail-percent')).toContainText('%100', { timeout: 15_000 })
    // ⚠️ HÂLÂ tamamlanmadı
    await expect(admin.getByTestId('fulfillment-badge')).not.toContainText('Tamamlandı')

    await page.reload()
    await expect(page.getByTestId('progress-percent')).toContainText('%100')
    await expect(page.getByTestId('fulfillment-progress')).not.toContainText(
      'İşleminiz tamamlandı.',
    )

    // --- 12b. MANUEL "Tamamla" ---------------------------------------------
    await admin.getByTestId('complete-fulfillment').click()
    await expect(admin.getByTestId('fulfillment-badge')).toContainText('Tamamlandı', {
      timeout: 15_000,
    })

    // --- 13. Müşteri COMPLETED görür ---------------------------------------
    await page.reload()
    await expect(page.getByTestId('fulfillment-status')).toContainText('Tamamlandı')
    await expect(page.getByTestId('fulfillment-progress')).toContainText('İşleminiz tamamlandı.')

    await adminCtx.close()
  })

  test('⚠️ ÖDEME YAPILMAMIŞ sipariş kuyrukta GÖRÜNMEZ', async ({ page, context }) => {
    const orderNo = await createOrder(page, `odenmemis-${Date.now()}@ornek.test`)

    // Müşteri tarafında fulfillment kartı yok
    await page.goto(`/siparis-takip?o=${orderNo}`)
    await expect(page.getByTestId('fulfillment-progress')).toHaveCount(0)

    const adminCtx = await context.browser()!.newContext()
    const admin = await adminCtx.newPage()
    await loginAsAdmin(admin)
    await admin.goto('/yonetim/fulfillment?bucket=all')

    await expect(admin.getByRole('link', { name: orderNo })).toHaveCount(0)
    await adminCtx.close()
  })

  test('⚠️ operasyon paneli MÜŞTERİ rolüne KAPALI', async ({ page }) => {
    const email = `musteri-${Date.now()}@ornek.test`

    await isolateClient(page)
    await page.goto('/kayit')
    await page.getByLabel('E-posta').fill(email)
    await page.getByLabel('Şifre').fill('Medya333-Test-2026')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Hesap Oluştur' }).click()
    await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })

    // CUSTOMER paneli açamaz
    await page.goto('/yonetim/fulfillment')
    await expect(page).toHaveURL(/\/hesabim/, { timeout: 15_000 })
  })

  test('oturumsuz operasyon paneli girişe yönlendirir', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/yonetim/fulfillment')
    await expect(page).toHaveURL(/\/giris/)
  })

  test('kuyruk sayıları gerçek veriden gelir', async ({ page, context }) => {
    const email = `sayac-${Date.now()}@ornek.test`
    await createOrder(page, email)
    await payOrder(page)

    const adminCtx = await context.browser()!.newContext()
    const admin = await adminCtx.newPage()
    await loginAsAdmin(admin)
    await admin.goto('/yonetim/fulfillment')

    const newCount = await admin.getByTestId('count-new').innerText()
    expect(Number(newCount)).toBeGreaterThanOrEqual(1)

    await adminCtx.close()
  })
})
