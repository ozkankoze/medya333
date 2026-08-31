import { expect, test } from '@playwright/test'
import { isProductionTarget } from './guard'

/**
 * ⭐ DUMAN TESTİ — OKUMA KATMANI (Faz 11)
 *
 * Dağıtılmış bir ortamın gerçekten çalıştığını doğrular.
 *
 * ⚠️ HİÇBİR KAYIT OLUŞTURMAZ.
 * Sipariş, kullanıcı, hedef (Target), ödeme ve fulfillment kaydı YAZILMAZ.
 * Bu yüzden CANLI ortama karşı da çalıştırılabilir:
 *
 *     SMOKE_BASE_URL=https://www.medya333.com npm run test:smoke
 *
 * YAZMA KATMANI AYRIDIR ve burada ÇALIŞTIRILMAZ:
 *
 *   8  · hedef doğrulama      → `Target` kaydı oluşturur
 *   10 · sipariş oluşturma    → `Order` kaydı
 *   11 · idempotency          → `Order` kaydı
 *   12 · misafir takibi       → sipariş gerektirir
 *   13 · kimlik doğrulama     → `User` kaydı
 *   14 · hesabım              → oturum gerektirir
 *   17 · fulfillment READY    → `Fulfillment` kaydı
 *   18 · manuel fulfillment   → `FulfillmentEvent` kayıtları
 *
 * Bunlar `tests/e2e/**` altında zaten uçtan uca kapsanmıştır ve
 * staging/preview ortamına karşı çalıştırılır:
 *
 *     E2E_BASE_URL=https://<staging> npm run test:e2e
 *
 * `playwright.config.ts` canlı alan adını HEDEF OLARAK REDDEDER
 * (tests/smoke/guard.ts) — yani yazma testleri canlıya yanlışlıkla
 * yönlendirilemez.
 */

const BASE = process.env.SMOKE_BASE_URL ?? process.env.E2E_BASE_URL ?? ''
const AGAINST_PRODUCTION = isProductionTarget(BASE)

test.beforeAll(() => {
  console.log(
    `\n[smoke] hedef: ${BASE || '(config varsayılanı)'}` +
      `${AGAINST_PRODUCTION ? '  ⚠️ CANLI ORTAM — yalnızca okuma' : ''}\n`,
  )
})

// ===========================================================================
test.describe('1-2 · sayfa ve katalog açılıyor', () => {
  test('1 · ana sayfa açılıyor', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.status(), 'ana sayfa 200 dönmedi').toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('2 · hizmetler açılıyor — katalog SUNUCUDAN geliyor', async ({ page }) => {
    await page.goto('/')

    const snapshot = await page.evaluate(async () => {
      const r = await fetch('/api/v1/catalog/snapshot')
      return { status: r.status, body: await r.json() }
    })

    expect(snapshot.status).toBe(200)
    const platforms = snapshot.body.platforms ?? snapshot.body.data?.platforms
    expect(Array.isArray(platforms), 'katalog snapshot platform listesi döndürmedi').toBe(true)
    expect(platforms.length).toBeGreaterThan(0)

    // ⚠️ Katalog HARDCODE DEĞİL: sayfada görünen platform, API'den gelenle aynı.
    const names: string[] = platforms.map((p: { name: string }) => p.name)
    expect(names).toContain('Instagram')
  })
})

