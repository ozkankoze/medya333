import type { OrderStatus } from '@/lib/enums'
import { ORDER_STATUS_META } from '@/lib/orders/status'
import { Badge } from '@/components/ui/badge'

/**
 * Durum rozeti — müşteri paneli VE admin tablosu aynı bileşeni kullanır.
 * Renk/etiket eşlemesi tek kaynaktan (ORDER_STATUS_META) gelir.
 */
export function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status]
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}
