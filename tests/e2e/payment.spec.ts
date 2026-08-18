import { expect, test, type Page } from '@playwright/test'

/**
 * E2E — ÖDEME AKIŞI (Faz 3)
 *
 * Sipariş → Ödemeye Geç → sağlayıcı sayfası → imzalı bildirim →
 * "Ödemeniz alındı".
 *
 * Sağlayıcı olarak `mock` kullanılır (gerçek merchant bilgisi yok). Ancak
 * ödeme yolu ATLANMAZ: test checkout sayfası, gerçek sağlayıcının yapacağı
 * gibi İMZALI bir sunucu bildirimi tetikler ve karar webhook işleyicisinde
 * verilir. Yani burada doğrulanan şey "buton çalışıyor mu" değil,
 * "sipariş yalnızca doğrulanmış bildirimle PAID oluyor mu".
 *
 * Doğrulanan kritik kurallar:
 *   • Ödeme öncesi "Ödeme bekleniyor" görünür, ödeme sonrası "Ödemeniz alındı"
 *   • Tarayıcı success URL'ine dönmek TEK BAŞINA başarı göstermez
 *   • Başarısız ödemede sipariş SİLİNMEZ ve tekrar denenebilir
 */

let ipSeq = 0
/**
 * Ödeme başlatma IP başına 10/dk ile sınırlıdır — bu KASITLIDIR.
 * Her teste ayrı istemci IP'si verilir. `desktop` ve `mobile` projeleri
 * paralel koştuğu ve her biri kendi modül örneğini (dolayısıyla kendi
 * sayacını) taşıdığı için proje adı da adrese katılır; aksi halde iki proje
 * aynı kovayı paylaşıp birbirinin limitini tüketiyordu.
 */
async function isolateClient(page: Page) {
  ipSeq++
  const projectOctet = test.info().project.name === 'mobile' ? 2 : 1
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `198.51.10${projectOctet}.${ipSeq % 250}`,
  })
}

/** Sipariş oluşturur ve başarı ekranına gelir; sipariş numarasını döndürür. */
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