// ===========================================================================
test.describe('3-5 · hizmet · varyant · hazır miktar', () => {
  test('3 · Instagram takipçi hizmeti katalogda', async ({ page }) => {
    await page.goto('/')
    const service = await page.evaluate(async () => {
      const r = await fetch('/api/v1/catalog/snapshot')
      const b = await r.json()
      const platforms = b.platforms ?? b.data?.platforms
      const ig = platforms.find((p: { slug: string }) => p.slug === 'instagram')
      return ig?.services?.find((s: { slug: string }) => s.slug === 'takipci') ?? null
    })

    expect(service, 'instagram/takipci hizmeti katalogda yok').not.toBeNull()
    expect(service.variants.length).toBeGreaterThan(0)
  })

  test('4 · Türk ve Yabancı varyantlar mevcut', async ({ page }) => {
    await page.goto('/')
    const slugs: string[] = await page.evaluate(async () => {
      const r = await fetch('/api/v1/catalog/snapshot')
      const b = await r.json()
      const platforms = b.platforms ?? b.data?.platforms
      const ig = platforms.find((p: { slug: string }) => p.slug === 'instagram')
      const svc = ig.services.find((s: { slug: string }) => s.slug === 'takipci')
      return svc.variants.map((v: { slug: string }) => v.slug)
    })

    expect(slugs).toContain('turk')
    expect(slugs).toContain('yabanci')
  })

  test('5 · hazır miktarlar tanımlı — serbest miktar YOK', async ({ page }) => {
    await page.goto('/')
    const variant = await page.evaluate(async () => {
      const r = await fetch('/api/v1/catalog/snapshot')
      const b = await r.json()
      const platforms = b.platforms ?? b.data?.platforms
      const ig = platforms.find((p: { slug: string }) => p.slug === 'instagram')
      const svc = ig.services.find((s: { slug: string }) => s.slug === 'takipci')
      return svc.variants.find((v: { slug: string }) => v.slug === 'turk')
    })

    const quantities: number[] = variant.presetQuantities ?? variant.quantities ?? []
    expect(quantities.length, 'hazır miktar listesi boş').toBeGreaterThan(0)
    expect(quantities.every((q) => Number.isInteger(q) && q > 0)).toBe(true)
  })
})

// ===========================================================================
test.describe('6-7-9 · fiyat · KDV · sipariş özeti', () => {
  test('6-7-9 · fiyat SUNUCUDAN gelir, KDV brütten AYRIŞTIRILIR', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const snap = await (await fetch('/api/v1/catalog/snapshot')).json()
      const platforms = snap.platforms ?? snap.data?.platforms
      const ig = platforms.find((p: { slug: string }) => p.slug === 'instagram')
      const svc = ig.services.find((s: { slug: string }) => s.slug === 'takipci')
      const variant = svc.variants.find((v: { slug: string }) => v.slug === 'turk')
      // ⚠️ Serbest miktar yoktur — miktar HAZIR PAKETLERDEN seçilir.
      const quantity: number = variant.presetQuantities[0]

      const r = await fetch('/api/v1/pricing/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceVariantId: variant.id, quantity }),
      })
      return { status: r.status, quote: await r.json(), quantity }
    })

    expect(result.status, 'fiyat teklifi alınamadı').toBe(200)
    const q = result.quote

    // 6 · Fiyat gerçek bir tutar ve TAM SAYI KURUŞ (float yok)
    expect(Number.isInteger(q.total), 'total tam sayı kuruş değil').toBe(true)
    expect(q.total).toBeGreaterThan(0)
    expect(Number.isInteger(q.subtotal)).toBe(true)
    expect(Number.isInteger(q.taxAmount)).toBe(true)

    // 7 · ⚠️ KDV BRÜTTEN AYRIŞTIRILIR — ÜZERİNE EKLENMEZ
    expect(q.pricesTaxInclusive, 'fiyatlar KDV dahil işaretli değil').toBe(true)
    expect(q.subtotal + q.taxAmount, 'subtotal + tax ≠ total (KDV üstüne eklenmiş)').toBe(q.total)

    // Beklenen vergi: round(total * rate / (10000 + rate))
    const expectedTax = Math.round((q.total * q.taxRate) / (10_000 + q.taxRate))
    expect(q.taxAmount, 'KDV ayrıştırma formülü tutmuyor').toBe(expectedTax)

    // 9 · Sipariş özetinin dayandığı alanların hepsi mevcut ve tutarlı
    expect(q.quantity).toBe(result.quantity)
    expect(q.currency).toBe('TRY')
    expect(q.unitLabel).toBeTruthy()
    expect(q.service.platformName).toBe('Instagram')
    expect(q.appliedTier, 'hangi fiyat kademesinin uygulandığı bildirilmiyor').toBeTruthy()
  })

  test('⚠️ hazır paket dışında miktar REDDEDİLİR', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const snap = await (await fetch('/api/v1/catalog/snapshot')).json()
      const platforms = snap.platforms ?? snap.data?.platforms
      const ig = platforms.find((p: { slug: string }) => p.slug === 'instagram')
      const svc = ig.services.find((s: { slug: string }) => s.slug === 'takipci')
      const variant = svc.variants.find((v: { slug: string }) => v.slug === 'turk')

      // Listede olmayan rastgele miktar
      const r = await fetch('/api/v1/pricing/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceVariantId: variant.id, quantity: 137 }),
      })
      return { status: r.status, body: await r.json() }
    })

    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(result.body.error.code).toBe('QUANTITY_NOT_ALLOWED')
  })

  test('⚠️ istemcinin dayattığı fiyat KABUL EDİLMEZ', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const snap = await (await fetch('/api/v1/catalog/snapshot')).json()
      const platforms = snap.platforms ?? snap.data?.platforms
      const ig = platforms.find((p: { slug: string }) => p.slug === 'instagram')
      const svc = ig.services.find((s: { slug: string }) => s.slug === 'takipci')
      const variant = svc.variants.find((v: { slug: string }) => v.slug === 'turk')
      const quantity: number = variant.presetQuantities[0]

      const honest = await (
        await fetch('/api/v1/pricing/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ serviceVariantId: variant.id, quantity }),
        })
      ).json()

      // Saldırgan 1 kuruşluk fiyat dayatmaya çalışır
      const attack = await (
        await fetch('/api/v1/pricing/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            serviceVariantId: variant.id,
            quantity,
            total: 1,
            subtotal: 1,
            unitPrice: 1,
            taxAmount: 0,
            packagePrice: 1,
          }),
        })
      ).json()

      return { honest, attack }
    })

    // ⚠️ Sunucu kendi hesabını yapar; istemciden gelen tutarlar YOK SAYILIR.
    expect(result.attack.total, 'istemcinin dayattığı fiyat kabul edildi').toBe(result.honest.total)
    expect(result.attack.subtotal).toBe(result.honest.subtotal)
    expect(result.attack.taxAmount).toBe(result.honest.taxAmount)
    expect(result.attack.total).toBeGreaterThan(1)
  })
})

