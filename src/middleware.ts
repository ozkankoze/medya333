import { NextResponse, type NextRequest } from 'next/server'

/**
 * MIDDLEWARE — birinci yetkilendirme kapısı (kaba rota koruması).
 *
 * ⚠️ TEK BAŞINA GÜVENLİK DEĞİLDİR. Gerçek kontrol her zaman şurada yapılır:
 *   2. Route handler / server action → requireUser / requireRole
 *   3. Servis katmanı → sorgu kapsamı (`where: { id, userId }`)
 *
 * Burada yalnızca oturum çerezinin VARLIĞI kontrol edilir; rol kontrolü
 * yapılmaz çünkü middleware Edge runtime'da çalışır ve DB'ye erişemez.
 */

const PROTECTED_PREFIXES = ['/panel', '/yonetim', '/hesabim']

// Edge runtime: server-only modül import edilemez, isimler statik tutulur.
// Tek kaynak src/server/auth/cookies.ts — orası değişirse burası da değişmeli
// (tests/unit/schema.test.ts bu ikisini karşılaştırır).
const SESSION_COOKIES = ['medya333.session', '__Secure-medya333.session']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (!needsAuth) return NextResponse.next()

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name))
  if (hasSession) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/giris'
  url.search = `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/panel/:path*', '/yonetim/:path*', '/hesabim/:path*'],
}
