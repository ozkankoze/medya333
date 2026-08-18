/**
 * ÖDEME DURUM MAKİNESİ — saf, izomorfik, veritabanı bağımsız
 *
 * Sipariş durum makinesinden (lib/orders/transitions.ts) AYRIDIR.
 * İki makine yalnızca tek bir noktada buluşur:
 *   Payment CAPTURED  →  Order PENDING_PAYMENT → PAID
 *
 * İSTENEN MODEL ↔ UYGULANAN MODEL
 * Fazın tarifindeki kavramsal durumlar şu şekilde karşılanır:
 *   INITIATED            → INITIATED
 *   PENDING              → PENDING (genel) / PENDING_3DS (3DS beklemesi)
 *   SUCCESS              → CAPTURED (tahsil edildi; AUTHORIZED ön provizyon)
 *   FAILED               → FAILED
 *   CANCELLED            → CANCELLED
 *   REFUNDED             → REFUNDED
 *   PARTIALLY_REFUNDED   → PARTIALLY_REFUNDED
 * Ek olarak CHARGEBACK (ters ibraz) taşınır.
 * Daha ayrıntılı isimler bilinçli tercih: "PENDING" tek başına 3DS beklemesi
 * ile sağlayıcı sonucu beklemesini ayırt edemiyordu; "SUCCESS" ise ön provizyon
 * (AUTHORIZED) ile tahsilatı (CAPTURED) aynı kutuya koyuyordu.
 */

import type { PaymentStatus } from '@/lib/enums'

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  INITIATED: ['PENDING', 'PENDING_3DS', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'],
  PENDING: ['PENDING_3DS', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'],
  PENDING_3DS: ['AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['CAPTURED', 'FAILED', 'CANCELLED'],
  // ⚠️ CAPTURED'dan geriye dönüş YOK. Geç gelen "pending" bildirimi
  // tahsil edilmiş bir ödemeyi belirsize çeviremez.
  CAPTURED: ['REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK'],
  REFUNDED: ['CHARGEBACK'],
  // Başarısız deneme yeni bir ATTEMPT ile tekrarlanır; aynı Payment satırı
  // yeniden canlanmaz — böylece her denemenin izi ayrı ayrı kalır.
  FAILED: [],
  CANCELLED: [],
  CHARGEBACK: [],
} as const

/** Ödemenin parası alınmış sayıldığı durumlar. */
export const PAYMENT_SETTLED: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'CAPTURED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CHARGEBACK',
])

/** Sonuç beklenen, hâlâ başarıya dönebilecek durumlar. */
export const PAYMENT_IN_FLIGHT: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'INITIATED',
  'PENDING',
  'PENDING_3DS',
  'AUTHORIZED',
])

/** Bir daha değişmeyecek (yeni deneme gerektiren) durumlar. */
export const PAYMENT_TERMINAL_FAILURE: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'FAILED',
  'CANCELLED',
])

/** ⚠️ Siparişi PAID yapmaya YETKİLİ tek durum kümesi. */
export const PAYMENT_UNLOCKS_ORDER: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'CAPTURED',
])

export class InvalidPaymentTransitionError extends Error {
  readonly code = 'INVALID_PAYMENT_TRANSITION'
  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(`Geçersiz ödeme durumu geçişi: ${from} → ${to}`)
    this.name = 'InvalidPaymentTransitionError'
  }
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to)
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) throw new InvalidPaymentTransitionError(from, to)
}

/**
 * Aynı duruma geçiş = idempotent no-op.
 * Sağlayıcılar aynı bildirimi defalarca gönderir (PayTR 2xx alana kadar,
 * iyzico 15 dakikada bir, 3 deneme). CAPTURED → CAPTURED hata DEĞİLDİR.
 */
export function isNoOpTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to
}

export function isSettled(status: PaymentStatus): boolean {
  return PAYMENT_SETTLED.has(status)
}

export function isInFlight(status: PaymentStatus): boolean {
  return PAYMENT_IN_FLIGHT.has(status)
}

export function unlocksOrder(status: PaymentStatus): boolean {
  return PAYMENT_UNLOCKS_ORDER.has(status)
}

// ---------------------------------------------------------------------------
// Müşteriye gösterilecek metinler
// ---------------------------------------------------------------------------

export interface PaymentStatusMeta {
  label: string
  description: string
  tone: 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger'
  /** Müşteri "tekrar öde" diyebilir mi? */
  retryable: boolean
}

export const PAYMENT_STATUS_META: Record<PaymentStatus, PaymentStatusMeta> = {
  INITIATED: {
    label: 'Ödeme başlatıldı',
    description: 'Ödeme sayfasına yönlendiriliyorsunuz.',
    tone: 'neutral',
    retryable: true,
  },
  PENDING: {
    label: 'Ödemeniz doğrulanıyor',
    description:
      'Ödemeniz bankadan onay bekliyor. Sonuç geldiğinde siparişiniz otomatik güncellenecek.',
    tone: 'progress',
    retryable: false,
  },
  PENDING_3DS: {
    label: 'Ödemeniz doğrulanıyor',
    description: '3D Secure doğrulaması sürüyor. Bu sayfayı kapatmayın.',
    tone: 'progress',
    retryable: false,
  },
  AUTHORIZED: {
    label: 'Ödemeniz doğrulanıyor',
    description: 'Ödeme onaylandı, tahsilat tamamlanıyor.',
    tone: 'progress',
    retryable: false,
  },
  CAPTURED: {
    label: 'Ödeme başarılı',
    description: 'Ödemeniz alındı. Siparişiniz işleme hazır.',
    tone: 'success',
    retryable: false,
  },
  FAILED: {
    label: 'Ödeme başarısız',
    description: 'Ödeme tamamlanamadı. Dilerseniz tekrar deneyebilirsiniz.',
    tone: 'danger',
    retryable: true,
  },
  CANCELLED: {
    label: 'Ödeme iptal edildi',
    description: 'Ödeme işlemi iptal edildi. Dilerseniz tekrar deneyebilirsiniz.',
    tone: 'warning',
    retryable: true,
  },
  REFUNDED: {
    label: 'İade edildi',
    description: 'Ödemeniz iade edildi. Bankanıza yansıması 1-7 iş günü sürebilir.',
    tone: 'danger',
    retryable: false,
  },
  PARTIALLY_REFUNDED: {
    label: 'Kısmen iade edildi',
    description: 'Ödemenizin bir kısmı iade edildi.',
    tone: 'warning',
    retryable: false,
  },
  CHARGEBACK: {
    label: 'Ters ibraz',
    description: 'Ödeme bankası tarafından geri çekildi.',
    tone: 'danger',
    retryable: false,
  },
}
