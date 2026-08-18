import { formatQuantity } from '@/lib/money'
import { computeProgress } from '@/lib/orders/status'
import { cn } from '@/lib/utils'

/**
 * Manuel fulfillment ilerlemesi.
 * Müşteri panelinde ve admin sipariş detayında aynı bileşen kullanılır.
 */
export function ProgressBar({
  quantity,
  deliveredQuantity,
  showLabels = true,
  className,
}: {
  quantity: number
  deliveredQuantity: number
  showLabels?: boolean
  className?: string
}) {
  const { delivered, percent } = computeProgress({ quantity, deliveredQuantity })

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {showLabels && (
        <div className="flex items-baseline justify-between text-small">
          <span className="tabular text-ink-700">
            {formatQuantity(delivered)} / {formatQuantity(quantity)}
          </span>
          <span className="tabular font-medium text-ink-900">%{percent}</span>
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-ink-100"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Sipariş ilerlemesi"
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-[--duration-base] ease-[--ease-out-soft]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
