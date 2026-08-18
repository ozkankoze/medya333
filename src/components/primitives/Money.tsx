import { formatMinor, formatUnitPriceMinor } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Tüm parasal gösterim BU bileşenden geçer.
 * Böylece "KDV dahil" ibaresi ve biçimlendirme tek yerden yönetilir.
 */
export function Money({
  minor,
  className,
  unit = false,
}: {
  minor: number
  className?: string
  /** Birim fiyat gösterimi — 4 haneye kadar ondalık gösterir */
  unit?: boolean
}) {
  return (
    <span className={cn('tabular', className)}>
      {unit ? formatUnitPriceMinor(minor) : formatMinor(minor)}
    </span>
  )
}

/** Toplam satırı — "KDV dahil" ibaresi yasal olarak burada zorunlu. */
export function TotalMoney({ minor, className }: { minor: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className="tabular text-h2 text-ink-900">{formatMinor(minor)}</span>
      <span className="text-caption text-ink-500">KDV dahil</span>
    </span>
  )
}
