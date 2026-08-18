/**
 * Prisma'dan BAĞIMSIZ enum sabitleri.
 *
 * Mimari kuralı: `lib/` katmanı DB bilmez. Pricing engine, state machine ve
 * hedef parse mantığı tarayıcıda da çalıştığı için Prisma client'ı import edemez.
 * Prisma string enum ürettiğinden bu tipler yapısal olarak birebir uyumludur.
 *
 * Bu dosya prisma/schema.prisma ile senkron tutulmalıdır.
 * (tests/unit/enums.test.ts bu senkronu şemayı okuyarak doğrular.)
 */

export const ORDER_STATUS = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'STARTED',
  'IN_PROGRESS',
  'PARTIAL',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
] as const
export type OrderStatus = (typeof ORDER_STATUS)[number]

export const ORDER_EVENT_TYPE = [
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'FULFILLMENT_COMPLETED',
  'PAYMENT_PENDING',
  'PRICE_CHANGED',
  'CUSTOMER_INFO_ADDED',
  'CONSENT_ACCEPTED',
  'GUEST_CLAIMED',
  'TRACKING_LINK_SENT',
  'PAYMENT_INITIATED',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  'PROCESSING',
  'STARTED',
  'PROGRESS_UPDATED',
  'PARTIAL',
  'COMPLETED',
  'CANCELLED',
  'REFUND_REQUESTED',
  'REFUNDED',
  'FAILED',
  'NOTE_ADDED',
  'TARGET_CONFIRMED',
  'ASSIGNED',
  'STATUS_CHANGED',
  'INVOICE_ISSUED',
  'SYSTEM',
] as const
export type OrderEventType = (typeof ORDER_EVENT_TYPE)[number]

export const TARGET_TYPE = ['PROFILE', 'POST', 'VIDEO', 'CHANNEL', 'GROUP'] as const
export type TargetType = (typeof TARGET_TYPE)[number]

export const TARGET_STATUS = [
  'PENDING',
  'VERIFIED',
  'UNVERIFIED',
  'INVALID',
  'PRIVATE',
  'NOT_FOUND',
] as const
export type TargetStatus = (typeof TARGET_STATUS)[number]

export const PRICING_MODE = ['FLAT_TIER', 'GRADUATED'] as const
export type PricingMode = (typeof PRICING_MODE)[number]

export const DISCOUNT_TYPE = ['PERCENTAGE', 'FIXED_AMOUNT'] as const
export type DiscountType = (typeof DISCOUNT_TYPE)[number]

export const MEASUREMENT_MODE = ['METRIC', 'MANUAL_COUNT'] as const
export type MeasurementMode = (typeof MEASUREMENT_MODE)[number]

export const USER_ROLE = ['CUSTOMER', 'SUPPORT', 'OPERATOR', 'ADMIN', 'SUPERADMIN'] as const
export type UserRole = (typeof USER_ROLE)[number]

export const INVOICE_STATUS = [
  'NOT_REQUIRED',
  'PENDING',
  'ISSUED',
  'FAILED',
  'CANCELLED',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUS)[number]

export const PAYMENT_STATUS = [
  'INITIATED',
  'PENDING',
  'PENDING_3DS',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CHARGEBACK',
] as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]

export const FULFILLMENT_STATUS = [
  'READY',
  'PROCESSING',
  'STARTED',
  'PARTIAL',
  'COMPLETED',
  'FAILED',
  'REVIEW_REQUIRED',
] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUS)[number]

export const FULFILLMENT_EVENT_TYPE = [
  'CREATED',
  'ASSIGNED',
  'REASSIGNED',
  'STARTED',
  'PROGRESS_UPDATED',
  'METRIC_DECREASED',
  'PARTIAL_DELIVERY',
  'NOTE_ADDED',
  'COMPLETED',
  'FAILED',
  'REVIEW_REQUIRED',
  'REPLACEMENT_CREATED',
  'REPLACEMENT_APPROVED',
  'REPLACEMENT_STARTED',
  'REPLACEMENT_COMPLETED',
] as const
export type FulfillmentEventType = (typeof FULFILLMENT_EVENT_TYPE)[number]

export const REPLACEMENT_STATUS = [
  'DROP_DETECTED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REPLACEMENT_PROCESSING',
  'COMPLETED',
  'REJECTED',
] as const
export type ReplacementStatus = (typeof REPLACEMENT_STATUS)[number]

export const REFUND_STATUS = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'FAILED'] as const
export type RefundStatus = (typeof REFUND_STATUS)[number]

/** Rol hiyerarşisi — büyük sayı daha yetkili. `requireRole` bunu kullanır. */
export const ROLE_LEVEL: Record<UserRole, number> = {
  CUSTOMER: 0,
  SUPPORT: 10,
  OPERATOR: 20,
  ADMIN: 30,
  SUPERADMIN: 40,
}