// ===========================================================================
test.describe('15 · sağlık uçları', () => {
  test('15a · /api/health/live bağımlılığa BAKMAZ', async ({ request }) => {
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body.trim().length).toBeLessThan(64)
  })

  test('15b · /api/health bağımlılıkları raporlar', async ({ request }) => {
    const res = await request.get('/api/health')
    // 200 = healthy/degraded · 503 = unavailable. İkisi de GEÇERLİ cevaptır.
    expect([200, 503]).toContain(res.status())

    const body = await res.json()
    expect(body.status).toMatch(/healthy|degraded|unavailable/)
    expect(body.checks.database).toBeTruthy()
    expect(body.checks.redis).toBeTruthy()
  })

  test('⚠️ 15c · sağlık cevabı SIR / BAĞLANTI ADRESİ / STACK sızdırmaz', async ({ request }) => {
    const body = await (await request.get('/api/health')).text()

    for (const bad of [
      'postgres://',
      'postgresql://',
      'redis://',
      're_',
      'AUTH_SECRET',
      'DATABASE_URL',
      'PAYTR',
      'at Object.',
      'node_modules',
      'SELECT ',
    ]) {
      expect(body, `sağlık cevabında "${bad}" geçiyor`).not.toContain(bad)
    }
  })

  test('⚠️ 15d · sağlık kontrolü ÖDEME SAĞLAYICISINA istek atmaz', async ({ page }) => {
    const external: string[] = []
    page.on('request', (r) => {
      const url = r.url()
      if (/paytr\.com|iyzipay\.com|iyzico\.com/.test(url)) external.push(url)
    })

    await page.goto('/api/health')
    expect(external, 'sağlık kontrolü ödeme sağlayıcısını çağırdı').toEqual([])
  })
})

