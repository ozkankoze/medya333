/**
 * ⭐ INSTAGRAM BUSINESS DISCOVERY — DAVRANIŞ SÖZLEŞMESİ
 *
 * ⚠️ BU TESTİN EN ÖNEMLİ İDDİASI BİRİNCİ BLOKTA:
 *
 * Bayrak KAPALIYKEN tek bir `fetch` çağrısı bile yapılmamalıdır. "Çağrı yapıp
 * sonucu yok saymak" ile "çağrı yapmamak" arasındaki fark, Meta kotası ve
 * gizlilik açısından her şeydir. Bunu iddia etmek yetmez — `fetch` casusla
 * değiştirilip ÇAĞRI SAYISI ölçülür.
 *
 * İkinci önemli iddia: hiçbir başarısızlık senaryosunda `resolve()` THROW
 * ETMEZ. `PlatformAdapter` sözleşmesi bunu şart koşuyor ("adapter çökmesi
 * sipariş kaybına dönüşmemeli") ve rota katmanındaki `.catch` bunun yalnızca
 * ikinci savunma hattıdır.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CTX = { canonicalUrl: 'https://www.instagram.com/medya333/', handle: 'medya333' }

/** Her senaryoda modül grafiği sıfırdan kurulur — `env` import anında donar. */
async function loadAdapter(envOverrides: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) vi.stubEnv(k, '')
    else vi.stubEnv(k, v)
  }
  const mod = await import('@/server/platforms/instagram')
  return mod.instagramAdapter
}

/** Redis'i devre dışı bırakır: önbellek ve avatar deposu yolları sessizleşir. */
vi.mock('@/server/redis', () => ({
  getRedis: () => null,
  isRedisEnabled: () => false,
  RedisRequiredError: class extends Error {},
  assertRedisInProduction: () => undefined,
  closeRedis: async () => undefined,
}))

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function metaOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response
}

function metaError(status: number, code: number) {
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ error: { code, message: 'reddedildi', type: 'OAuthException' } }),
  } as unknown as Response
}

describe('bayrak KAPALI — entegrasyon öncesi davranış birebir korunur', () => {
  it('⚠️ HİÇBİR ağ çağrısı yapılmaz', async () => {
    const adapter = await loadAdapter({ INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: 'false' })
    const out = await adapter.resolve('medya333', 'PROFILE', CTX)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(out.status).toBe('UNVERIFIED')
  })

  it('mesaj ve method entegrasyon öncesiyle aynı', async () => {
    const adapter = await loadAdapter({ INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: 'false' })
    const out = await adapter.resolve('medya333', 'PROFILE', CTX)

    expect(out).toMatchObject({
      status: 'UNVERIFIED',
      method: 'format_only',
      requiresConfirmation: true,
      reason: 'Instagram profilinizi kontrol edin, doğruluğundan emin olun.',
    })
  })

  it('capabilities YALAN SÖYLEMEZ — hepsi false', async () => {
    const adapter = await loadAdapter({ INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: 'false' })
    expect(adapter.capabilities).toEqual({
      verifyProfile: false,
      verifyPost: false,
      followerCount: false,
      thumbnail: false,
      liveMetric: false,
    })
  })

  it('⚠️ bayrak AÇIK ama token/ID yoksa yine ÇAĞRI YAPILMAZ', async () => {
    const adapter = await loadAdapter({
      INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: 'true',
      IG_ACCESS_TOKEN: undefined,
      IG_USER_ID: undefined,
    })
    const out = await adapter.resolve('medya333', 'PROFILE', CTX)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(out.status).toBe('UNVERIFIED')
    expect(adapter.capabilities.followerCount).toBe(false)
  })
})

