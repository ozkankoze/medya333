import { describe, expect, it } from 'vitest'
import { parseTarget } from '@/lib/platforms/parse'

function ok(r: ReturnType<typeof parseTarget>) {
  if (!r.ok) throw new Error(`beklenen başarı, hata: ${r.reason}`)
  return r
}

describe('Instagram fallback akışı (scraping yok)', () => {
  it('@kullaniciadi → kanonik URL', () => {
    const r = ok(parseTarget('instagram', '@medya333', 'PROFILE'))
    expect(r.normalized).toBe('medya333')
    expect(r.canonicalUrl).toBe('https://www.instagram.com/medya333/')
  })

  it('tam profil URL\'sinden kullanıcı adı çıkarır', () => {
    for (const input of [
      'https://www.instagram.com/medya333/',
      'instagram.com/medya333',
      'http://m.instagram.com/medya333?igshid=abc',
    ]) {
      expect(ok(parseTarget('instagram', input, 'PROFILE')).normalized).toBe('medya333')
    }
  })

  it('gönderi linkinden kod ve hesabı çıkarır', () => {
    const r = ok(parseTarget('instagram', 'https://www.instagram.com/p/CxYzAbCdEfG/', 'POST'))
    expect(r.normalized).toBe('CxYzAbCdEfG')
    expect(r.canonicalUrl).toBe('https://www.instagram.com/p/CxYzAbCdEfG/')
  })

  it('reel linkini destekler', () => {
    const r = ok(parseTarget('instagram', 'instagram.com/medya333/reel/ABC123xyz/', 'POST'))
    expect(r.normalized).toBe('ABC123xyz')
    expect(r.handle).toBe('medya333')
  })

  it('rezerve yolu profil sanmaz', () => {
    const r = parseTarget('instagram', 'instagram.com/explore/tags/kahve', 'PROFILE')
    expect(r.ok).toBe(false)
  })

  it('başka platformun linkini reddeder', () => {
    const r = parseTarget('instagram', 'https://tiktok.com/@medya333', 'PROFILE')
    expect(r.ok).toBe(false)
  })
})

describe('TikTok', () => {
  it('profil', () => {
    expect(ok(parseTarget('tiktok', 'https://www.tiktok.com/@medya333', 'PROFILE')).normalized).toBe('medya333')
  })
  it('video', () => {
    const r = ok(parseTarget('tiktok', 'https://www.tiktok.com/@medya333/video/7301234567890123456', 'VIDEO'))
    expect(r.normalized).toBe('7301234567890123456')
    expect(r.handle).toBe('medya333')
  })
})

describe('YouTube', () => {
  it('watch?v=', () => {
    expect(ok(parseTarget('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'VIDEO')).normalized).toBe('dQw4w9WgXcQ')
  })
  it('youtu.be kısa link', () => {
    expect(ok(parseTarget('youtube', 'https://youtu.be/dQw4w9WgXcQ', 'VIDEO')).normalized).toBe('dQw4w9WgXcQ')
  })
  it('shorts', () => {
    expect(ok(parseTarget('youtube', 'youtube.com/shorts/abc123XYZ', 'VIDEO')).normalized).toBe('abc123XYZ')
  })
  it('@handle kanal', () => {
    const r = ok(parseTarget('youtube', '@medya333', 'CHANNEL'))
    expect(r.canonicalUrl).toBe('https://www.youtube.com/@medya333')
  })
})

describe('X', () => {
  it('twitter.com da kabul edilir, kanonik x.com olur', () => {
    const r = ok(parseTarget('x', 'https://twitter.com/medya333', 'PROFILE'))
    expect(r.canonicalUrl).toBe('https://x.com/medya333')
  })
  it('tweet', () => {
    const r = ok(parseTarget('x', 'x.com/medya333/status/1730000000000000000', 'POST'))
    expect(r.normalized).toBe('1730000000000000000')
  })
})

describe('Telegram', () => {
  it('kanal', () => {
    expect(ok(parseTarget('telegram', 't.me/medya333', 'CHANNEL')).normalized).toBe('medya333')
  })
  it('mesaj', () => {
    const r = ok(parseTarget('telegram', 'https://t.me/medya333/145', 'POST'))
    expect(r.normalized).toBe('medya333/145')
  })
})

describe('genericAdapter fallback (admin panelden yeni eklenen platform)', () => {
  it('bilinmeyen platformda URL normalize edilir, akış durmaz', () => {
    const r = ok(parseTarget('spotify', 'https://open.spotify.com/track/4cOdK?si=xyz&utm_source=copy', 'VIDEO'))
    expect(r.canonicalUrl).toBe('https://open.spotify.com/track/4cOdK')
  })
  it('bilinmeyen platformda düz handle kabul edilir', () => {
    expect(ok(parseTarget('spotify', '@medya333', 'PROFILE')).normalized).toBe('medya333')
  })
})

describe('girdi hijyeni', () => {
  it('boş girdi reddedilir', () => {
    expect(parseTarget('instagram', '   ', 'PROFILE').ok).toBe(false)
  })
  it('aşırı uzun girdi reddedilir', () => {
    expect(parseTarget('instagram', 'a'.repeat(600), 'PROFILE').ok).toBe(false)
  })
  it('geçersiz karakterler reddedilir', () => {
    expect(parseTarget('instagram', '<script>alert(1)</script>', 'PROFILE').ok).toBe(false)
    expect(parseTarget('instagram', "medya'333", 'PROFILE').ok).toBe(false)
  })
  it('hata durumunda kullanıcıya örnek gösterilir', () => {
    const r = parseTarget('instagram', '!!!', 'PROFILE')
    if (r.ok) throw new Error('beklenmedik başarı')
    expect(r.example).toBeTruthy()
    expect(r.reason).toBeTruthy()
  })
})
