/**
 * FULFILLMENT DURUM MAKİNESİ — saf, izomorfik, veritabanı bağımsız
 *
 * ⚠️ BU FAZIN EN ÖNEMLİ İŞ KURALI:
 * Ödeme başarılı olduğunda sipariş otomatik onaylanır ve fulfillment READY
 * durumunda operasyon kuyruğuna düşer. Ancak fulfillment HİÇBİR KOŞULDA
 * otomatik başlamaz veya otomatik tamamlanmaz. Başlatma, ilerleme ve
 * tamamlanma MANUEL operatör/admin aksiyonlarıdır.
 *
 * Bu kural üç yerde birden kilitlenmiştir:
 *   1. `AUTO_CREATABLE_STATUSES` — sistem yalnızca READY üretebilir
 *   2. `MANUAL_ONLY_TRANSITIONS` — bu geçişler yalnızca insan aktörle olur
 *   3. Servis katmanında `actorUserId` zorunluluğu (server/fulfillment/*)
 *
 * Fulfillment'ın durumu Order'ın durumundan AYRIDIR. Order "PAID" iken
 * fulfillment "READY"dir; ikisi zorla eşitlenmez.
 */

import type { FulfillmentStatus } from '@/lib/enums'

export const FULFILLMENT_TRANSITIONS: Record<
  FulfillmentStatus,
  readonly FulfillmentStatus[]
