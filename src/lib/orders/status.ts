/**
 * Durum meta verisi — etiket, renk, ikon, görünürlük.
 * Müşteri paneli, admin tablosu ve e-posta şablonları AYNI kaynaktan beslenir.
 */

import type { OrderStatus } from '@/lib/enums'

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger'

export interface OrderStatusMeta {
  label: string
  description: string
  tone: StatusTone
  /** Müşteri zaman çizelgesinde görünür mü? */
  customerVisible: boolean
  /** Bu duruma geçildiğinde müşteriye e-posta atılsın mı? */
  notifyCustomer: boolean
  /** Adım göstergesindeki sıra (0-4). Terminal/hata durumları -1. */
  step: number
}

export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  DRAFT: {
    label: 'Taslak',
    description: 'Sipariş henüz tamamlanmadı.',
    tone: 'neutral',
    customerVisible: false,
    notifyCustomer: false,
    step: 0,
  },
  PENDING_PAYMENT: {
    label: 'Ödeme Bekleniyor',
    description: 'Siparişiniz oluşturuldu, ödeme adımını tamamlamanızı bekliyoruz.',
    tone: 'neutral',
    customerVisible: true,
    notifyCustomer: true,
    step: 0,
  },
  PAID: {
    label: 'Ödeme Alındı',
    description: 'Ödemeniz onaylandı. Siparişiniz hazırlık kuyruğuna alındı.',
    tone: 'info',
    customerVisible: true,
    notifyCustomer: true,
    step: 1,
  },
  PROCESSING: {
    label: 'Hazırlanıyor',
    description: 'Siparişiniz ekibimiz tarafından hazırlanıyor.',
    tone: 'info',
    customerVisible: true,
    notifyCustomer: false,
    step: 2,
  },
  STARTED: {
    label: 'İşlem Başladı',
    description: 'Hizmet başlatıldı, ilk sonuçlar kısa süre içinde görünecek.',
    tone: 'progress',
    customerVisible: true,
    notifyCustomer: true,
    step: 3,
  },
  IN_PROGRESS: {
    label: 'Devam Ediyor',
    description: 'Siparişiniz devam ediyor. İlerlemeyi bu sayfadan takip edebilirsiniz.',
    tone: 'progress',
    customerVisible: true,
    notifyCustomer: false,
    step: 3,
  },
  PARTIAL: {
    label: 'Kısmen Tamamlandı',
    description: 'Siparişin bir kısmı teslim edildi. Kalan miktar için sizinle iletişime geçeceğiz.',
    tone: 'warning',
    customerVisible: true,
    notifyCustomer: true,
    step: 4,
  },
  COMPLETED: {
    label: 'Tamamlandı',
    description: 'Siparişiniz eksiksiz tamamlandı.',
    tone: 'success',
    customerVisible: true,
    notifyCustomer: true,
    step: 4,
  },
  CANCELLED: {
    label: 'İptal Edildi',
    description: 'Sipariş iptal edildi.',
    tone: 'danger',
    customerVisible: true,
    notifyCustomer: true,
    step: -1,
  },
  REFUNDED: {
    label: 'İade Edildi',
    description: 'Ödemeniz iade edildi. Bankanıza yansıması 1-7 iş günü sürebilir.',
    tone: 'danger',
    customerVisible: true,
    notifyCustomer: true,
    step: -1,
  },
  FAILED: {
    label: 'Başarısız',
    description: 'Ödeme tamamlanamadı. Dilerseniz tekrar deneyebilirsiniz.',
    tone: 'danger',
    customerVisible: true,
    notifyCustomer: true,
    step: -1,
  },
}

/** Müşteri stepper'ında gösterilen ana akış. */
export const CUSTOMER_TIMELINE_STEPS: readonly {
  step: number
  label: string
  statuses: readonly OrderStatus[]
}[] = [
  { step: 0, label: 'Ödeme', statuses: ['PENDING_PAYMENT'] },
  { step: 1, label: 'Onaylandı', statuses: ['PAID'] },
  { step: 2, label: 'Hazırlanıyor', statuses: ['PROCESSING'] },
  { step: 3, label: 'Devam Ediyor', statuses: ['STARTED', 'IN_PROGRESS'] },
  { step: 4, label: 'Tamamlandı', statuses: ['COMPLETED', 'PARTIAL'] },
]

export function statusLabel(status: OrderStatus): string {
  return ORDER_STATUS_META[status].label
}

export function shouldNotifyCustomer(status: OrderStatus): boolean {
  return ORDER_STATUS_META[status].notifyCustomer
}

/**
 * Teslim ilerlemesi.
 * METRIC       → currentCount - startCount
 * MANUAL_COUNT → operatörün girdiği deliveredQuantity
 */
export function computeProgress(input: {
  quantity: number
  deliveredQuantity: number
}): { delivered: number; remaining: number; percent: number } {
  const delivered = Math.max(0, Math.min(input.deliveredQuantity, input.quantity))
  const remaining = input.quantity - delivered
  const percent = input.quantity > 0 ? Math.round((delivered / input.quantity) * 100) : 0
  return { delivered, remaining, percent }
}

export function deliveredFromMetric(startCount: number | null, currentCount: number | null): number {
  if (startCount == null || currentCount == null) return 0
  return Math.max(0, currentCount - startCount)
}