describe('⚠️ İSTEK URL\'İNİN TAM ŞEKLİ — ölçülür, varsayılmaz', () => {
  const ON = {
    INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: 'true',
    IG_ACCESS_TOKEN: 'test-token-degeri',
    IG_USER_ID: '17841400000000000',
    IG_GRAPH_API_VERSION: 'v25.0',
  }

  /** Casusun yakaladığı URL'i ayrıştırır. */
  async function capture(username = 'bilge.kaganla') {
    fetchSpy.mockResolvedValue(metaOk({ business_discovery: { username } }))
    const adapter = await loadAdapter(ON)
    await adapter.resolve(username, 'PROFILE', CTX)
    const raw = String(fetchSpy.mock.calls[0]?.[0] ?? '')
    return { raw, url: new URL(raw) }
  }

  it('1 · host graph.facebook.com', async () => {
    const { url } = await capture()
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('graph.facebook.com')
  })

  it('2 · ⚠️ PATH hedef kullanıcı adı DEĞİL — OPERATED IG USER ID', async () => {
    const { url } = await capture()
    expect(url.pathname).toBe('/v25.0/17841400000000000')
    // Hedef kullanıcı adı path'te ASLA geçmez; yalnızca query içinde.
    expect(url.pathname).not.toContain('bilge.kaganla')
  })

  it('3 · fields alan genişletmesi doğru biçimde', async () => {
    const { url } = await capture()
    const fields = url.searchParams.get('fields')
    expect(fields).toBe(
      'business_discovery.username(bilge.kaganla)' +
        '{username,name,id,profile_picture_url,biography,followers_count,media_count}',
    )
  })

  it('3b · istenen 7 alanın hepsi sorguda', async () => {
    const { url } = await capture()
    const fields = url.searchParams.get('fields') ?? ''
    for (const f of [
      'username', 'name', 'id', 'profile_picture_url',
      'biography', 'followers_count', 'media_count',
    ]) {
      expect(fields, `${f} eksik`).toContain(f)
    }
  })

  it('access_token query parametresi olarak gider', async () => {
    const { url } = await capture()
    expect(url.searchParams.get('access_token')).toBe(ON.IG_ACCESS_TOKEN)
  })

  it('8 · kullanıcı adı normalize edilmiş hâliyle gönderilir', async () => {
    // `parseTarget` "instagram.com/bilge.kaganla" → "bilge.kaganla" üretir;
    // adapter'a ulaşan değer ZATEN normalize'dir ve olduğu gibi geçirilir.
    const { url } = await capture('bilge.kaganla')
    expect(url.searchParams.get('fields')).toContain('username(bilge.kaganla)')
    expect(url.searchParams.get('fields')).not.toContain('instagram.com')
    expect(url.searchParams.get('fields')).not.toContain('@')
  })

  it('⚠️ biçimsiz kullanıcı adı AĞA HİÇ ÇIKMAZ', async () => {
    const adapter = await loadAdapter(ON)
    for (const bad of ['@bilge', 'a/b', 'x'.repeat(31), 'ali baba', '']) {
      fetchSpy.mockClear()
      const out = await adapter.resolve(bad, 'PROFILE', CTX)
      expect(fetchSpy, `"${bad}" için çağrı yapılmamalı`).not.toHaveBeenCalled()
      expect(out.status).toBe('UNVERIFIED')
    }
  })
})

