import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth'
import { LogoutButton } from './LogoutButton'

/**
 * ÜST MENÜ
 *
 * ⚠️ SUNUCU BİLEŞENİ. Oturum bilgisi istemciye JS olarak taşınmaz ve menü
 * için hiçbir client bundle eklenmez — mobil açılır menü `<details>` ile
 * kurulur, React state'i gerektirmez. (Yalnızca "Çıkış" düğmesi client'tır;
 * oturum satırını SUNUCUDA silmek için bir isteğe ihtiyaç duyar.)
 */

const NAV = [
  { href: '/#hizmetler', label: 'Hizmetler' },
  { href: '/siparis-takip', label: 'Sipariş Takip' },
  { href: '/yardim', label: 'Yardım' },
] as const

export async function SiteHeader() {
  const user = await getSessionUser()

  const linkClass =
    'rounded-[--radius-control] px-3 py-2 text-small text-ink-600 transition-colors ' +
    'duration-[--duration-fast] hover:bg-ink-100 hover:text-ink-900'

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
        <Logo />

        {/* --------------------------- Masaüstü menü --------------------------- */}
        <nav aria-label="Ana menü" className="ml-6 hidden items-center gap-0.5 md:flex">
          {NAV.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {user ? (
            <>
              <Link href="/hesabim" className={`${linkClass} hidden sm:inline-block`}>
                Siparişlerim
              </Link>
              <span className="hidden sm:inline-block">
                <LogoutButton />
              </span>
              <Link
                href="/#siparis"
                className={`${buttonVariants({ size: 'sm' })} hidden sm:inline-flex`}
              >
                Yeni Sipariş
              </Link>
            </>
          ) : (
            <>
              <Link href="/giris" className={`${linkClass} hidden sm:inline-block`}>
                Giriş
              </Link>
              <Link
                href="/#siparis"
                className={`${buttonVariants({ size: 'sm' })} hidden sm:inline-flex`}
              >
                Şimdi Başla
              </Link>
            </>
          )}

          {/* ----------------------------- Mobil menü ---------------------------- */}
          <details className="relative sm:hidden [&[open]>summary_svg]:rotate-90">
            <summary
              className="flex size-11 cursor-pointer list-none items-center justify-center rounded-[--radius-control] text-ink-700 hover:bg-ink-100"
              aria-label="Menü"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="transition-transform duration-[--duration-fast]"
                aria-hidden
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <nav
              aria-label="Mobil menü"
              className="absolute right-0 top-full z-50 mt-2 w-60 rounded-[--radius-card] border border-ink-200 bg-white p-2 shadow-[--shadow-drawer]"
            >
              {NAV.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="block rounded-[--radius-control] px-3 py-3 text-small text-ink-700 hover:bg-ink-100"
                >
                  {l.label}
                </Link>
              ))}
              <div className="my-1 h-px bg-ink-200" />
              {user ? (
                <>
                  <Link
                    href="/hesabim"
                    className="block rounded-[--radius-control] px-3 py-3 text-small text-ink-700 hover:bg-ink-100"
                  >
                    Siparişlerim
                  </Link>
                  <LogoutButton />
                </>
              ) : (
                <Link
                  href="/giris"
                  className="block rounded-[--radius-control] px-3 py-3 text-small text-ink-700 hover:bg-ink-100"
                >
                  Giriş yap
                </Link>
              )}
              <Link href="/#siparis" className={`${buttonVariants({ block: true })} mt-2`}>
                Şimdi Başla
              </Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  )
}