// ===========================================================================
test.describe('16 · yönetim erişimi kapalı', () => {
  // ⚠️ Yönetim → personel kapısı, müşteri alanı → müşteri kapısı.
  //    Tek bir `/giris` kalıbı ikisini de geçiriyordu; hedef artık ayrı.
  for (const path of [
    '/yonetim',
    '/yonetim/fulfillment',
    '/yonetim/kullanicilar',
    '/yonetim/kasa',
  ]) {
    test(`16 · oturumsuz ${path} → yönetim girişi`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/yonetim\/giris/)
    })
  }

  test('16 · oturumsuz /hesabim → müşteri girişi', async ({ page }) => {
    await page.goto('/hesabim')
    await expect(page).toHaveURL(/\/giris/)
    await expect(page).not.toHaveURL(/\/yonetim\//)
  })

  test('⚠️ 16c · yönetim girişinde KAYIT seçeneği yok', async ({ page }) => {
    await page.goto('/yonetim/giris')
    await expect(page).toHaveURL(/\/yonetim\/giris/) // döngü yok
    await expect(page.locator('a[href="/kayit"]')).toHaveCount(0)
    await expect(page.getByLabel('E-posta')).toBeVisible()
  })

  test('⚠️ 16b · admin API oturumsuz 401/403 döner', async ({ request }) => {
    for (const path of ['/api/v1/admin/orders', '/api/v1/admin/users', '/api/v1/admin/fulfillments']) {
      const res = await request.get(path)
      expect([401, 403, 404], `${path} beklenmedik ${res.status()} döndü`).toContain(res.status())
    }
  })
})

