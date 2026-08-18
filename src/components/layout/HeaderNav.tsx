import Link from 'next/link'
import { getSessionUser } from '@/server/auth'
import { LogoutButton } from './LogoutButton'

/**
 * Üst menü — oturum durumuna göre değişir.
 * Sunucu bileşeni: oturum bilgisi istemciye JS olarak taşınmaz.
 */
export async function HeaderNav() {
  const user = await getSessionUser()

  const linkClass = 'rounded-[--radius-control] px-3 py-2 text-ink-600 hover:bg-ink-100'

  if (!user) {
    return (
      <nav className="flex items-center gap-1 text-small">
        <Link href="/siparis-takip" className={linkClass}>
          Sipariş Takibi
        </Link>
        <Link href="/giris" className={linkClass}>
          Giriş
        </Link>
      </nav>
    )
  }

  return (
    <nav className="flex items-center gap-1 text-small">
      <Link href="/siparis-takip" className={`${linkClass} hidden sm:inline-block`}>
        Sipariş Takibi
      </Link>
      <Link href="/hesabim" className={linkClass}>
        Siparişlerim
      </Link>
      <LogoutButton />
    </nav>
  )
}
