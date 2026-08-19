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

/**
 * ⭐ OPERASYON OLAYI ETİKETLERİ (Faz 8)
 *
 * ⚠️ İÇ EKRAN İÇİN. Operatör ham enum adı (`PROGRESS_UPDATED`) yerine Türkçe
 * okur; hata payı düşer ve devir teslim kolaylaşır. Müşteri yüzeyinde bu
 * etiketler KULLANILMAZ — orada `CUSTOMER_FULFILLMENT_VIEW` geçerlidir.
 */
export const FULFILLMENT_EVENT_LABEL: Record<string, string> = {
  CREATED: 'İş oluşturuldu',
  ASSIGNED: 'Operatöre atandı',
  REASSIGNED: 'Operatör değiştirildi',
  STARTED: 'İşlem başlatıldı',
  PROGRESS_UPDATED: 'İlerleme kaydedildi',
  METRIC_DECREASED: 'Ölçüm geriye düştü',
  PARTIAL_DELIVERY: 'Kısmi teslim',
  NOTE_ADDED: 'Not eklendi',
  COMPLETED: 'Tamamlandı',
  FAILED: 'Başarısız',
  REVIEW_REQUIRED: 'İncelemeye alındı',
  REPLACEMENT_CREATED: 'Telafi vakası açıldı',
  REPLACEMENT_APPROVED: 'Telafi onaylandı',
  REPLACEMENT_STARTED: 'Telafi başlatıldı',
  REPLACEMENT_COMPLETED: 'Telafi tamamlandı',
}

/** Telafi vakası durumları — iç ekran. */
export const REPLACEMENT_STATUS_LABEL: Record<string, string> = {
  DROP_DETECTED: 'Düşüş tespit edildi',
  REVIEW_REQUIRED: 'İnceleme bekliyor',
  APPROVED: 'Onaylandı',
  REPLACEMENT_PROCESSING: 'Telafi işleniyor',
  COMPLETED: 'Tamamlandı',
  REJECTED: 'Reddedildi',
}
