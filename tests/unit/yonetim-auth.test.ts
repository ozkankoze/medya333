import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

/**
 * ⭐ YÖNETİM PANELİ KAPISI — MÜŞTERİ GİRİŞİNDEN AYRILMASI
 *
 * Kusur şuydu: oturumsuz bir ziyaretçi /yonetim/kasa'ya gittiğinde MÜŞTERİ
 * giriş sayfasına (/giris) düşüyordu. O sayfada "Hesabınız yok mu? Kayıt
 * olun" ve "misafir olarak sipariş verin" bağlantıları vardır — panele
 * girmeye çalışan biri için hem yanıltıcı hem yanlış kapıdır.
 *
 * Buradaki testlerin bir kısmı GERÇEK DAVRANIŞI ölçer (middleware doğrudan
 * çağrılır), bir kısmı KAYNAK KODU tarar. İkincisi zayıf bir kanıttır ve
 * yalnızca çalıştırmak için canlı veritabanı gereken yerlerde kullanılır.
 */

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'src')
const YONETIM = path.join(SRC, 'app/yonetim')
const read = (p: string) => readFileSync(p, 'utf8')

/**
 * ⚠️ YASAKLI DİZE ARAYAN TESTLER YORUMLARI ÇIKARMALIDIR.
 *
 * Bu tam olarak buraya düştü: "kayıt bağlantısı YOKTUR ve olmamalıdır"
 * diyen açıklama satırının kendisi, "Kayıt ol" araması tarafından ihlal
 * sayıldı. Yani dosya doğruydu, testi bozan şey dosyanın kendi
 * belgelendirmesiydi. (Aynı tuzak `production-audit.test.ts` içinde de
 * belgelenmiş durumda.)
 */
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const readCode = (p: string) => stripComments(read(p))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/** Middleware'i gerçek bir istekle çalıştırır ve `Location` başlığını verir. */
function redirectFor(pathname: string, opts: { session?: boolean } = {}): string | null {
  const req = new NextRequest(new URL(`https://www.medya333.com${pathname}`), {
    headers: opts.session ? { cookie: 'medya333.session=deneme-token' } : undefined,
  })
  const res = middleware(req)
  if (res.status !== 307 && res.status !== 308) return null
  const loc = res.headers.get('location')
  return loc ? new URL(loc).pathname + new URL(loc).search : null
}

// ===========================================================================
describe('middleware — hangi kapıya yönlendiriyor', () => {
  it('⚠️ /yonetim altındaki sayfalar PERSONEL kapısına gider, müşteri kapısına DEĞİL', () => {
    for (const p of [
      '/yonetim',
      '/yonetim/fulfillment',
      '/yonetim/kasa',
      '/yonetim/kasa/paketler',
      '/yonetim/kullanicilar',
    ]) {
      const to = redirectFor(p)
      expect(to, `${p} yönlendirilmedi`).not.toBeNull()
      expect(to!.split('?')[0], `${p} yanlış kapıya gitti`).toBe('/yonetim/giris')
      // Nereye dönüleceği korunur — giriş sonrası kullanıcı istediği sayfada olmalı.
      expect(to).toContain(`next=${encodeURIComponent(p)}`)
    }
  })

  it('müşteri alanı ESKİSİ GİBİ müşteri kapısına gider', () => {
    for (const p of ['/hesabim', '/panel', '/panel/siparisler']) {
      const to = redirectFor(p)
      expect(to, `${p} yönlendirilmedi`).not.toBeNull()
      expect(to!.split('?')[0], `${p} personel kapısına kaydı`).toBe('/giris')
    }
  })

  it('⚠️ /yonetim/giris KENDİSİ korumasızdır (yoksa sonsuz döngü)', () => {
    /**
     * Bu tam olarak gözden kaçabilecek hata: yönlendirmenin HEDEFİ,
     * yönlendirmeyi tetikleyen kuralın KAPSAMINDA. Dışarıda bırakılmazsa
     * oturumsuz ziyaretçi /yonetim/giris → /yonetim/giris → … döner ve
     * tarayıcı "çok fazla yönlendirme" hatası verir.
     */
    expect(redirectFor('/yonetim/giris')).toBeNull()
    expect(redirectFor('/yonetim/giris?next=/yonetim/kasa')).toBeNull()
  })

  it('oturum çerezi varsa middleware karışmaz (rol kontrolü sunucuda)', () => {
    expect(redirectFor('/yonetim/kasa', { session: true })).toBeNull()
  })

  it('korumasız yollar etkilenmedi', () => {
    for (const p of ['/', '/hizmetler', '/giris', '/siparis-takip']) {
      expect(redirectFor(p), `${p} yönlendirildi`).toBeNull()
    }
  })
})

