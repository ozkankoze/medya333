import { Badge } from '@/components/ui/badge'
import type { FulfillmentStatus } from '@/lib/enums'

/**
 * OPERASYON durum rozeti — İÇ görünüm.
 * Müşteri tarafında bu etiketler KULLANILMAZ; orada
 * `CUSTOMER_FULFILLMENT_VIEW` üzerinden güvenli dile çevrilir.
 */
const META: Record<
  FulfillmentStatus,
  { label: string; tone: 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger' }
> = {
  READY: { label: 'Sırada', tone: 'info' },
  PROCESSING: { label: 'Hazırlanıyor', tone: 'info' },
  STARTED: { label: 'Başladı', tone: 'progress' },
  PARTIAL: { label: 'Kısmi', tone: 'warning' },
  COMPLETED: { label: 'Tamamlandı', tone: 'success' },
  FAILED: { label: 'Başarısız', tone: 'danger' },
  REVIEW_REQUIRED: { label: 'İnceleme', tone: 'warning' },
}

export function FulfillmentStatusBadge({ status }: { status: FulfillmentStatus }) {
  const meta = META[status]
  return (
    <Badge tone={meta.tone} data-testid="fulfillment-badge">
      {meta.label}
    </Badge>
  )
}

export const FULFILLMENT_STATUS_LABEL = Object.fromEntries(
  Object.entries(META).map(([k, v]) => [k, v.label]),
) as Record<FulfillmentStatus, string>
