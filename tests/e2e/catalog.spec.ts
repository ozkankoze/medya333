import { expect, test, type Page } from '@playwright/test'

/**
 * E2E — FAZ 5 GERÇEK KATALOG (brief'teki 15 adım)
 *
 *   1. Admin girişi
 *   2. Katalog ekranı açılır
 *   3. Platform / hizmet / varyantlar görünür
 *   4. Fiyat düzenlenir
 *   5. Simülatör ile fiyat kontrolü
 *   6. Müşteri tarafına geçilir
 *   7. Instagram seçilir
 *   8. Hizmet seçilir
 *   9. Varyant / paket seçilir
 *  10. Miktar / paket seçilir
 *  11. Fiyat doğrulanır
 *  12. Sipariş özetine ilerlenir
 *  13. Sunucu fiyatının AYNI olduğu doğrulanır
 *  14. Bir hizmet pasifleştirilir
 *  15. Müşteri tarafında seçilemediği doğrulanır
 */

const ADMIN_EMAIL = 'admin@medya333.local'
const ADMIN_PASSWORD = 'Medya333-Admin-2026'

let ipSeq = 0
async function isolateClient(page: Page) {
  ipSeq++
  const octet = test.info().project.name === 'mobile' ? 6 : 5
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.10${octet}.${ipSeq % 250}` })
}

/** Panelde demo platformlar da listelendiği için Instagram bölümü hedeflenir. */
function ig(page: Page) {
  return page.getByTestId('platform-instagram')
}

async function loginAsAdmin(page: Page) {
  await isolateClient(page)
  await page.goto('/giris')
  await page.getByLabel('E-posta').fill(ADMIN_EMAIL)
  await page.getByLabel('Şifre').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Giriş Yap' }).click()
  await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })
}

/**
 * ⚠️ Katalog PAYLAŞILAN durumdur ve bir önceki koşum yarıda kalmış olabilir.
 *
 * Yalnızca BU testlerin dokunduğu hizmet geri açılır. "Bütün pasifleri aç"
 * demek olmaz: demo katalog bilerek pasiftir, onu diriltmek gerçek katalogu
 * bozar.
 */
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginAsAdmin(page)
  await page.goto('/yonetim/katalog')
  const reactivate = ig(page).getByTestId('service-instagram-kaydetme').getByRole('button', {
    name: /aktifleştir/i,
  })
  if ((await reactivate.count()) > 0) {
    await reactivate.click()
    await expect(
      ig(page).getByTestId('service-instagram-kaydetme').getByRole('button', { name: /pasifleştir/i }),
    ).toBeVisible({ timeout: 15_000 })
  }
  await ctx.close()
})

test.describe('gerçek katalog', () => {
  test('1-5 · admin katalog ekranı, fiyat düzenleme ve simülatör', async ({ page }) => {
    // Giriş + 2 sayfa + 3 yazma turu: mobil projede 60 sn dar kalıyor.
    test.setTimeout(150_000)
    await loginAsAdmin(page)

    // --- 2. Katalog ekranı ---------------------------------------------------
    await page.goto('/yonetim/katalog')
    await expect(page.getByRole('heading', { name: 'Katalog' })).toBeVisible()

    // --- 3. Platform / hizmet / varyant --------------------------------------
    await expect(page.getByTestId('platform-instagram')).toBeVisible()
    // ⚠️ Faz 5.1: 4 platform · 22 hizmet · 29 varyant · 199 fiyat noktası
    await expect(page.getByTestId('catalog-counts')).toContainText('199 fiyat noktası')
    for (const slug of [
      'takipci',
      'begeni',
      'goruntulenme',
      'yorum',
      'kaydetme',
      'paylasim',
      'kesfet-paketi',
      'aylik-begeni-yorum-paketi',
    ]) {
      await expect(ig(page).getByTestId(`service-instagram-${slug}`)).toBeVisible()
    }
    // Faz 5.1'de aktifleşen platformlar panelde de görünür
    for (const slug of ['youtube', 'facebook', 'tiktok']) {
      await expect(page.getByTestId(`platform-${slug}`)).toBeVisible()
    }
    // ⚠️ Gerçek katalogda yeri olmayan platformlar PASİF kalır
    await expect(page.getByTestId('platform-telegram')).toContainText('Pasif')

    const publicCatalog = await (await page.request.get('/api/v1/catalog/snapshot')).json()
    expect(publicCatalog.platforms).toHaveLength(4)

    await ig(page).getByTestId('variant-instagram-takipci-turk').click()
    await expect(page.getByTestId('variant-title')).toContainText('Türk Takipçi')
    await expect(page.getByTestId('pricing-report')).toContainText('Fiyat tablosu sağlam')
    await expect(page.getByTestId('stored-price-1000')).toContainText('1.349,90')

    // --- 4. Fiyat düzenleme (sonra geri alınır) ------------------------------
    await page.getByTestId('price-input-500').fill('750,50')
    await page.getByTestId('save-price-500').click()
    await expect(page.getByTestId('stored-price-500')).toContainText('750,50', { timeout: 15_000 })
    // Denetim kaydı: kim, ne zaman, eski → yeni
    await expect(page.getByTestId('catalog-audit')).toContainText('pricing_rule.update')
    await expect(page.getByTestId('catalog-audit')).toContainText(ADMIN_EMAIL)

    // Gerçek fiyatı geri koy
    await page.getByTestId('price-input-500').fill('699,90')
    await page.getByTestId('save-price-500').click()
    await expect(page.getByTestId('stored-price-500')).toContainText('699,90', { timeout: 15_000 })

    // --- 5. Simülatör --------------------------------------------------------
    await page.getByTestId('simulator-input').fill('500, 1000, 7342')
    await page.getByTestId('simulator-run').click()
    await expect(page.getByTestId('sim-500')).toContainText('699,90', { timeout: 15_000 })
    await expect(page.getByTestId('sim-1000')).toContainText('1.349,90')
    // ⚠️ Listede olmayan miktar simülatörde de reddedilir
    await expect(page.getByTestId('sim-7342')).toContainText('hazır paket')
  })

  test('6-13 · müşteri akışı ve SUNUCU fiyatının aynılığı', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')

    // --- 7. Instagram --------------------------------------------------------
    await page.getByRole('button', { name: /Instagram/ }).first().click()

    // --- 8. Hizmet -----------------------------------------------------------
    await page.getByRole('button', { name: /Takipçi/ }).first().click()

    // --- 9. Varyant ----------------------------------------------------------
    await page.getByRole('button', { name: /Türk Takipçi/ }).click()

    await page.getByPlaceholder(/@medya333/).fill('@medya333')
    const targetCheckbox = page.getByRole('checkbox').first()
    await expect(targetCheckbox).toBeVisible({ timeout: 15_000 })
    await targetCheckbox.check()

    // --- 10-11. Hazır miktar ve fiyat ---------------------------------------
    await expect(page.getByTestId('preset-500')).toContainText('699,90')
    await page.getByTestId('preset-1000').click()

    const aside = page.locator('aside')
    await expect(aside.getByText(/₺/).last()).toHaveText(/1\.349,90\s*₺/)

    // --- 12. Sipariş özeti ---------------------------------------------------
    const section = page.getByRole('region', { name: 'Sipariş özeti' })
    await expect(section).toContainText('1.000 takipçi')
    await expect(section).toContainText('Türk Takipçi')

    // --- 13. SUNUCU fiyatı aynı ---------------------------------------------
    const catalog = await (await page.request.get('/api/v1/catalog/snapshot')).json()
    const takipci = catalog.platforms[0].services.find((s: { slug: string }) => s.slug === 'takipci')
    const turk = takipci.variants.find((v: { slug: string }) => v.slug === 'turk')
    const quote = await page.request.post('/api/v1/pricing/quote', {
      data: { serviceVariantId: turk.id, quantity: 1000 },
    })
    expect((await quote.json()).total).toBe(134_990)
  })

  test('sabit paket kartı içeriğiyle birlikte gösterilir', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')
    await page.getByRole('button', { name: /Instagram/ }).first().click()
    await page.getByRole('button', { name: /Keşfet Paketi/ }).first().click()
    await page.getByPlaceholder(/instagram\.com\/p\//).fill('https://instagram.com/p/CxYzAbCdEfG/')

    const targetCheckbox = page.getByRole('checkbox').first()
    await expect(targetCheckbox).toBeVisible({ timeout: 15_000 })
    await targetCheckbox.check()

    const card = page.getByTestId('package-card')
    await expect(card).toContainText('Instagram Keşfet Paketi')
    await expect(page.getByTestId('package-price')).toContainText('1.000,00')
    await expect(card).toContainText('500 - 1.500 Türk Beğeni')
    await expect(card).toContainText('10.000 - 25.000 Görüntülenme')
    // Paket içindekiler AYRI fiyatlandırılmaz
    await expect(page.locator('aside').getByText(/₺/).last()).toHaveText(/1\.000,00\s*₺/)
  })

  test('14-15 · pasifleştirilen hizmet müşteri tarafında SEÇİLEMEZ', async ({ page, context }) => {
    // İki tarayıcı bağlamı + admin girişi + 3 sayfa yüklemesi: varsayılan
    // 60 sn'lik test bütçesi bu senaryo için dar.
    test.setTimeout(150_000)

    // Müşteri tarafında hizmet başta görünür
    await isolateClient(page)
    await page.goto('/')
    await page.getByRole('button', { name: /Instagram/ }).first().click()
    await expect(page.getByRole('button', { name: /Kaydetme/ }).first()).toBeVisible()

    const adminCtx = await context.browser()!.newContext()
    const admin = await adminCtx.newPage()
    await loginAsAdmin(admin)
    await admin.goto('/yonetim/katalog')
    const service = ig(admin).getByTestId('service-instagram-kaydetme')

    try {
      await service.getByRole('button', { name: /pasifleştir/i }).click()
      await expect(service.getByRole('button', { name: /aktifleştir/i })).toBeVisible({
        timeout: 15_000,
      })

      // --- 15. Müşteri tarafında YOK ----------------------------------------
      await page.goto('/')
      await page.getByRole('button', { name: /Instagram/ }).first().click()
      await expect(page.getByRole('button', { name: /Kaydetme/ })).toHaveCount(0)
    } finally {
      /**
       * ⚠️ Katalog PAYLAŞILAN durumdur. Test yarıda kalsa bile gerçek katalog
       * eski hâline dönmeli; aksi halde sonraki koşumlar eksik katalogla
       * başlar ve alakasız testler kırılır.
       */
      await service
        .getByRole('button', { name: /aktifleştir/i })
        .click()
        .catch(() => undefined)
      await expect(service.getByRole('button', { name: /pasifleştir/i })).toBeVisible({
        timeout: 15_000,
      })
      await adminCtx.close()
    }
  })

  /**
   * ⭐ FAZ 5.1 — YENİ PLATFORMLAR
   */
  test('YouTube müşteri akışı: hazır abone paketleri ve gerçek fiyat', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/')
    await page.getByRole('button', { name: /YouTube/ }).first().click()
    await page.getByRole('button', { name: /Abone/ }).first().click()
    await page.getByPlaceholder(/@medya333/).fill('@medya333')

    const targetCheckbox = page.getByRole('checkbox').first()
    await expect(targetCheckbox).toBeVisible({ timeout: 15_000 })
    await targetCheckbox.check()

    // Varsayılan varyant: Türk Abone → 100 / 250 / 500
    await expect(page.getByTestId('preset-100')).toContainText('1.000,00')
    await expect(page.getByTestId('preset-250')).toContainText('2.250,00')
    await expect(page.getByTestId('preset-500')).toContainText('4.000,00')
    // ⚠️ Maksimum 500: daha büyük bir paket YOK
    await expect(page.getByTestId('preset-1000')).toHaveCount(0)

    await page.getByTestId('preset-250').click()
    await expect(page.locator('aside').getByText(/₺/).last()).toHaveText(/2\.250,00\s*₺/)
    await expect(page.getByRole('region', { name: 'Sipariş özeti' })).toContainText('250 abone')
  })

  test('TikTok fiyatı Instagram\'ın %125\'idir (sunucu doğrular)', async ({ page }) => {
    await isolateClient(page)
    const catalog = await (await page.request.get('/api/v1/catalog/snapshot')).json()
    const variantOf = (platform: string, service: string, variant: string) =>
      catalog.platforms
        .find((p: { slug: string }) => p.slug === platform)
        .services.find((s: { slug: string }) => s.slug === service)
        .variants.find((v: { slug: string }) => v.slug === variant)

    const ig = variantOf('instagram', 'begeni', 'turk')
    const tt = variantOf('tiktok', 'begeni', 'turk')

    const quote = async (id: string, quantity: number) =>
      (await (await page.request.post('/api/v1/pricing/quote', {
        data: { serviceVariantId: id, quantity },
      })).json()).total

    expect(await quote(ig.id, 100)).toBe(4_990) // 49,90 ₺
    expect(await quote(tt.id, 100)).toBe(6_238) // 62,38 ₺
  })

  test('⚠️ katalog yönetimi MÜŞTERİ rolüne kapalı', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/yonetim/katalog')
    await expect(page).toHaveURL(/\/giris/)
  })
})