// ===========================================================================
describe('sayfa yapısı', () => {
  it('⚠️ giriş sayfası (panel) düzeninin DIŞINDA duruyor', () => {
    // Düzenin içinde olsaydı, düzen onu tekrar kendisine yönlendirirdi.
    expect(existsSync(path.join(YONETIM, 'giris/page.tsx'))).toBe(true)
    expect(existsSync(path.join(YONETIM, '(panel)/giris/page.tsx'))).toBe(false)
    expect(existsSync(path.join(YONETIM, '(panel)/layout.tsx'))).toBe(true)
    // Grup düzeyinde olmayan bir layout, giriş sayfasını da sarardı.
    expect(existsSync(path.join(YONETIM, 'layout.tsx'))).toBe(false)
  })

  it('⚠️ panel sayfalarının HİÇBİRİ müşteri giriş sayfasına yönlendirmiyor', () => {
    const offenders = walk(path.join(YONETIM, '(panel)')).filter((p) =>
      /redirect\(\s*['"]\/giris/.test(read(p)),
    )
    expect(offenders.map((p) => path.relative(ROOT, p))).toEqual([])
  })

  it('panel sayfaları oturumsuz isteği personel kapısına yolluyor', () => {
    const pages = walk(path.join(YONETIM, '(panel)')).filter((p) => p.endsWith('page.tsx'))
    expect(pages.length).toBeGreaterThan(5)
    for (const p of pages) {
      const body = read(p)
      if (!body.includes('getSessionUser')) continue
      expect(body, `${path.relative(ROOT, p)} kapıyı işaret etmiyor`).toContain('/yonetim/giris')
    }
  })
})

// ===========================================================================
describe('personel giriş sayfası', () => {
  const page = readCode(path.join(YONETIM, 'giris/page.tsx'))
  const form = readCode(path.join(YONETIM, 'giris/StaffLoginForm.tsx'))

  it('⚠️ KAYIT SEÇENEĞİ YOK — panel hesabı kendi kendine açılmaz', () => {
    for (const banned of ['/kayit', 'Kayıt ol', 'auth/register', 'Hesap Oluştur']) {
      expect(page, `giriş sayfasında "${banned}"`).not.toContain(banned)
      expect(form, `formda "${banned}"`).not.toContain(banned)
    }
  })

  it('⚠️ müşteri akışı bağlantıları taşınmadı', () => {
    // Müşteri kapısındaki misafir/sipariş hatırlatmaları burada yeri olmayan
    // davetlerdir; kopyala-yapıştır ile sızmadıklarını sabitliyoruz.
    for (const banned of ['/siparis-takip', '#siparis', 'Misafir']) {
      expect(form, `formda "${banned}"`).not.toContain(banned)
    }
  })

  it('arama motorlarına kapalı', () => {
    expect(page).toContain('index: false')
  })

  it('kendi ucuna gider — müşteri giriş ucuna DEĞİL', () => {
    expect(form).toContain("'/api/v1/auth/yonetim'")
    expect(form).not.toContain("'/api/v1/auth/login'")
  })

  it('⚠️ açık yönlendirme engeli /yonetim ile SINIRLI', () => {
    // Müşteri kapısı site içi her yolu kabul eder; personel kapısının
    // gideceği yer tanımı gereği paneldir, dolayısıyla daha dar olmalı.
    expect(page).toContain('/^\\/yonetim\\/[a-zA-Z0-9\\-/_]*$/')
  })
})

// ===========================================================================
describe('personel giriş ucu', () => {
  const route = readCode(path.join(SRC, 'app/api/v1/auth/yonetim/route.ts'))

  it('⚠️ ROL KONTROLÜ VAR — müşteri kimliğiyle bu kapıdan oturum açılamaz', () => {
    expect(route).toContain('ROLE_LEVEL[user.role] < ROLE_LEVEL.SUPPORT')
  })

  it('⚠️ rol kontrolü OTURUM AÇILMADAN ÖNCE gelir', () => {
    /**
     * Sıra ters olsaydı çerez yazılır, sonra reddedilirdi: yetkisiz
     * kullanıcı geçerli bir oturumla ortada kalırdı.
     */
    const roleCheck = route.indexOf('< ROLE_LEVEL.SUPPORT')
    const session = route.indexOf('await createDbSession(')
    expect(roleCheck).toBeGreaterThan(-1)
    expect(session).toBeGreaterThan(-1)
    expect(roleCheck, 'oturum rol kontrolünden ÖNCE açılıyor').toBeLessThan(session)
  })

  it('⚠️ şifre doğrulaması rol kontrolünden ÖNCE gelir (zamanlama kanalı)', () => {
    // Aksi hâlde yetersiz rollü hesaplar argon2'yi atlar ve cevap ölçülebilir
    // biçimde hızlanır — bu, şifreyi bilmeden "bu hesap personel mi?"
    // sorusunu yanıtlar.
    const verify = route.indexOf('await verifyPassword(')
    const roleCheck = route.indexOf('< ROLE_LEVEL.SUPPORT')
    expect(verify).toBeGreaterThan(-1)
    expect(verify, 'rol kontrolü şifreden önce').toBeLessThan(roleCheck)
  })

  it('⚠️ üç başarısızlık TEK mesaj döndürür (hesap sayımı engeli)', () => {
    // "Bu hesap personel değil" demek, saldırgana şifreyi doğru bildiğini
    // söylerdi. E-posta yok / şifre yanlış / rol yetersiz aynı cevabı alır.
    const messages = [...route.matchAll(/apiError\('INVALID_CREDENTIALS', '([^']+)'/g)].map(
      (m) => m[1],
    )
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(new Set(messages).size, 'farklı reddetme mesajları var').toBe(1)
  })

  it('CSRF ve rate limit uygulanıyor, kova müşteri girişinden AYRI', () => {
    expect(route).toContain('assertSameOrigin(req)')
    expect(route).toContain("rateLimit('auth.yonetim.ip'")
    expect(route).not.toContain("'auth.login.ip'")
    const rl = read(path.join(SRC, 'server/ratelimit.ts'))
    expect(rl).toContain("'auth.yonetim.ip'")
  })

  it('reddedilen personel denemesi denetim kaydına düşüyor', () => {
    expect(route).toContain("action: 'auth.yonetim.denied'")
  })

  it('⚠️ bu uç KAYIT YAPMAZ', () => {
    // ⚠️ `passwordHash` BURADA YASAK DEĞİL: uç onu okumak zorunda (doğrulama
    //    için). Yasak olan, hesap OLUŞTURAN çağrılar.
    for (const banned of ['db.user.create', 'registerSchema', 'hashPassword']) {
      expect(route, `personel ucunda "${banned}"`).not.toContain(banned)
    }
  })
})

// ===========================================================================
describe('müşteri akışı bozulmadı', () => {
  it('müşteri giriş/kayıt sayfaları ve uçları yerinde', () => {
    for (const p of [
      'app/(auth)/giris/page.tsx',
      'app/(auth)/kayit/page.tsx',
      'app/api/v1/auth/login/route.ts',
      'app/api/v1/auth/register/route.ts',
    ]) {
      expect(existsSync(path.join(SRC, p)), `${p} kayboldu`).toBe(true)
    }
  })

  it('müşteri giriş ucu rol kontrolü KAZANMADI', () => {
    // Personel kapısına eklenen rol kapısının müşteri kapısına sızması,
    // tüm müşterilerin girişini sessizce kapatırdı.
    const login = read(path.join(SRC, 'app/api/v1/auth/login/route.ts'))
    expect(login).not.toContain('ROLE_LEVEL')
  })

  it('iki kapı AYNI oturum mekanizmasını kullanıyor', () => {
    // Ayrı bir oturum modeli kurmak, birinin iptal edilip diğerinin canlı
    // kalmasına yol açardı.
    const staff = read(path.join(SRC, 'app/api/v1/auth/yonetim/route.ts'))
    expect(staff).toContain("from '@/server/auth/session'")
    expect(staff).toContain('createDbSession')
  })
})
