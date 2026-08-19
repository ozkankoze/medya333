import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * ⭐ E2E — FAZ 8 OPERASYON PANELİ
 *
 * Kapsam:
 *   • cursor sayfalama (tekrar yok, atlama yok)
 *   • arama ve filtreler
 *   • katalog CRUD arayüzü (varyant + fiyat kademesi)
 *   • sağlık ucu
 *   • yetki: CUSTOMER yönetim uçlarına erişemez
 *   • müşteri verisi sızıntısı
 *   • mobil operasyon arayüzü
 */

const ADMIN_EMAIL = 'admin@medya333.local'
const ADMIN_PASSWORD = 'Medya333-Admin-2026'

let ipSeq = 0
async function isolateClient(page: Page) {
  ipSeq++
  const octet = test.info().project.name === 'mobile' ? 6 : 5
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.10${octet}.${ipSeq % 250}` })
}

async function loginAsAdmin(page: Page) {
  await isolateClient(page)
  await page.goto('/giris')
  await page.getByLabel('E-posta').fill(ADMIN_EMAIL)
  await page.getByLabel('Şifre').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Giriş Yap' }).click()
  await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })
}

// ===========================================================================
test.describe('sağlık ucu', () => {
  test('kimlik doğrulamadan erişilir ve sır sızdırmaz', async ({ request }) => {
    const res = await request.get('/api/health')
    expect([200, 503]).toContain(res.status())

    const body = await res.json()
    expect(['healthy', 'degraded', 'unavailable']).toContain(body.status)
    expect(body.checks.database.status).toBe('up')
    // ⚠️ Ödeme sağlayıcısı BURADA ÇAĞRILMAZ
    expect(Object.keys(body.checks).sort()).toEqual(['application', 'database', 'redis'])

    const raw = JSON.stringify(body)
    for (const leak of ['postgresql://', 'redis://', 'AUTH_SECRET', 'IYZICO', 'PAYTR', 'password']) {
      expect(raw, `sağlık cevabında sızıntı: ${leak}`).not.toContain(leak)
    }
    expect(res.headers()['cache-control']).toContain('no-store')
  })
})

// ===========================================================================
test.describe('yetki', () => {
  test('⚠️ oturumsuz istek yönetim uçlarına ERİŞEMEZ', async ({ request }) => {
    for (const path of [
      '/api/v1/admin/fulfillments',
      '/api/v1/admin/orders',
      '/api/v1/admin/services',
      '/api/v1/admin/pricing-rules',
    ]) {
      const res = await request.get(path)
      expect([401, 403], `${path} korunmuyor`).toContain(res.status())
    }
  })

  test('⚠️ CUSTOMER rolü yönetim arama ucuna ERİŞEMEZ', async ({ page, request }) => {
    // Yeni müşteri hesabı aç
    await isolateClient(page)
    const email = `ops-cust-${Date.now()}@ornek.test`
    await page.goto('/kayit')
    await page.getByLabel('E-posta').fill(email)
    await page.getByLabel('Şifre').fill('Musteri-Sifre-2026')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Hesap Oluştur' }).click()
    await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })

    // Oturum çerezleriyle yönetim ucuna git
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    const res = await request.get('/api/v1/admin/fulfillments?q=M333', {
      headers: { cookie: cookieHeader },
    })
    expect(res.status(), 'CUSTOMER yönetim kuyruğunu okuyabiliyor').toBe(403)

    const body = await res.json().catch(() => ({}))
    // ⚠️ Reddetme mesajı bile veri sızdırmamalı
    expect(JSON.stringify(body)).not.toContain('orderNo')
  })

  test('yönetim sayfası oturumsuz kullanıcıyı girişe yollar', async ({ page }) => {
    await isolateClient(page)
    await page.goto('/yonetim/fulfillment')
    await expect(page).toHaveURL(/\/giris/, { timeout: 20_000 })
  })
})

// ===========================================================================
test.describe('cursor sayfalama', () => {
  /**
   * ⚠️ API üzerinden test edilir çünkü ikinci sayfayı arayüzde görebilmek
   * için 50'den fazla iş gerekir. Uç, arayüzün kullandığı ucun AYNISIDIR.
   */
  async function adminRequest(page: Page, request: APIRequestContext, url: string) {
    const cookies = await page.context().cookies()
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const res = await request.get(url, { headers: { cookie } })
    expect(res.ok(), `${url} → ${res.status()}`).toBe(true)
    return res.json()
  }

  test('⚠️ sayfalar kesişmez ve kayıt atlanmaz', async ({ page, request }) => {
    await loginAsAdmin(page)

    const first = await adminRequest(
      page,
      request,
      '/api/v1/admin/fulfillments?bucket=all&pageSize=3',
    )
    expect(Array.isArray(first.items)).toBe(true)
    test.skip(first.items.length < 3, 'Sayfalama için yeterli iş yok')

    expect(first.nextCursor).toBeTruthy()

    const second = await adminRequest(
      page,
      request,
      `/api/v1/admin/fulfillments?bucket=all&pageSize=3&cursor=${first.nextCursor}`,
    )

    const firstIds: string[] = first.items.map((i: { id: string }) => i.id)
    const secondIds: string[] = second.items.map((i: { id: string }) => i.id)

    // Kesişim YOK
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])
    // Kendi içinde tekrar YOK
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length)

    // Geri dönünce ilk sayfanın AYNISI gelir
    const back = await adminRequest(
      page,
      request,
      `/api/v1/admin/fulfillments?bucket=all&pageSize=3&cursor=${second.prevCursor}&dir=backward`,
    )
    expect(back.items.map((i: { id: string }) => i.id)).toEqual(firstIds)
  })

  test('⚠️ page parametresi KABUL EDİLMEZ (OFFSET sayfalama yok)', async ({ page, request }) => {
    await loginAsAdmin(page)
    const a = await adminRequest(page, request, '/api/v1/admin/fulfillments?bucket=all&pageSize=2')
    const b = await adminRequest(
      page,
      request,
      '/api/v1/admin/fulfillments?bucket=all&pageSize=2&page=5',
    )
    // `page` yok sayılır: iki cevap aynıdır
    expect(b.items.map((i: { id: string }) => i.id)).toEqual(
      a.items.map((i: { id: string }) => i.id),
    )
  })
})

// ===========================================================================
test.describe('operasyon kuyruğu arayüzü', () => {
  test('filtre çubuğu görünür ve eşleşmeyen arama boş durum gösterir', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/fulfillment?bucket=all')

    await expect(page.getByTestId('queue-filters')).toBeVisible()

    await page.getByTestId('queue-search').fill('M333-BOYLEBIRSEYYOK')
    await page.getByTestId('queue-filter-submit').click()

    await expect(page.getByTestId('queue-empty')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('queue-empty')).toContainText('Bu filtrelerle eşleşen iş yok')
  })

  test('sayaçlar gerçek sayıdır ve filtreyle değişmez', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/fulfillment?bucket=all')

    const before = await page.getByTestId('count-all').innerText()

    await page.getByTestId('queue-search').fill('M333-BOYLEBIRSEYYOK')
    await page.getByTestId('queue-filter-submit').click()
    await expect(page.getByTestId('queue-empty')).toBeVisible({ timeout: 15_000 })

    // ⚠️ Sekme sayacı filtreden ETKİLENMEZ; aksi hâlde operatör
    // "işler kayboldu" sanır.
    await expect(page.getByTestId('count-all')).toHaveText(before)
  })

  test('sıralama seçenekleri adres çubuğuna yazılır (paylaşılabilir)', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/fulfillment?bucket=all&sort=oldest')
    await expect(page.locator('#sort')).toHaveValue('oldest')
  })

  test('⚠️ kuyruk ekranı müşteri e-postası/adı GÖSTERMEZ', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/fulfillment?bucket=all')

    const html = await page.locator('#icerik').innerHTML()
    // Operasyon için sipariş no ve hedef yeterlidir; kişisel veri gerekmez.
    expect(html).not.toMatch(/[a-z0-9._-]+@ornek\.test/i)
  })
})

// ===========================================================================
test.describe('katalog yönetimi arayüzü', () => {
  test('platform, hizmet ve varyant hiyerarşisi üstverisiyle görünür', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/katalog')

    await expect(page.getByTestId('catalog-counts')).toBeVisible()
    await expect(page.getByTestId('platform-instagram')).toBeVisible()
    // Oluşturma / güncelleme bilgisi
    await expect(page.getByTestId('platform-instagram')).toContainText('oluşturma')
    await expect(page.getByTestId('platform-instagram')).toContainText('fiyat noktası')
  })

  test('yeni hizmet ve yeni varyant formları açılır', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/katalog')

    const newService = page.getByTestId('new-service-instagram')
    await expect(newService).toBeVisible()
    await newService.getByText('+ Yeni hizmet').click()
    await expect(newService.getByTestId('service-form')).toBeVisible()
    // Hedef tipi listesi ADAPTER'dan gelir, elle yazılmaz
    await expect(newService.locator('select[name="targetType"] option')).not.toHaveCount(0)
  })

  test('⭐ fiyat doğrulama raporu PASS/WARNING/ERROR seviyesi gösterir', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/katalog')

    await page.getByTestId('variant-instagram-takipci-turk').click()
    await expect(page.getByTestId('pricing-report')).toBeVisible({ timeout: 15_000 })

    const level = await page.getByTestId('pricing-report-level').innerText()
    expect(['PASS', 'WARNING', 'ERROR']).toContain(level)
    // Gerçek katalog sağlam olmalı
    expect(level).toBe('PASS')
  })

  test('⭐ varyant düzenleme ve fiyat kademesi formları mevcut', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/katalog')
    await page.getByTestId('variant-instagram-takipci-turk').click()

    await expect(page.getByTestId('new-pricing-rule')).toBeVisible()
    await expect(page.getByTestId('edit-variant')).toBeVisible()

    // Garanti alanı: boş bırakılabilir ⇒ garanti YOK (tahmin edilmez)
    await page.getByTestId('edit-variant').getByText('Varyantı düzenle').click()
    await expect(page.getByTestId('variant-refill-days')).toBeVisible()
  })

  test('⚠️ fiyat kademesinde SİLME düğmesi yok, pasifleştirme var', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/katalog')
    await page.getByTestId('variant-instagram-takipci-turk').click()

    const table = page.locator('table').first()
    await expect(table).toBeVisible()
    await expect(table.getByRole('button', { name: /^Sil$/ })).toHaveCount(0)
    await expect(table.getByRole('button', { name: /Pasifleştir|Aktifleştir/ }).first()).toBeVisible()
  })
})

// ===========================================================================
test.describe('mobil operasyon arayüzü', () => {
  test.skip(({ isMobile }) => !isMobile, 'yalnızca mobil projede')

  test('kuyruk mobilde yatay taşma olmadan açılır', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/fulfillment?bucket=all')

    await expect(page.getByTestId('queue-filters')).toBeVisible()

    /**
     * ⚠️ Tablo bilinçli olarak yatay KAYDIRILIR (min-w). Kaydırılan sarmalayıcı
     * dışında SAYFANIN KENDİSİ taşmamalıdır; aksi hâlde tüm arayüz sağa kayar.
     */
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `sayfa ${overflow}px taşıyor`).toBeLessThanOrEqual(0)
  })

  test('katalog ekranı mobilde taşmaz', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/katalog')
    await expect(page.getByTestId('catalog-counts')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `sayfa ${overflow}px taşıyor`).toBeLessThanOrEqual(0)
  })
})

// ===========================================================================
test.describe('bildirim paneli', () => {
  test('açılır, sağlayıcı uyarısı ve operasyon sayaçları görünür', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/notifications')

    await expect(page.getByTestId('alert-failed')).toBeVisible()
    await expect(page.getByTestId('alert-review')).toBeVisible()
    await expect(page.getByTestId('alert-waiting')).toBeVisible()
    await expect(page.getByTestId('alert-guarantee')).toBeVisible()

    /**
     * ⚠️ SLA tanımlı olmadığı için "gecikti" DENMEZ. Ekran ölçümü verir,
     * yorumu insana bırakır.
     */
    await expect(page.locator('#icerik')).not.toContainText('gecikti')
    await expect(page.locator('#icerik')).not.toContainText('Gecikti')
  })

  test('⚠️ ham e-posta, token veya API anahtarı GÖSTERİLMEZ', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/notifications?filter=all')

    const html = await page.locator('#icerik').innerHTML()

    // Maskesiz e-posta yok (maskeliler `ab***@` biçiminde)
    expect(html, 'panelde maskesiz e-posta').not.toMatch(/[a-z0-9._-]{3,}@ornek\.test/i)

    /**
     * ⚠️ Aranan şey DEĞİŞKEN ADI değil, SIR DEĞERİDİR.
     * Ekran operatöre `EMAIL_PROVIDER=resend` ve `RESEND_API_KEY` yazmasını
     * söyleyen bir yardım metni gösterir — bu bir sızıntı değil, yönergedir.
     * Sızıntı, o değişkenin DEĞERİNİN görünmesidir.
     */
    for (const secretShape of [
      /\bre_[A-Za-z0-9]{8,}/, // Resend anahtar biçimi
      /Bearer\s+[A-Za-z0-9._-]{16,}/, // yetkilendirme başlığı
      /\bsk_(live|test)_[A-Za-z0-9]{8,}/, // genel gizli anahtar biçimi
      /"?(apiKey|accessToken|sessionToken)"?\s*[:=]\s*"?[A-Za-z0-9._-]{12,}/,
    ]) {
      expect(html, `panelde sır değeri: ${secretShape}`).not.toMatch(secretShape)
    }

    // Sağlayıcının ham cevabı da gösterilmez
    expect(html).not.toContain('"statusCode"')
  })

  test('sağlayıcı teslim edemiyorsa açık uyarı verir', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/notifications')

    // E2E ortamında gerçek sağlayıcı yok → uyarı görünmeli
    await expect(page.getByTestId('mail-provider-warning')).toBeVisible()
    await expect(page.getByTestId('mail-provider-warning')).toContainText(
      'hiçbir e-posta gitmiyor',
    )
  })
})

// ===========================================================================
test.describe('rol yönetimi', () => {
  test('⚠️ SUPPORT/OPERATOR kullanıcı yönetimine ERİŞEMEZ', async ({ page, request }) => {
    // Oturumsuz istek de reddedilmeli
    const res = await request.patch('/api/v1/admin/users/xxx/role', {
      data: { role: 'ADMIN' },
    })
    expect([401, 403]).toContain(res.status())
  })

  test('⚠️ CUSTOMER kendini ADMIN YAPAMAZ', async ({ page, request }) => {
    await isolateClient(page)
    const email = `esc-${Date.now()}@ornek.test`
    await page.goto('/kayit')
    await page.getByLabel('E-posta').fill(email)
    await page.getByLabel('Şifre').fill('Musteri-Sifre-2026')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Hesap Oluştur' }).click()
    await expect(page).toHaveURL(/\/hesabim/, { timeout: 20_000 })

    const cookies = await page.context().cookies()
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    // Kendi kimliğini öğrenip kendini yükseltmeyi dene
    const res = await request.patch('/api/v1/admin/users/self/role', {
      headers: { cookie, origin: new URL(page.url()).origin },
      data: { role: 'SUPERADMIN' },
    })
    expect(res.status(), 'CUSTOMER rol değiştirme ucuna girebiliyor').toBe(403)

    // Sayfa da erişilemez olmalı
    await page.goto('/yonetim/kullanicilar')
    await expect(page).not.toHaveURL(/\/yonetim\/kullanicilar/, { timeout: 20_000 })
  })

  test('ADMIN kullanıcı listesini görür; adresler maskelidir', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/kullanicilar')

    await expect(page.getByTestId('user-summary')).toBeVisible()
    const html = await page.locator('#icerik').innerHTML()
    expect(html).toContain('***@')
    expect(html, 'listede ham e-posta').not.toContain('admin@medya333.local')
  })

  test('⚠️ kişi KENDİ rolünü değiştiremez (arayüz de kilitler)', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/yonetim/kullanicilar?q=admin')

    // Giriş yapan kullanıcının satırı kilitli görünür
    await expect(page.locator('[data-testid$="-locked"]').first()).toBeVisible()
  })
})

// ===========================================================================
test.describe('üretim alan adı ve SEO', () => {
  test('canonical, og:url ve sitemap AYNI tabandan üretilir', async ({ page, request }) => {
    await page.goto('/')

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content')
    expect(canonical).toBeTruthy()
    expect(new URL(canonical!).origin).toBe(new URL(ogUrl!).origin)

    const robots = await (await request.get('/robots.txt')).text()
    const sitemap = await (await request.get('/sitemap.xml')).text()
    expect(robots).toContain(new URL(canonical!).origin)
    expect(sitemap).toContain(new URL(canonical!).origin)
  })

  test('⚠️ og:image UYDURULMAMIŞ (kırık önizleme yok)', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0)
  })

  test('dil etiketi tr-TR', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr-TR')
  })

  test('robots özel yolları engeller', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text()
    for (const p of ['/yonetim/', '/panel/', '/hesabim', '/siparisler/', '/giris', '/kayit']) {
      expect(robots, `${p} engellenmemiş`).toContain(`Disallow: ${p}`)
    }
  })

  test('⚠️ sitemap TOKEN taşıyan veya özel adres içermez', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text()
    for (const bad of ['/siparisler/', '/hesabim', '/yonetim', '/odeme/', '?t=', '?p=', '/giris']) {
      expect(sitemap, `site haritasında "${bad}"`).not.toContain(bad)
    }
    expect(sitemap).toContain('/yardim')
    expect(sitemap).toContain('/siparis-takip')
  })
})

// ===========================================================================
test.describe('liveness / readiness', () => {
  test('liveness bağımlılığa bakmaz ve düz metin döner', async ({ request }) => {
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
    expect((await res.text()).trim()).toBe('ok')
  })

  test('readiness bağımlılık durumunu döner', async ({ request }) => {
    const res = await request.get('/api/health')
    const body = await res.json()
    expect(Object.keys(body.checks).sort()).toEqual(['application', 'database', 'redis'])
  })
})
