/**
 * ⭐ SİPARİŞ STATE MACHINE — TEK KAYNAK
 *
 * Saf tablo. İki yerde kullanılır:
 *   1. Sunucu: transitionOrder() geçersiz geçişi reddeder
 *   2. Admin UI: durum dropdown'ı SADECE izinli hedefleri gösterir
 *
 * Aynı tablodan beslendikleri için UI ile backend asla ayrışamaz.
 */

import type { OrderStatus } from '@/lib/enums'

export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // Sihirbaz devam ediyor; sipariş henüz yazılmadı
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  // ⚠️ FULFILLMENT KAPISI: buradan PROCESSING'e GEÇİLEMEZ.
  // Ödeme alınmadan iş kuyruğuna düşmesi yapısal olarak imkânsız.
  PENDING_PAYMENT: ['PAID', 'CANCELLED', 'FAILED'],
  PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['STARTED', 'CANCELLED', 'REFUNDED'],
  STARTED: ['IN_PROGRESS', 'PARTIAL', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['PARTIAL', 'COMPLETED', 'CANCELLED'],
  PARTIAL: ['IN_PROGRESS', 'COMPLETED', 'REFUNDED'],
  COMPLETED: ['REFUNDED'], // telafi / garanti kapsamı
  CANCELLED: ['REFUNDED'],
  REFUNDED: [], // son durum
  FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
} as const

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from]
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0
}

/** Ödeme alınmış mı? İade edilebilirlik ve muhasebe raporları bunu kullanır. */
export const PAID_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PAID',
  'PROCESSING',
  'STARTED',
  'IN_PROGRESS',
  'PARTIAL',
  'COMPLETED',
])

/** Operatörün aktif kuyruğunda görünen siparişler. */
/**
 * FULFILLMENT KUYRUĞU — operatörün "aktif iş" listesi.
 * PENDING_PAYMENT BİLEREK YOK: ödeme alınmadan hiçbir sipariş iş sayılmaz.
 */
export const ACTIVE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PAID',
  'PROCESSING',
  'STARTED',
  'IN_PROGRESS',
  'PARTIAL',
])

/** Müşteri kendi iptal edebilir mi? */
export const CUSTOMER_CANCELLABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PENDING_PAYMENT',
])

/**
 * Fulfillment'ın BAŞLAYABİLECEĞİ durumlar. `PENDING_PAYMENT` burada olmadığı
 * için ödeme öncesi işleme alma yapısal olarak engellenir.
 */
export const FULFILLMENT_ALLOWED_FROM: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PAID',
  'PROCESSING',
  'STARTED',
  'IN_PROGRESS',
  'PARTIAL',
])

/** Ödeme alınmış mı? (fulfillment ve iade kararları buna bakar) */
export function isPaid(status: OrderStatus): boolean {
  return PAID_STATUSES.has(status)
}

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION'
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Geçersiz durum geçişi: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}