// ===========================================================================
test.describe('canlı ortam yüzeyi', () => {
  test('güvenlik başlıkları geliyor', async ({ request }) => {
    const res = await request.get('/')
    const h = res.headers()

    expect(h['content-security-policy']).toBeTruthy()
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(h['permissions-policy']).toBeTruthy()
    expect(h['cross-origin-opener-policy']).toBe('same-origin')
    // ⚠️ Sunucu teknolojisi ifşa edilmez
    expect(h['x-powered-by']).toBeUndefined()
  })

  test('HTTPS ise HSTS gönderilir', async ({ request, baseURL }) => {
    const res = await request.get('/')
    if (baseURL?.startsWith('https://')) {
      expect(res.headers()['strict-transport-security']).toContain('max-age=')
    }
  })

  test('robots · sitemap · manifest doğru davranıyor', async ({ request, baseURL }) => {
    const origin = new URL(baseURL ?? BASE).origin
    const robots = await (await request.get('/robots.txt')).text()

    /**
     * ⚠️ İKİ MEŞRU DAVRANIŞ VARDIR (Faz 11):
     *
     *   CANLI          → site açık, özel yollar engelli, sitemap bildirilir
     *   CANLI OLMAYAN  → TÜM site kapalı, sitemap BİLDİRİLMEZ
     *
     * Duman testi hedefin hangisi olduğunu bilmez ve BİLMEMELİDİR (aşama
     * dışarıya sızdırılmaz). Bu yüzden her iki dal da ayrı ayrı doğrulanır —
     * "hangisi çıkarsa o doğrudur" DENMEZ.
     */
    const closed = !robots.includes('Allow: /')

    /**
     * ⭐⭐ BU KONTROLÜN OLMAMASI GERÇEK BİR OLAYA MAL OLDU.
     *
     * Yukarıdaki "aşamayı bilme" ilkesi genel bir hedef için doğrudur, ama
     * CANLI ALAN ADI için yanlıştı: `www.medya333.com` üzerinde "tüm site
     * kapalı" HİÇBİR ZAMAN meşru bir sonuç değildir. Test her iki dalı da
     * kabul ettiği için, `APP_ENV` yanlışlıkla `production` dışında bir
     * değere ayarlandığında robots.txt tüm siteyi Google'a kapattı ve
     * **duman testi yine YEŞİL kaldı**.
     *
     * Belirti sessizdi: sayfalar açılıyordu, hiçbir hata düşmüyordu, hiçbir
     * test kırılmıyordu. Yalnızca site arama motoruna görünmez olmuştu ve
     * bunu kimse robots.txt'yi elle açana kadar fark etmedi.
     *
     * ⚠️ Hedef canlıysa aşama artık BİLİNİR bir şeydir: canlı alan adına
     * cevap veren dağıtım, tanımı gereği canlıdır. Bu yüzden burada kapalı
     * dal bir SEÇENEK değil, BAŞARISIZLIKTIR.
     */
    if (AGAINST_PRODUCTION) {
      expect(
        closed,
        'CANLI ALAN ADI ARAMA MOTORUNA KAPALI. robots.txt "Disallow: /" diyor — '
          + 'site indekslenemez. Neredeyse kesin sebep: bu dağıtımda APP_ENV '
          + '"production" değil (staging/e2e). Vercel ortam değişkenlerini kontrol edin.',
      ).toBe(false)
    }

    if (closed) {
      expect(robots).toContain('Disallow: /')
      expect(robots, 'kapalı ortam sitemap bildiriyor').not.toContain('Sitemap:')
    } else {
      // Canlı dal: özel yollar tek tek engellenmiş olmalı.
      for (const p of ['/api/', '/yonetim/', '/hesabim', '/siparisler/', '/odeme/']) {
        expect(robots, `${p} engellenmemiş`).toContain(`Disallow: ${p}`)
      }
      expect(robots).toContain(`${origin}/sitemap.xml`)

      const sitemap = await (await request.get('/sitemap.xml')).text()

      /**
       * ⚠️ "İÇERİYOR" YETMEZ — HER `loc` DOĞRU ALAN ADINDA OLMALI.
       *
       * Önceki hâli `toContain(origin)` idi: tek bir adres doğru olsa test
       * geçerdi. Gerçekte olan şey ise adreslerin TAMAMININ yanlış alan
       * adında üretilmesiydi (`APP_BASE_URL` başka bir Vercel projesinin
       * alias'ını gösteriyordu). Yanlış alan adı, arama motoruna iki ayrı
       * host'ta aynı içeriği bildirmek demektir — yinelenen içerik.
       */
      const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => m[1])
        .filter((u): u is string => Boolean(u))
      expect(locs.length, 'sitemap hiç adres içermiyor').toBeGreaterThan(0)
      const wrongHost = locs.filter((u) => !u.startsWith(`${origin}/`))
      expect(
        wrongHost,
        `sitemap YANLIŞ alan adı kullanıyor (beklenen ${origin}) — ${wrongHost.length}/${locs.length} adres`,
      ).toEqual([])
      // ⚠️ Token taşıyan veya özel adresler site haritasında olmamalı.
      for (const bad of ['/siparisler/', '/hesabim', '/yonetim', '/odeme/', '?t=']) {
        expect(sitemap, `site haritasında "${bad}"`).not.toContain(bad)
      }
    }

    const manifest = await (await request.get('/manifest.webmanifest')).json()
    expect(manifest.start_url).toBe(`${origin}/`)
  })

  test('canonical ve og:url aynı alan adını gösterir', async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? BASE).origin
    await page.goto('/')

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content')

    expect(canonical, 'canonical yanlış alan adı').toContain(origin)
    expect(ogUrl, 'og:url yanlış alan adı').toContain(origin)
  })

  test('⚠️ sayfa kaynağında SIR ŞEKLİ yok', async ({ page }) => {
    await page.goto('/')
    const html = await page.content()

    // Değişken ADI değil, sırrın BİÇİMİ aranır — panel yardım metinleri
    // meşru olarak değişken adı içerebilir.
    for (const pattern of [
      /re_[A-Za-z0-9]{20,}/,
      /sk_live_[A-Za-z0-9]{16,}/,
      /Bearer\s+[A-Za-z0-9._-]{20,}/,
      /postgres(ql)?:\/\/[^\s"']*:[^\s"'@]+@/,
      /redis:\/\/[^\s"']*:[^\s"'@]+@/,
    ]) {
      expect(html, `sayfa kaynağında sır şekli: ${pattern}`).not.toMatch(pattern)
    }
  })

  test('⚠️ ödeme sahte sağlayıcıya AÇIK DEĞİL (canlı hedefte)', async ({ request }) => {
    test.skip(!AGAINST_PRODUCTION, 'yalnızca canlı hedefte anlamlı')

    // Mock ödeme ucu canlıda erişilebilir olmamalıdır.
    const res = await request.get('/api/v1/payments/mock/checkout')
    expect([401, 403, 404, 405], `mock checkout ucu ${res.status()} döndü`).toContain(res.status())
  })
})
