import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { HeaderNav } from '@/components/layout/HeaderNav'
import { Logo } from '@/components/brand/Logo'
// Tipografi: Inter Variable, TAMAMEN self-host (npm paketi).
// next/font/google yerine bu tercih edildi: derleme Google'a bağımlı olmaz
// (kapalı CI ağlarında build kırılmaz) ve kullanıcı tarayıcısı hiçbir zaman
// Google'a istek atmaz — KVKK açısından da temiz.
import '@fontsource-variable/inter'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Medya 333 — Social Media Growth, Simplified.',
    template: '%s · Medya 333',
  },
  description:
    'Gerçek kullanıcılarla sosyal medya hesabınızı büyütmek için profesyonel tanıtım hizmetleri.',
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'Medya 333',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

const LEGAL_LINKS = [
  { href: '/kvkk-gizlilik', label: 'KVKK / Gizlilik' },
  { href: '/kullanim-kosullari', label: 'Kullanım Koşulları' },
  { href: '/satis-sozlesmesi', label: 'Hizmet / Satış Sözleşmesi' },
  { href: '/iptal-iade', label: 'İptal ve İade' },
  { href: '/cerez-politikasi', label: 'Çerez Politikası' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="flex min-h-dvh flex-col antialiased">
        <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
            <Logo />
            <HeaderNav />
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-ink-200 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-10">
            <p className="text-small text-ink-600">
              Medya 333 hizmetleri <strong className="font-semibold text-ink-800">gerçek kullanıcılar</strong>{' '}
              tarafından manuel olarak gerçekleştirilir. Bot, sahte hesap veya otomatik etkileşim sistemi
              kullanılmaz.
            </p>
            <nav className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-caption">
              {LEGAL_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="text-ink-500 hover:text-ink-800">
                  {l.label}
                </Link>
              ))}
            </nav>
            <p className="mt-6 text-caption text-ink-400">
              © {new Date().getFullYear()} Medya 333. Tüm fiyatlar KDV dahildir.
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
