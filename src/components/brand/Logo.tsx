import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import markSrc from '../../../public/brand/medya333-mark.png'
import fullSrc from '../../../public/brand/medya333-full.png'

/**
 * MEDYA 333 LOGO — GERÇEK MARKA VARLIĞI
 *
 * Artık tipografik taklit değil; `public/brand/` altındaki gerçek logo
 * kullanılıyor. Kaynak dosya koyu zeminli bir mockup olduğu için arka planı
 * parlaklık kanalından alfaya çevrilerek SAYDAM hâle getirildi; böylece aynı
 * dosya başlıkta, alt bilgide ve plaka içinde tek renk zemin varsaymadan
 * çalışıyor.
 *
 * ⚠️ ALTIN LOGO AÇIK ZEMİNDE OKUNMAZ. Metalik altının beyaz üstündeki
 * kontrastı ~2:1'dir. Bu yüzden iki kullanım biçimi vardır ve üçüncüsü YOKTUR:
 *
 *   1. Koyu yüzey üzerinde çıplak logo   → başlık, alt bilgi, hero bandı
 *   2. `plate` → koyu yuvarlatılmış plaka → açık sayfalarda (giriş/kayıt)
 *
 * Logoyu açık bir yüzeye plakasız koymak markayı soluk gösterir; yapmayın.
 *
 * ⚠️ İKİ KİLİT VAR:
 *   · `wordmark` (varsayılan) = 333 + MEDYA. Başlıkta kullanılır: 40px'te
 *     "CREATIVE AGENCY" satırı okunmaz hâle geldiği için o satır kırpılmıştır.
 *   · `full` = 333 + MEDYA + ayraç + CREATIVE AGENCY. Yalnızca 56px ve
 *     üzerinde, yani alt bilgide kullanılır.
 */

export type LogoVariant = 'wordmark' | 'full'

export interface LogoProps {
  variant?: LogoVariant
  /** Link olarak mı render edilsin? Alt bilgide düz metin istenir. */
  href?: string | null
  /** Açık zeminde kullanmak için koyu plaka. */
  plate?: boolean
  className?: string
}

/** Görüntülenen yükseklik (px). Genişlik oranla hesaplanır — asla ezilmez. */
const HEIGHT: Record<LogoVariant, number> = { wordmark: 44, full: 68 }

function Glyph({ variant }: { variant: LogoVariant }) {
  const src = variant === 'full' ? fullSrc : markSrc
  const height = HEIGHT[variant]
  const width = Math.round((src.width / src.height) * height)

  return (
    <Image
      src={src}
      alt="Medya 333"
      width={width}
      height={height}
      // Başlıkta ilk boyanan öğe; geç yüklenirse marka "atlıyor" gibi görünür.
      priority
      sizes={`${width}px`}
      className="h-auto w-auto select-none"
      style={{ height, width }}
    />
  )
}

export function Logo({ variant = 'wordmark', href = '/', plate = false, className }: LogoProps) {
  const glyph = <Glyph variant={variant} />

  const content = plate ? (
    <span className="relative inline-flex items-center overflow-hidden rounded-[--radius-card] bg-ink-975 px-5 py-3.5">
      {/* Altın hairline — plakanın tek detayı, logodaki ayraçla aynı dil */}
      <span
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent"
        aria-hidden
      />
      {glyph}
    </span>
  ) : (
    glyph
  )

  if (!href) {
    return <span className={cn('inline-flex items-center', className)}>{content}</span>
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
