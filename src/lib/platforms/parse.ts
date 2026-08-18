/**
 * ⭐ HEDEF PARSE — SAF, AĞSIZ, İZOMORFİK
 *
 * Ham kullanıcı girdisini kanonik forma çevirir. Ağ çağrısı YAPMAZ.
 * Tarayıcıda anlık geri bildirim, sunucuda doğrulama — aynı kural, tek kod.
 *
 * INSTAGRAM FALLBACK AKIŞI (Faz 0 kararı #2):
 *   Kullanıcı URL girer → normalize edilir → kullanıcı adı çıkarılır
 *   → kullanıcıya kanonik hedef gösterilir → "Bu hedef doğru" onayı
 *   → sipariş devam eder.
 * Scraping YOK. Resmî API desteği ileride eklendiğinde bu katman değişmez;
 * sadece adapter'ın resolve() metodu VERIFIED dönmeye başlar.
 */

import type { TargetType } from '@/lib/enums'

export type ParseResult =
  | {
      ok: true
      /** Kanonik tanımlayıcı: kullanıcı adı, video id, kanal handle vb. */
      normalized: string
      /** Kullanıcıya gösterilecek tam URL — onay ekranının kalbi */
      canonicalUrl: string
      targetType: TargetType
      /** URL'den çıkarılabildiyse hesap adı (gönderi linklerinde de olabilir) */
      handle?: string
    }
  | {
      ok: false
      reason: string
      example: string
    }

// ---------------------------------------------------------------------------
// Ortak yardımcılar
// ---------------------------------------------------------------------------

const MAX_INPUT_LENGTH = 512

function clean(input: string): string {
  return input.trim().replace(/\s+/g, '')
}

