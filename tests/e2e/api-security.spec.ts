import { expect, test } from '@playwright/test'

/**
 * E2E — API GÜVENLİĞİ (canlı üretim sunucusuna karşı)
 *
 * Entegrasyon testleri route handler'ları doğrudan çağırır; bu dosya ise
 * DERLENMİŞ ÜRETİM SUNUCUSUNA gerçek HTTP istekleri atar. Böylece middleware,
 * header'lar ve derleme sonrası davranış da doğrulanmış olur.
 */

test.describe.configure({ mode: 'serial' })

test.describe('public katalog API', () => {
  test('🔒 iç alanlar sızmıyor', async ({ request }) => {
    const res = await request.get('/api/v1/catalog/snapshot')
    expect(res.status()).toBe(200)
    const raw = await res.text()

    for (const forbidden of [
      'internalName',
      'Havuz',
      'adminNote',
      'adapterKey',
      'adapterConfig',
      'createdById',
      'passwordHash',
      'twoFactorSecret',
      'idempotencyKey',
      'IYZICO',
      'AUTH_SECRET',
      'DATABASE_URL',
      'REDIS_URL',
      'HOSGELDIN',
      'maxRedemptions',
      'redemptionCount',
    ]) {
      expect(raw, `"${forbidden}" public katalogda görünüyor`).not.toContain(forbidden)
    }
  })

  test('katalog zinciri ve KDV bayrağı doğru', async ({ request }) => {
    const json = await (await request.get('/api/v1/catalog/snapshot')).json()
    // ⚠️ Faz 5.1: Instagram · YouTube · Facebook · TikTok aktiftir.
    expect(json.platforms).toHaveLength(4)
    expect(json.platforms.map((p: any) => p.slug).sort()).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
    ])
    expect(json.pricesTaxInclusive).toBe(true)
    expect(json.taxRateBp).toBe(2000)
    const svc = json.platforms[0].services[0]
    expect(svc.unitLabel).toBeTruthy()
    expect(svc.variants[0].tiers.length).toBeGreaterThan(0)
  })

  test('güvenlik header\'ları var', async ({ request }) => {
    const res = await request.get('/')
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
    expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers()['x-frame-options']).toBe('DENY')
    expect(res.headers()['strict-transport-security']).toContain('max-age=')
  })

  test('rate limit başlıkları döner', async ({ request }) => {
    const res = await request.get('/api/v1/catalog/snapshot')
    expect(res.headers()['x-ratelimit-limit']).toBeTruthy()
    expect(res.headers()['x-ratelimit-remaining']).toBeTruthy()
  })
})

test.describe('pricing API', () => {
  test('🔒 istemciden gelen fiyat YOK SAYILIR', async ({ request }) => {
    const catalog = await (await request.get('/api/v1/catalog/snapshot')).json()
    const ig = catalog.platforms.find((p: any) => p.slug === 'instagram')
    const takipci = ig.services.find((s: any) => s.slug === 'takipci')
    const turk = takipci.variants.find((v: any) => v.slug === 'turk')

    const res = await request.post('/api/v1/pricing/quote', {
      data: {
        serviceVariantId: turk.id,
        quantity: 1000,
        unitPrice: 1,
        subtotal: 1,
        taxAmount: 0,
        total: 1,
      },
    })
    expect(res.status()).toBe(200)
    const j = await res.json()
    // ⚠️ 1.000 Türk Takipçi = 1.349,90 ₺ — gerçek satış fiyatı
    expect(j.total).toBe(134_990)
    expect(j.pricingMode).toBe('PACKAGE')
    expect(j.unitLabel).toBe('takipçi')
    expect(j.subtotal + j.taxAmount).toBe(j.total)
    expect(j.appliedTier.minQuantity).toBe(1000)
  })

  test('⚠️ hazır listede olmayan miktar 400 döner', async ({ request }) => {
    const catalog = await (await request.get('/api/v1/catalog/snapshot')).json()
    const ig = catalog.platforms.find((p: any) => p.slug === 'instagram')
    const takipci = ig.services.find((s: any) => s.slug === 'takipci')
    const turk = takipci.variants.find((v: any) => v.slug === 'turk')

    const res = await request.post('/api/v1/pricing/quote', {
      data: { serviceVariantId: turk.id, quantity: 7342 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error.code).toBe('QUANTITY_NOT_ALLOWED')
  })

  test('🔒 aşırı büyük gövde 413', async ({ request }) => {
    const res = await request.post('/api/v1/pricing/quote', {
      data: { serviceVariantId: 'x'.repeat(30), quantity: 100, junk: 'y'.repeat(200_000) },
    })
    expect(res.status()).toBe(413)
  })

  test('🔒 geçersiz gövde 400, iç detay sızmaz', async ({ request }) => {
    const res = await request.post('/api/v1/pricing/quote', { data: { nope: true } })
    expect(res.status()).toBe(400)
    const raw = await res.text()
    expect(raw).not.toMatch(/node_modules|\/src\/|SELECT |prisma\./i)
  })
})

test.describe('🔒 admin API korumalı', () => {
  const endpoints = [
    '/api/v1/admin/platforms',
    '/api/v1/admin/services',
    '/api/v1/admin/variants',
    '/api/v1/admin/pricing-rules',
    '/api/v1/admin/pricing/validate',
  ]

  for (const path of endpoints) {
    test(`GET ${path} oturumsuz 401`, async ({ request }) => {
      const res = await request.get(path)
      expect(res.status()).toBe(401)
      expect((await res.json()).error.code).toBe('UNAUTHENTICATED')
    })
  }

  test('POST /admin/platforms oturumsuz 401 — kayıt OLUŞMAZ', async ({ request }) => {
    const res = await request.post('/api/v1/admin/platforms', {
      data: { name: 'Yetkisiz', slug: 'yetkisiz', adapterKey: 'generic' },
    })
    expect(res.status()).toBe(401)

    const catalog = await (await request.get('/api/v1/catalog/snapshot')).json()
    expect(catalog.platforms.some((p: any) => p.slug === 'yetkisiz')).toBe(false)
  })

  /**
   * ⚠️ İKİ AYRI KAPI. Eskiden bu test yalnızca `/giris` arıyordu ve
   * `/yonetim/giris` de o kalıba uyduğu için, panelin müşteri girişine
   * düşmesi ile personel kapısına düşmesi AYNI görünüyordu. Hedef artık
   * tam olarak sabitlenmiştir.
   */
  test('/yonetim oturumsuz PERSONEL kapısına yönlendirir', async ({ page }) => {
    await page.goto('/yonetim/kasa')
    await expect(page).toHaveURL(/\/yonetim\/giris/)
    // Müşteri kapısının davetleri burada olmamalı.
    await expect(page.getByRole('link', { name: /Kayıt ol/i })).toHaveCount(0)
  })

  test('/panel oturumsuz MÜŞTERİ kapısına yönlendirir', async ({ page }) => {
    await page.goto('/panel')
    await expect(page).toHaveURL(/\/giris/)
    await expect(page).not.toHaveURL(/\/yonetim\//)
  })
})
