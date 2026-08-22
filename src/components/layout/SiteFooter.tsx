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
    /**
     * ⚠️ ALT BİLGİ KOYU — başlıkla aynı yüzey. Sayfa böylece koyu bir
     * çerçeve içinde duruyor ve tam logo (CREATIVE AGENCY satırı dahil)
     * kendi zemininde, okunur boyutta yer alabiliyor.
     */
    <footer className="relative bg-ink-975">
      <span
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/45 to-transparent"
        aria-hidden
      />
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Logo href={null} variant="full" />
            <p className="mt-5 max-w-sm text-small leading-relaxed text-white/60">
              Medya 333, sosyal medyadaki{' '}
              <strong className="font-semibold text-white">gelişiminizi destekler.</strong> Doğru
              hizmeti seçin, hedefinizi girin, ilerlemeyi adım adım izleyin.
            </p>
          </div>

          <FooterColumn title="Hizmetler" links={SERVICE_LINKS} />
          <FooterColumn title="Yasal" links={LEGAL_LINKS} />
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-caption text-white/40">
            © {new Date().getFullYear()} Medya 333. Tüm fiyatlar KDV dahildir.
          </p>
          <a
            href="mailto:destek@medya333.com"
            className="text-caption text-white/60 transition-colors duration-[--duration-fast] hover:text-gold-300"
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
      <h2 className="text-caption font-semibold uppercase tracking-wider text-gold-400/80">
        {title}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="text-small text-white/60 transition-colors duration-[--duration-fast] hover:text-white"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