> = {
  // Kuyrukta bekliyor. İşleme alma MANUEL.
  READY: ['PROCESSING', 'FAILED', 'REVIEW_REQUIRED'],
  // Hazırlanıyor. Başlatma MANUEL.
  PROCESSING: ['STARTED', 'FAILED', 'REVIEW_REQUIRED'],
  // İş başladı. Tamamlama MANUEL — teslim sayısı dolsa bile otomatik olmaz.
  STARTED: ['PARTIAL', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED'],
  // Kısmi teslim. Devam edilebilir ya da olduğu gibi tamamlanabilir.
  PARTIAL: ['STARTED', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED'],
  // ⚠️ TAMAMLANMIŞ İŞ GERİ ALINMAZ. Telafi ayrı bir ReplacementCase'tir.
  COMPLETED: ['REVIEW_REQUIRED'],
  FAILED: ['REVIEW_REQUIRED'],
  // İnceleme sonrası iş yeniden ele alınabilir ya da kapatılabilir.
  REVIEW_REQUIRED: ['PROCESSING', 'STARTED', 'COMPLETED', 'FAILED'],
} as const

/**
 * ⚠️ Sistemin (webhook/otomasyon) ÜRETEBİLECEĞİ tek durum.
 * Ödeme doğrulandığında fulfillment bu durumda açılır ve orada bekler.
 */
export const AUTO_CREATABLE_STATUSES: ReadonlySet<FulfillmentStatus> =
  new Set<FulfillmentStatus>(['READY'])

/**
 * ⚠️ YALNIZCA İNSAN AKTÖRLE yapılabilen geçişler.
 * Servis katmanı bu hedeflere geçerken `actorUserId` ZORUNLU tutar; sistem
 * aktörü (webhook, cron) bu geçişleri yapamaz.
 */
export const MANUAL_ONLY_TRANSITIONS: ReadonlySet<FulfillmentStatus> =
  new Set<FulfillmentStatus>(['PROCESSING', 'STARTED', 'PARTIAL', 'COMPLETED', 'FAILED'])

/** Operasyonun aktif olarak çalıştığı durumlar. */
export const ACTIVE_FULFILLMENT_STATUSES: ReadonlySet<FulfillmentStatus> =
  new Set<FulfillmentStatus>(['PROCESSING', 'STARTED', 'PARTIAL'])

/** Kuyruktan düşmüş, artık iş gerektirmeyen durumlar. */
export const TERMINAL_FULFILLMENT_STATUSES: ReadonlySet<FulfillmentStatus> =
  new Set<FulfillmentStatus>(['COMPLETED'])

export class InvalidFulfillmentTransitionError extends Error {
  readonly code = 'INVALID_FULFILLMENT_TRANSITION'
  constructor(
    readonly from: FulfillmentStatus,
    readonly to: FulfillmentStatus,
  ) {
    super(`Geçersiz fulfillment durumu geçişi: ${from} → ${to}`)
    this.name = 'InvalidFulfillmentTransitionError'
  }
}

export class AutomationNotAllowedError extends Error {
  readonly code = 'AUTOMATION_NOT_ALLOWED'
  constructor(readonly to: FulfillmentStatus) {
    super(
      `"${to}" durumuna geçiş yalnızca manuel operatör aksiyonuyla yapılabilir. ` +
        'Sistem fulfillment başlatamaz veya tamamlayamaz.',
    )
    this.name = 'AutomationNotAllowedError'
  }
}

export function canTransitionFulfillment(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return FULFILLMENT_TRANSITIONS[from].includes(to)
}

export function assertFulfillmentTransition(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): void {
  if (!canTransitionFulfillment(from, to)) {
    throw new InvalidFulfillmentTransitionError(from, to)
  }
}

/** Manuel-zorunlu bir geçişte insan aktör var mı? */
export function assertManualActor(to: FulfillmentStatus, actorUserId: string | null): void {
  if (MANUAL_ONLY_TRANSITIONS.has(to) && !actorUserId) {
    throw new AutomationNotAllowedError(to)
  }
}

// ---------------------------------------------------------------------------
// İLERLEME HESABI — tamamen sunucuda
// ---------------------------------------------------------------------------

export interface ProgressInput {
  requestedQuantity: number
  deliveredQuantity: number
}

export interface ProgressResult {
  requested: number
  delivered: number
  remaining: number
  /** 0-100 arası tam sayı */
  percent: number
  isFullyDelivered: boolean
}

/**
 * ⚠️ İSTEMCİDEN GELEN `remaining` VEYA `percent` DEĞERİ KULLANILMAZ.
 * Bu fonksiyon tek kaynaktır; `deliveredQuantity` istenen miktarı aşamaz.
 */
export function computeFulfillmentProgress(input: ProgressInput): ProgressResult {
  const requested = Math.max(0, Math.trunc(input.requestedQuantity))
  const delivered = Math.max(0, Math.min(Math.trunc(input.deliveredQuantity), requested))
  const remaining = requested - delivered
  const percent = requested > 0 ? Math.round((delivered / requested) * 100) : 0
  return {
    requested,
    delivered,
    remaining,
    percent,
    isFullyDelivered: requested > 0 && delivered >= requested,
  }
}

/** METRIC modunda hedef değer: başlangıç + istenen miktar. */
export function goalMetric(initialMetric: number | null, requested: number): number | null {
  if (initialMetric === null) return null
  return initialMetric + requested
}

export interface MetricDeltaResult {
  /** Ölçümden türetilen teslim adedi (negatif olmaz) */
  deliveredFromMetric: number
  /** Ölçüm geriye düştü mü? Hata DEĞİL — inceleme gerektirir. */
  decreased: boolean
  dropAmount: number
}

/**
 * Ölçüm farkından teslim adedi çıkarır.
 *
 * ⚠️ Metrik geriye düşebilir (organik takipçi kaybı). Bu bir HATA DEĞİLDİR;
 * `decreased` bayrağı ile işaretlenir, operatör inceler. Teslim adedi geri
 * alınmaz — düşüş varsa telafi (ReplacementCase) konusudur.
 */
export function deliveredFromMetricDelta(
  initialMetric: number | null,
  currentMetric: number | null,
  previousMetric: number | null,
): MetricDeltaResult {
  if (initialMetric === null || currentMetric === null) {
    return { deliveredFromMetric: 0, decreased: false, dropAmount: 0 }
  }
  const deliveredFromMetric = Math.max(0, currentMetric - initialMetric)
  const compareTo = previousMetric ?? initialMetric
  const decreased = currentMetric < compareTo
  return {
    deliveredFromMetric,
    decreased,
    dropAmount: decreased ? compareTo - currentMetric : 0,
  }
}

/** Garanti bitiş tarihi. `refillDays` yoksa garanti yoktur. */
export function computeGuaranteeEnd(
  from: Date,
  guaranteeDays: number | null | undefined,
): Date | null {
  if (!guaranteeDays || guaranteeDays <= 0) return null
  return new Date(from.getTime() + guaranteeDays * 24 * 60 * 60 * 1000)
}

export function isWithinGuarantee(guaranteeEndsAt: Date | null, now: Date): boolean {
  if (!guaranteeEndsAt) return false
  return now <= guaranteeEndsAt
}

// ---------------------------------------------------------------------------
// MÜŞTERİYE GÖSTERİLEN DURUM
// ---------------------------------------------------------------------------

export interface CustomerFulfillmentView {
  label: string
  description: string
  tone: 'neutral' | 'info' | 'progress' | 'success' | 'warning'
  /** Müşteri tarafı yoklama devam etsin mi? */
  polling: boolean
}

/**
 * ⚠️ İç durum ile müşteri mesajı BİREBİR BAĞLI DEĞİLDİR.
 * Operasyonel gerçek (FAILED, REVIEW_REQUIRED) müşteriye teknik detayla
 * değil, güvenli ve sakin bir dille aktarılır. Teknik hata mesajı, operatör
 * adı, iç not ve maliyet bilgisi buraya ASLA girmez.
 */
export const CUSTOMER_FULFILLMENT_VIEW: Record<FulfillmentStatus, CustomerFulfillmentView> = {
  READY: {
    label: 'Sıraya alındı',
    description: 'Siparişiniz onaylandı ve işlem sırasına alındı.',
    tone: 'info',
    polling: true,
  },
  PROCESSING: {
    label: 'Hazırlanıyor',
    description: 'İşleminiz hazırlanıyor.',
    tone: 'info',
    polling: true,
  },
  STARTED: {
    label: 'Başladı',
    description: 'İşleminiz başladı.',
    tone: 'progress',
    polling: true,
  },
  PARTIAL: {
    label: 'Devam ediyor',
    description: 'İşleminiz devam ediyor.',
    tone: 'progress',
    polling: true,
  },
  COMPLETED: {
    label: 'Tamamlandı',
    description: 'İşleminiz tamamlandı.',
    tone: 'success',
    polling: false,
  },
  FAILED: {
    // Müşteriye "başarısız" denmez — teknik sebep de gösterilmez.
    label: 'İnceleniyor',
    description: 'İşleminiz sırasında bir sorun oluştu. Ekibimiz tarafından inceleniyor.',
    tone: 'warning',
    polling: true,
  },
  REVIEW_REQUIRED: {
    label: 'İnceleniyor',
    description: 'Siparişiniz ekibimiz tarafından inceleniyor.',
    tone: 'warning',
    polling: true,
  },
}

// ---------------------------------------------------------------------------
// OPERASYON KUYRUĞU SIRALAMASI
// ---------------------------------------------------------------------------

/** Küçük sayı = kuyrukta önce. Operatör en acil işi üstte görür. */
export const QUEUE_PRIORITY: Record<FulfillmentStatus, number> = {
  READY: 1,
  PROCESSING: 2,
  STARTED: 3,
  PARTIAL: 4,
  REVIEW_REQUIRED: 5,
  FAILED: 6,
  COMPLETED: 7,
}

/** Operatör panelindeki kovalar. */
export const QUEUE_BUCKETS = {
  new: ['READY'],
  active: ['PROCESSING', 'STARTED'],
  partial: ['PARTIAL'],
  review: ['REVIEW_REQUIRED', 'FAILED'],
  completed: ['COMPLETED'],
} as const satisfies Record<string, readonly FulfillmentStatus[]>

export type QueueBucket = keyof typeof QUEUE_BUCKETS

export const QUEUE_BUCKET_LABELS: Record<QueueBucket, string> = {
  new: 'Yeni Siparişler',
  active: 'İşlemde',
  partial: 'Kısmi',
  review: 'İnceleme',
  completed: 'Tamamlanan',
}