test.describe('ödeme akışı', () => {
  test('sipariş → ödeme → doğrulanmış bildirim → Ödemeniz alındı', async ({ page }) => {
    const orderNo = await createOrder(page, `odeme-${Date.now()}@ornek.test`)

    // Başarı ekranında ödeme bekleniyor uyarısı ve ödeme düğmesi var
    await expect(page.getByTestId('pending-payment-notice')).toContainText('Ödeme bekleniyor')
    await expect(page.getByTestId('start-payment')).toBeVisible()

    await page.getByTestId('start-payment').click()

    // Sağlayıcı (mock) ödeme sayfası
    await expect(page).toHaveURL(/\/odeme\/test\//, { timeout: 20_000 })
    await expect(page.getByText('TEST ORTAMI')).toBeVisible()

    // ⚠️ Buraya gelmek ödeme yapıldığı anlamına GELMEZ
    await page.getByTestId('mock-pay-success').click()

    // Sonuç sayfası: doğrulama tamamlanınca kesin ifade
    await expect(page).toHaveURL(new RegExp(`/odeme/sonuc/${orderNo}`), { timeout: 20_000 })
    await expect(page.getByTestId('payment-success')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Ödemeniz alındı')).toBeVisible()
    await expect(page.getByText('Ödeme Alındı')).toBeVisible()
  })

  test('ödeme sonrası sipariş sayfası PAID gösterir ve ödeme düğmesi KALKAR', async ({ page }) => {
    const orderNo = await createOrder(page, `paid-${Date.now()}@ornek.test`)
    await page.getByTestId('start-payment').click()
    await expect(page).toHaveURL(/\/odeme\/test\//, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page.getByTestId('payment-success')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('link', { name: 'Siparişimi Görüntüle' }).click()
    await expect(page.getByTestId('order-no')).toContainText(orderNo)
    // Artık ödeme beklemiyor
    await expect(page.getByTestId('pending-payment-notice')).toHaveCount(0)
    await expect(page.getByTestId('start-payment')).toHaveCount(0)
  })

  test('başarısız ödeme: sipariş SİLİNMEZ, tekrar denenebilir', async ({ page }) => {
    const orderNo = await createOrder(page, `fail-${Date.now()}@ornek.test`)
    await page.getByTestId('start-payment').click()
    await expect(page).toHaveURL(/\/odeme\/test\//, { timeout: 20_000 })

    await page.getByTestId('mock-pay-failure').click()

    await expect(page.getByTestId('payment-failed')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Siparişiniz.*silinmedi/)).toBeVisible()

    // Tekrar öde düğmesi yeni bir deneme başlatır
    await expect(page.getByTestId('retry-payment')).toBeVisible()
    await page.getByTestId('retry-payment').click()
    await expect(page).toHaveURL(/\/odeme\/test\//, { timeout: 20_000 })

    // İkinci deneme başarılı olabilir
    await page.getByTestId('mock-pay-success').click()
    await expect(page.getByTestId('payment-success')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(orderNo)).toBeVisible()
  })

  test('⚠️ tarayıcı success URL\'ine ELLE gitmek ödemeyi başarılı YAPMAZ', async ({ page }) => {
    const orderNo = await createOrder(page, `sahte-${Date.now()}@ornek.test`)

    // Sipariş ödenmemişken doğrudan "başarılı" dönüş adresine gidiliyor
    await page.goto(`/odeme/sonuc/${orderNo}`)

    // Sunucu doğrulaması olmadığı için KESİN BAŞARI GÖSTERİLMEZ
    await expect(page.getByTestId('payment-success')).toHaveCount(0)
    await expect(page.getByText('Ödemeniz alındı')).toHaveCount(0)
  })

  test('ödeme sayfasına sahiplik olmadan erişilemez', async ({ page, context }) => {
    const orderNo = await createOrder(page, `gizli-${Date.now()}@ornek.test`)

    // Başka bir tarayıcı bağlamı: sipariş numarasını biliyor ama token'ı yok
    const other = await context.browser()!.newContext()
    const otherPage = await other.newPage()
    const res = await otherPage.request.post('/api/v1/payments/create', {
      headers: { 'idempotency-key': `x-${Date.now()}-abcdefghijklmn` },
      data: { orderNo },
    })
    expect(res.status()).toBe(404)
    await other.close()
  })

  test('doğrudan mock checkout adresine gitmek ödemeyi tamamlamaz', async ({ page }) => {
    await isolateClient(page)
    const res = await page.goto('/odeme/test/OLMAYANREFERANS')
    expect(res?.status()).toBe(404)
  })
})

test.describe('webhook ucu', () => {
  test('imzasız bildirim siparişi PAID YAPMAZ', async ({ page, request }) => {
    const orderNo = await createOrder(page, `webhook-${Date.now()}@ornek.test`)
    await page.getByTestId('start-payment').click()
    await expect(page).toHaveURL(/\/odeme\/test\//, { timeout: 20_000 })

    // Mock checkout URL'inden providerRef çıkarılır
    const ref = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)

    const res = await request.post('/api/v1/payments/webhooks/mock', {
      // Olay kimliği her koşumda benzersiz olmalı; aksi halde önceki
      // koşumdan kalan kayıt yüzünden DUPLICATE alınır ve imza yolu test edilmez.
      data: {
        providerRef: ref,
        status: 'success',
        amountMinor: 1,
        currency: 'TRY',
        eventId: `unsigned-${Date.now()}`,
      },
    })
    expect(res.headers()['x-webhook-outcome']).toBe('INVALID_SIGNATURE')

    // Sipariş hâlâ ödeme bekliyor
    await page.goto(`/odeme/sonuc/${orderNo}`)
    await expect(page.getByTestId('payment-success')).toHaveCount(0)
  })

  test('PayTR ucu düz "OK" döner', async ({ request }) => {
    const res = await request.post('/api/v1/payments/webhooks/paytr', {
      form: { merchant_oid: 'YOK', status: 'success', total_amount: '100', hash: 'yanlis' },
    })
    expect(res.status()).toBe(200)
    expect((await res.text()).trim()).toBe('OK')
  })

  test('webhook ucu oturum İSTEMEZ (GET sağlık yoklaması)', async ({ request }) => {
    for (const p of ['iyzico', 'paytr']) {
      const res = await request.get(`/api/v1/payments/webhooks/${p}`)
      expect(res.status()).toBe(200)
    }
  })
})
