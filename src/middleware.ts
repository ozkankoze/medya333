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

const PROTECTED_PREFIXES = ['/panel', '/admin', '/hesabim']

/**
 * ⚠️ İKİ AYRI GİRİŞ KAPISI VARDIR.
 *
 *   /giris        → müşteri kapısı (kayıt bağlantısı, misafir akışı)
 *   /admin/giris  → personel kapısı (kayıt YOK)
 *
 * Yönetim panelinden düşen birini müşteri kapısına göndermek yanlıştı:
 * operatör, önünde "Hesabınız yok mu? Kayıt olun" yazan bir müşteri formu
 * buluyordu. Panelin kendi kapısı olmalı ve oraya gitmeli.
 */
const STAFF_LOGIN = '/admin/giris'

/**
 * ⚠️ GİRİŞ SAYFASININ KENDİSİ KORUMA DIŞINDA KALMALIDIR. Kalmasaydı,
 * oturumsuz ziyaretçi /admin/giris → /admin/giris döngüsüne girerdi:
 * yönlendirme hedefi, yönlendirmeyi tetikleyen kuralın kapsamındadır.
 */
const PUBLIC_UNDER_PROTECTED = [STAFF_LOGIN]

// Edge runtime: server-only modül import edilemez, isimler statik tutulur.
// Tek kaynak src/server/auth/cookies.ts — orası değişirse burası da değişmeli
// (tests/unit/schema.test.ts bu ikisini karşılaştırır).
const SESSION_COOKIES = ['medya333.session', '__Secure-medya333.session']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_UNDER_PROTECTED.includes(pathname)) return NextResponse.next()

  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (!needsAuth) return NextResponse.next()

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name))
  if (hasSession) return NextResponse.next()

  // Panelden düşen personel kapısına, müşteri alanından düşen müşteri kapısına.
  const staffArea = pathname === '/admin' || pathname.startsWith('/admin/')

  const url = req.nextUrl.clone()
  url.pathname = staffArea ? STAFF_LOGIN : '/giris'
  url.search = `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(url)
}

export const config = {
  /**
   * ⚠️ `/admin` PANEL SAYFALARIDIR — `/api/v1/admin/**` DEĞİL.
   * Matcher yalnızca sayfa yollarını kapsar; API uçları kendi
   * `adminHandler` sarmalayıcısıyla korunur ve oraya çerez varlığına bakan
   * bir yönlendirme sokmak, JSON bekleyen istemciye HTML giriş sayfası
   * döndürürdü.
   */
  matcher: ['/panel/:path*', '/admin/:path*', '/hesabim/:path*'],
}