/** URL şeması olmadan da çalışan güvenli ayrıştırma. */
function toUrl(input: string): URL | null {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`
  try {
    return new URL(withScheme)
  } catch {
    return null
  }
}

function hostMatches(url: URL, domains: string[]): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

/** URL'den takip/kampanya parametrelerini atar. */
function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}

const HANDLE_RE = /^[A-Za-z0-9._-]{1,64}$/

function normalizeHandle(raw: string): string | null {
  const h = raw.replace(/^@/, '').trim()
  return HANDLE_RE.test(h) ? h : null
}

function fail(reason: string, example: string): ParseResult {
  return { ok: false, reason, example }
}

// ---------------------------------------------------------------------------
// Platform bazlı parse kuralları
// ---------------------------------------------------------------------------

export interface PlatformParseSpec {
  key: string
  /** Kullanıcıya gösterilen ad — hata mesajlarında slug değil bu kullanılır */
  label: string
  domains: string[]
  profileUrl: (handle: string) => string
  /** Profil sayfası olmayan yollar (login, explore vb.) — handle sanılmasın */
  reservedPaths?: string[]
  parsePost?: (url: URL) => { normalized: string; canonicalUrl: string; handle?: string } | null
  postExample?: string
  profileExample?: string
}

const IG_RESERVED = ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']

export const PARSE_SPECS: Record<string, PlatformParseSpec> = {
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    domains: ['instagram.com', 'instagr.am'],
    profileUrl: (h) => `https://www.instagram.com/${h}/`,
    reservedPaths: IG_RESERVED,
    profileExample: 'instagram.com/medya333',
    postExample: 'instagram.com/p/CxYzAbCdEfG/',
    parsePost: (url) => {
      const seg = pathSegments(url)
      const kindIdx = seg.findIndex((s) => s === 'p' || s === 'reel' || s === 'reels' || s === 'tv')
      if (kindIdx === -1) return null
      const code = seg[kindIdx + 1]
      if (!code) return null
      const kind = seg[kindIdx] === 'tv' ? 'tv' : seg[kindIdx] === 'p' ? 'p' : 'reel'
      // /medya333/p/CODE/ biçiminde handle da gelebiliyor
      const handle = kindIdx > 0 ? seg[kindIdx - 1] : undefined
      return {
        normalized: code,
        canonicalUrl: `https://www.instagram.com/${kind}/${code}/`,
        handle,
      }
    },
  },

  tiktok: {
    key: 'tiktok',
    label: 'TikTok',
    domains: ['tiktok.com', 'vm.tiktok.com'],
    profileUrl: (h) => `https://www.tiktok.com/@${h}`,
    reservedPaths: ['video', 'explore', 'foryou', 'live', 'tag', 'music'],
    profileExample: 'tiktok.com/@medya333',
    postExample: 'tiktok.com/@medya333/video/7301234567890123456',
    parsePost: (url) => {
      const seg = pathSegments(url)
      const vIdx = seg.indexOf('video')
      if (vIdx === -1) return null
      const id = seg[vIdx + 1]
      if (!id || !/^\d{5,32}$/.test(id)) return null
      const handleSeg = seg[vIdx - 1]
      const handle = handleSeg?.startsWith('@') ? handleSeg.slice(1) : undefined
      return {
        normalized: id,
        canonicalUrl: handle
          ? `https://www.tiktok.com/@${handle}/video/${id}`
          : `https://www.tiktok.com/video/${id}`,
        handle,
      }
    },
  },

  youtube: {
    key: 'youtube',
    label: 'YouTube',
    domains: ['youtube.com', 'youtu.be', 'm.youtube.com'],
    profileUrl: (h) => `https://www.youtube.com/@${h}`,
    reservedPaths: ['watch', 'shorts', 'playlist', 'results', 'feed', 'channel', 'c', 'user'],
    profileExample: 'youtube.com/@medya333',
    postExample: 'youtube.com/watch?v=dQw4w9WgXcQ',
    parsePost: (url) => {
      // youtu.be/ID
      if (hostMatches(url, ['youtu.be'])) {
        const id = pathSegments(url)[0]
        if (id && /^[\w-]{6,20}$/.test(id)) {
          return { normalized: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` }
        }
        return null
      }
      const v = url.searchParams.get('v')
      if (v && /^[\w-]{6,20}$/.test(v)) {
        return { normalized: v, canonicalUrl: `https://www.youtube.com/watch?v=${v}` }
      }
      const seg = pathSegments(url)
      const sIdx = seg.indexOf('shorts')
      if (sIdx !== -1) {
        const id = seg[sIdx + 1]
        if (id && /^[\w-]{6,20}$/.test(id)) {
          return { normalized: id, canonicalUrl: `https://www.youtube.com/shorts/${id}` }
        }
      }
      return null
    },
  },

  x: {
    key: 'x',
    label: 'X',
    domains: ['x.com', 'twitter.com'],
    profileUrl: (h) => `https://x.com/${h}`,
    reservedPaths: ['i', 'home', 'explore', 'search', 'notifications', 'messages', 'settings'],
    profileExample: 'x.com/medya333',
    postExample: 'x.com/medya333/status/1730000000000000000',
    parsePost: (url) => {
      const seg = pathSegments(url)
      const sIdx = seg.indexOf('status')
      if (sIdx === -1) return null
      const id = seg[sIdx + 1]
      if (!id || !/^\d{5,32}$/.test(id)) return null
      const handle = sIdx > 0 ? seg[sIdx - 1] : undefined
      return {
        normalized: id,
        canonicalUrl: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
        handle,
      }
    },
  },

  facebook: {
    key: 'facebook',
    label: 'Facebook',
    domains: ['facebook.com', 'fb.com', 'fb.watch'],
    profileUrl: (h) => `https://www.facebook.com/${h}`,
    reservedPaths: ['posts', 'photo', 'watch', 'videos', 'profile.php', 'groups', 'pages'],
    profileExample: 'facebook.com/medya333',
    postExample: 'facebook.com/medya333/posts/123456789',
    parsePost: (url) => {
      const seg = pathSegments(url)
      const pIdx = seg.findIndex((s) => s === 'posts' || s === 'videos' || s === 'photos')
      if (pIdx === -1) return null
      const id = seg[pIdx + 1]
      if (!id) return null
      const handle = pIdx > 0 ? seg[pIdx - 1] : undefined
      return {
        normalized: id,
        canonicalUrl: handle
          ? `https://www.facebook.com/${handle}/${seg[pIdx]}/${id}`
          : `https://www.facebook.com/${seg[pIdx]}/${id}`,
        handle,
      }
    },
  },

  telegram: {
    key: 'telegram',
    label: 'Telegram',
    domains: ['t.me', 'telegram.me'],
    profileUrl: (h) => `https://t.me/${h}`,
    reservedPaths: ['s', 'joinchat', 'addstickers', 'proxy'],
    profileExample: 't.me/medya333',
    postExample: 't.me/medya333/145',
    parsePost: (url) => {
      const seg = pathSegments(url).filter((s) => s !== 's')
      if (seg.length < 2) return null
      const [handle, msgId] = seg
      if (!handle || !msgId || !/^\d+$/.test(msgId)) return null
      return {
        normalized: `${handle}/${msgId}`,
        canonicalUrl: `https://t.me/${handle}/${msgId}`,
        handle,
      }
    },
  },
}

// ---------------------------------------------------------------------------
// ANA PARSE FONKSİYONU
// ---------------------------------------------------------------------------

export function parseTarget(
  adapterKey: string,
  input: string,
  targetType: TargetType,
): ParseResult {
  const raw = clean(input)

  if (!raw) return fail('Lütfen bir hedef girin.', 'instagram.com/medya333')
  if (raw.length > MAX_INPUT_LENGTH) {
    return fail('Girdi çok uzun.', 'instagram.com/medya333')
  }

  const spec = PARSE_SPECS[adapterKey]

  // Bilinmeyen platform (admin panelden yeni eklenmiş, adapter'ı yok):
  // genel URL/handle normalizasyonu uygulanır, akış durmaz.
  if (!spec) return parseGeneric(raw, targetType)

  const wantsPost = targetType === 'POST' || targetType === 'VIDEO'
  const url = toUrl(raw)
  const looksLikeUrl = raw.includes('/') || raw.includes('.')

  // --- Gönderi / video hedefi ---
  if (wantsPost) {
    if (!url || !hostMatches(url, spec.domains)) {
      return fail(
        'Geçerli bir gönderi/video bağlantısı girin.',
        spec.postExample ?? spec.profileExample ?? '',
      )
    }
    const post = spec.parsePost?.(url)
    if (!post) {
      return fail(
        'Bağlantıdan gönderi kimliği çıkarılamadı. Tarayıcıdaki tam adresi yapıştırın.',
        spec.postExample ?? '',
      )
    }
    return {
      ok: true,
      normalized: post.normalized,
      canonicalUrl: post.canonicalUrl,
      targetType,
      ...(post.handle ? { handle: post.handle } : {}),
    }
  }

  // --- Profil / kanal / grup hedefi ---
  // 1) Tam URL verildiyse yoldan handle çıkar
  if (url && looksLikeUrl && hostMatches(url, spec.domains)) {
    const seg = pathSegments(url)
    const first = seg[0]
    if (!first) {
      return fail('Bağlantıda kullanıcı adı bulunamadı.', spec.profileExample ?? '')
    }
    if (spec.reservedPaths?.includes(first)) {
      return fail(
        'Bu bir profil bağlantısı değil. Profil sayfasının adresini yapıştırın.',
        spec.profileExample ?? '',
      )
    }
    const handle = normalizeHandle(first)
    if (!handle) {
      return fail('Kullanıcı adı geçersiz karakterler içeriyor.', spec.profileExample ?? '')
    }
    return {
      ok: true,
      normalized: handle,
      canonicalUrl: spec.profileUrl(handle),
      targetType,
      handle,
    }
  }

  // 2) Başka bir alan adına ait URL girilmişse net hata ver
  if (url && looksLikeUrl && !hostMatches(url, spec.domains)) {
    return fail(
      `Bu bağlantı ${spec.label} adresine ait görünmüyor.`,
      spec.profileExample ?? '',
    )
  }

  // 3) Düz kullanıcı adı / @kullaniciadi
  const handle = normalizeHandle(raw)
  if (!handle) {
    return fail(
      'Kullanıcı adı yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir.',
      spec.profileExample ?? '',
    )
  }
  return {
    ok: true,
    normalized: handle,
    canonicalUrl: spec.profileUrl(handle),
    targetType,
    handle,
  }
}

/** Adapter'ı olmayan platformlar için genel normalizasyon. */
function parseGeneric(raw: string, targetType: TargetType): ParseResult {
  const url = toUrl(raw)
  if (url && (raw.includes('/') || raw.includes('.'))) {
    // Takip parametrelerini temizle
    const cleanedUrl = new URL(url.toString())
    for (const key of [...cleanedUrl.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|si$)/i.test(key)) cleanedUrl.searchParams.delete(key)
    }
    const canonical = cleanedUrl.toString().replace(/\/$/, '')
    return {
      ok: true,
      normalized: canonical,
      canonicalUrl: canonical,
      targetType,
    }
  }
  const handle = normalizeHandle(raw)
  if (!handle) {
    return fail('Geçerli bir bağlantı veya kullanıcı adı girin.', 'ornek.com/kullaniciadi')
  }
  return { ok: true, normalized: handle, canonicalUrl: handle, targetType, handle }
}
