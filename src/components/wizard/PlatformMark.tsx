import { getBrandMark } from '@/lib/brand/marks'
import { cn } from '@/lib/utils'

/**
 * Platform markası.
 *
 * Sıra: gömülü marka yolu → admin'in yüklediği `iconUrl` → monogram.
 * Yeni platform eklendiğinde ikon olmasa bile temiz bir monogram çıkar;
 * bu yüzden platform eklemek kodda değişiklik gerektirmez.
 */
export function PlatformMark({
  slug,
  name,
  brandColor,
  iconUrl,
  size = 22,
  monochrome = false,
}: {
  slug: string
  name: string
  brandColor?: string | null
  iconUrl?: string | null
  size?: number
  monochrome?: boolean
}) {
  const mark = getBrandMark(slug)
  const color = monochrome ? 'currentColor' : (brandColor ?? mark?.hex ?? 'currentColor')

  if (mark) {
    return (
      <svg
        role="img"
        aria-hidden
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={color}
        className="shrink-0"
      >
        <path d={mark.path} />
      </svg>
    )
  }

  if (iconUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={iconUrl} alt="" width={size} height={size} className="shrink-0" />
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-md font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        color: brandColor ?? 'inherit',
        background: brandColor ? `${brandColor}1A` : 'var(--color-ink-100)',
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

/** Marka renginde yumuşak zeminli ikon kutusu. */
export function PlatformTile({
  slug,
  name,
  brandColor,
  iconUrl,
  className,
}: {
  slug: string
  name: string
  brandColor?: string | null
  iconUrl?: string | null
  className?: string
}) {
  const tint = brandColor ?? getBrandMark(slug)?.hex ?? '#71717a'
  return (
    <span
      className={cn('flex size-11 items-center justify-center rounded-xl', className)}
      style={{ background: `${tint}14` }}
    >
      <PlatformMark slug={slug} name={name} brandColor={tint} iconUrl={iconUrl} size={22} />
    </span>
  )
}