describe('bayrak AÇIK — gerçek Business Discovery', () => {
  const ON = {
    INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: 'true',
    IG_ACCESS_TOKEN: 'test-token-degeri',
    IG_USER_ID: '17841400000000000',
  }

  it('10 · YEDİ alanı da TargetPreview sözleşmesine taşır', async () => {
    fetchSpy.mockResolvedValue(
      metaOk({
        business_discovery: {
          username: 'medya333',
          name: 'Medya 333',
          id: '17841499999999999',
          biography: 'Sosyal medya tanıtım hizmetleri',
          followers_count: 12345,
          media_count: 87,
          profile_picture_url: 'https://scontent.cdninstagram.com/v/t51/abc.jpg',
        },
      }),
    )
    const adapter = await loadAdapter(ON)
    const out = await adapter.resolve('medya333', 'PROFILE', CTX)

    expect(out.status).toBe('VERIFIED')
    if (out.status !== 'VERIFIED') return
    expect(out.method).toBe('instagram_business_discovery')
    // Doğrudan UI'ın okuduğu alanlar
    expect(out.preview.displayName).toBe('Medya 333')
    expect(out.preview.followerCount).toBe(12345)
    expect(out.preview.handle).toBe('medya333')
    // Kalıcı kimlik → Target.externalId
    expect(out.externalId).toBe('17841499999999999')
    // Sözleşmede alanı olmayanlar `raw` içinde (DB'ye metaSnapshot olarak)
    expect(out.preview.raw).toMatchObject({
      id: '17841499999999999',
      biography: 'Sosyal medya tanıtım hizmetleri',
      mediaCount: 87,
    })
  })

  it('⚠️ Meta CDN adresi preview.avatarUrl içine ASLA konmaz', async () => {
    fetchSpy.mockResolvedValue(
      metaOk({
        business_discovery: {
          username: 'medya333',
          followers_count: 1,
          profile_picture_url: 'https://scontent.cdninstagram.com/v/t51/gizli-imza.jpg',
        },
      }),
    )
    const adapter = await loadAdapter(ON)
    const out = await adapter.resolve('medya333', 'PROFILE', CTX)
    if (out.status !== 'VERIFIED') throw new Error('VERIFIED bekleniyordu')

    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('cdninstagram.com')
    expect(serialized).not.toContain('fbcdn.net')
    // Redis yok → avatar saklanamaz → hotlink'e DÜŞMEZ, null kalır.
    expect(out.preview.avatarUrl).toBeNull()
  })

  it('⚠️ token hiçbir dönüş değerinde görünmez', async () => {
    fetchSpy.mockResolvedValue(metaOk({ business_discovery: { username: 'medya333' } }))
    const adapter = await loadAdapter(ON)
    const out = await adapter.resolve('medya333', 'PROFILE', CTX)

    expect(JSON.stringify(out)).not.toContain(ON.IG_ACCESS_TOKEN)
    expect(JSON.stringify(out)).not.toContain(ON.IG_USER_ID)
  })

  it('eksik alanlar UYDURULMAZ — null kalır', async () => {
    // Meta `name` ve `profile_picture_url` alanlarını GARANTİ ETMİYOR.
    fetchSpy.mockResolvedValue(metaOk({ business_discovery: { username: 'medya333' } }))
    const adapter = await loadAdapter(ON)
    const out = await adapter.resolve('medya333', 'PROFILE', CTX)
    if (out.status !== 'VERIFIED') throw new Error('VERIFIED bekleniyordu')

    expect(out.preview.displayName).toBeNull()
    expect(out.preview.followerCount).toBeNull()
    expect(out.preview.avatarUrl).toBeNull()
  })

  it('capabilities bayrak açıkken doğruyu söyler', async () => {
    const adapter = await loadAdapter(ON)
    expect(adapter.capabilities.verifyProfile).toBe(true)
    expect(adapter.capabilities.followerCount).toBe(true)
  })

  it('⚠️ thumbnail BD AÇIKKEN BİLE false — gönderi görseli alınamıyor', async () => {
    /**
     * Meta, oEmbed'in `thumbnail_url` alanını 3 Kasım 2025'te kaldırdı
     * ("The following fields are no longer returned...") ve
     * `business_discovery` gönderiyi shortcode ile veremiyor. Yani gönderi
     * küçük resmi için resmî bir yol YOK.
     *
     * Bu bayrak API cevabına giriyor; `true` yazmak UI'a yalan söylerdi.
     */
    const adapter = await loadAdapter(ON)
    expect(adapter.capabilities.thumbnail).toBe(false)
    expect(adapter.capabilities.verifyPost).toBe(false)
  })

  it('POST hedefi ASLA VERIFIED dönmez — önizleme uydurulmaz', async () => {
    const adapter = await loadAdapter(ON)
    for (const t of ['POST', 'VIDEO'] as const) {
      fetchSpy.mockClear()
      const out = await adapter.resolve('CxYzAbCdEfG', t, {
        canonicalUrl: 'https://www.instagram.com/p/CxYzAbCdEfG/',
      })
      expect(out.status).toBe('UNVERIFIED')
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  })

  it('POST/VIDEO hedefleri Business Discovery KAPSAMINDA DEĞİL — çağrı yapılmaz', async () => {
    const adapter = await loadAdapter(ON)
    const out = await adapter.resolve('CxYzAbCdEfG', 'POST', {
      canonicalUrl: 'https://www.instagram.com/p/CxYzAbCdEfG/',
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(out.status).toBe('UNVERIFIED')
  })
})

describe('⚠️ her başarısızlık UNVERIFIED\'a düşer — hiçbiri THROW ETMEZ', () => {
  const ON = {
    INSTAGRAM_BUSINESS_DISCOVERY_ENABLED: 'true',
    IG_ACCESS_TOKEN: 'test-token-degeri',
    IG_USER_ID: '17841400000000000',
  }

  const CASES: Array<[string, () => void]> = [
    ['zaman aşımı', () => fetchSpy.mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }))],
    ['ağ hatası', () => fetchSpy.mockRejectedValue(new TypeError('fetch failed'))],
    ['token geçersiz (190)', () => fetchSpy.mockResolvedValue(metaError(400, 190))],
    ['izin yok (200)', () => fetchSpy.mockResolvedValue(metaError(403, 200))],
    ['rate limit (4)', () => fetchSpy.mockResolvedValue(metaError(400, 4))],
    ['rate limit (80002)', () => fetchSpy.mockResolvedValue(metaError(400, 80002))],
    ['hedef kişisel hesap (110)', () => fetchSpy.mockResolvedValue(metaError(400, 110))],
    ['HTTP 500', () => fetchSpy.mockResolvedValue(metaError(500, 0))],
    ['HTTP 429', () => fetchSpy.mockResolvedValue(metaError(429, 0))],
    ['bozuk JSON', () => fetchSpy.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError('bozuk') } } as unknown as Response)],
    ['2xx ama business_discovery yok', () => fetchSpy.mockResolvedValue(metaOk({ id: '123' }))],
  ]

  for (const [label, arrange] of CASES) {
    it(`${label} → UNVERIFIED, çökme yok`, async () => {
      arrange()
      const adapter = await loadAdapter(ON)

      const out = await adapter.resolve('medya333', 'PROFILE', CTX)

      expect(out.status).toBe('UNVERIFIED')
      if (out.status !== 'UNVERIFIED') return
      expect(out.requiresConfirmation).toBe(true)
      expect(out.method).toBe('format_only')
      expect(out.reason.length).toBeGreaterThan(0)
      // ⚠️ Müşteri metninde teknik terim olmaz.
      expect(out.reason).not.toMatch(/API|adapter|token|Meta|Graph|HTTP|\d{3}/)
    })
  }
})
