import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * MEDYA 333 LOGO
 *
 * ⚠️ ŞU AN SADECE WORDMARK (düz yazı). Resmî marka asset'i elimizde olmadığı
 * için logo TASARLANMADI veya uydurulmadı.
 *
 * GERÇEK LOGO GELDİĞİNDE: yalnızca bu dosya değişir. Kullanan hiçbir yer
 * (header, footer, e-posta şablonları, OG görseli) dokunulmaz.
 *
 *   1. SVG'yi `public/brand/logo.svg` ve `logo-mark.svg` olarak koyun
 *   2. Aşağıdaki `Wordmark` gövdesini <Image src="/brand/logo.svg" .../> ile değiştirin
 *   3. `variant="mark"` dalını mark SVG'siyle doldurun (favicon, mobil, avatar)
 */

export type LogoVariant = 'wordmark' | 'mark'

export interface LogoProps {
  variant?: LogoVariant
  /** Link olarak mı render edilsin? Footer'da bazen düz metin istenir. */
  href?: string | null
  className?: string
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-h3 font-bold tracking-tight text-ink-900', className)}>
      Medya<span className="text-brand-600"> 333</span>
    </span>
  )
}

function Mark({ className }: { className?: string }) {
  // Gerçek marka işareti gelene kadar wordmark'ın kısaltması kullanılır.
  return (
    <span
      className={cn(
        'flex size-8 items-center justify-center rounded-lg bg-brand-600 text-caption font-bold text-white',
        className,
      )}
    >
      333
    </span>
  )
}

export function Logo({ variant = 'wordmark', href = '/', className }: LogoProps) {
  const content = variant === 'mark' ? <Mark /> : <Wordmark />

  if (!href) {
    return (
      <span className={className} aria-label="Medya 333">
        {content}
      </span>
    )
  }

  return (
    <Link
      href={href}
      aria-label="Medya 333 ana sayfa"
      className={cn(
        'inline-flex items-center rounded-[--radius-control]',
        'transition-opacity duration-[--duration-fast] hover:opacity-80',
        className,
      )}
    >
      {content}
    </Link>
  )
}
