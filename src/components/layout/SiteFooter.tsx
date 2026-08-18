import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'

/**
 * ALT BİLGİ
 *
 * Yasal bağlantılar TEK KAYNAKTAN gelir (`LEGAL_LINKS`); yeni bir yasal metin
 * eklendiğinde burada ve header'da ayrı ayrı güncelleme gerekmez.
 */

const LEGAL_LINKS = [
  { href: '/kvkk-gizlilik', label: 'KVKK / Gizlilik' },
  { href: '/kullanim-kosullari', label: 'Kullanım Koşulları' },
  { href: '/satis-sozlesmesi', label: 'Mesafeli Satış Sözleşmesi' },
  { href: '/iptal-iade', label: 'İptal ve İade' },
  { href: '/cerez-politikasi', label: 'Çerez Politikası' },
] as const

const SERVICE_LINKS = [
  { href: '/#hizmetler', label: 'Tüm hizmetler' },
  { href: '/#siparis', label: 'Sipariş oluştur' },
  { href: '/siparis-takip', label: 'Sipariş takip' },
  { href: '/yardim', label: 'Yardım' },
] as const

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Logo href={null} />
            <p className="mt-3 max-w-sm text-small leading-relaxed text-ink-600">
              Medya 333 hizmetleri{' '}
              <strong className="font-semibold text-ink-800">gerçek kullanıcılar</strong> tarafından
              manuel olarak gerçekleştirilir. Bot, sahte hesap veya otomatik etkileşim sistemi
              kullanılmaz.
            </p>
          </div>

          <FooterColumn title="Hizmetler" links={SERVICE_LINKS} />
          <FooterColumn title="Yasal" links={LEGAL_LINKS} />
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-caption text-ink-400">
            © {new Date().getFullYear()} Medya 333. Tüm fiyatlar KDV dahildir.
          </p>
          <a
            href="mailto:destek@medya333.com"
            className="text-caption text-ink-500 hover:text-ink-800"
          >
            destek@medya333.com
          </a>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({
  title,
  links,
}: {
  title: string
  links: ReadonlyArray<{ href: string; label: string }>
}) {
  return (
    <nav aria-label={title}>
      <h2 className="text-caption font-semibold uppercase tracking-wide text-ink-500">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-small text-ink-600 hover:text-ink-900">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
