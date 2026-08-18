import 'server-only'

import type { PaymentStatus } from '@/lib/enums'

/**
 * PAYMENT PROVIDER ARAYÜZÜ — sağlayıcıdan bağımsız ödeme domaini
 *
 * ⚠️ KURAL: Domain kodunda `if (provider === 'paytr')` GEÇMEZ.
 * Sağlayıcıya özel her şey kendi adapter'ında kalır; dışarı yalnızca
 * buradaki ortak tipler çıkar. Yeni sağlayıcı eklemek = yeni bir dosya
 * + registry'ye bir satır. Order/webhook servisleri değişmez.
 *
 * Adapter'lar HİÇBİR ZAMAN:
 *   • veritabanına yazmaz (Payment/Order kayıtları servis katmanının işi)
 *   • tutar hesaplamaz (tutar Order.totalMinor'dan gelir)
 *   • kart verisi görmez, saklamaz veya loglamaz
 */

export type ProviderKey = 'iyzico' | 'paytr' | 'mock'

export type PaymentEnvironment = 'sandbox' | 'production'

/** Ödeme oluşturmak için sağlayıcıya verilen NORMALİZE girdi. */
export interface CreatePaymentInput {
  /** Bizim ürettiğimiz benzersiz referans (merchant_oid / conversationId) */
  providerRef: string
  /** Müşteriye gösterilen sipariş numarası — snapshot */
  orderNo: string
  /** ⚠️ Order.totalMinor — TEK KAYNAK. Kuruş cinsinden tam sayı. */
  amountMinor: number
  currency: 'TRY'

  buyer: {
    id: string
    firstName: string
    lastName: string
    email: string
    /** Tuzlanmış hash DEĞİL, sağlayıcının risk analizi için ham IP */
    ip: string
    phone?: string | null
  }

  basket: Array<{
    id: string
    name: string
    /** Satır tutarı, kuruş */
    amountMinor: number
  }>

  callbackUrl: string
  successUrl: string
  failureUrl: string
}

/** Checkout başlatma sonucu — UI'ın sağlayıcıya yönlenmesi için gereken her şey. */
export interface CreatePaymentResult {
  ok: boolean
  /** Sağlayıcının işlem/oturum kimliği (varsa) */
  providerTxnId?: string | null
  /** iyzico: checkout token · PayTR: iframe token */
  checkoutToken?: string | null
  /** Kullanıcının yönlendirileceği/gömüleceği adres */
  checkoutUrl?: string | null
  /** Sağlayıcı sayfası iframe içinde mi açılmalı, yoksa tam yönlendirme mi? */
  presentation: 'redirect' | 'iframe'
  expiresAt?: Date | null
  /** Başlangıç durumu — çoğu sağlayıcıda PENDING */
  status: PaymentStatus
  errorCode?: string | null
  errorMessage?: string | null
  /** PII arındırılmış ham yanıt (teşhis için) */
  raw?: unknown
}

/** Sağlayıcıdan gelen bildirimin NORMALİZE hâli. */
export interface NormalizedWebhook {
  /** İmza/hash doğrulandı mı? Bu false ise ödeme ASLA başarılı sayılmaz. */
  signatureValid: boolean
  /** Aynı bildirimi tekrar tanımak için sağlayıcı olay kimliği */
  providerEventId: string
  /** Bizim referansımız — Payment bu alandan bulunur */
  providerRef: string | null
  providerTxnId?: string | null
  /** Ortak domaine çevrilmiş sonuç */
  status: PaymentStatus
  /** Sağlayıcının bildirdiği tutar, kuruş. Order.totalMinor ile KARŞILAŞTIRILIR. */
  amountMinor: number | null
  currency: string | null
  eventType: string
  errorCode?: string | null
  errorMessage?: string | null
  card?: { brand?: string | null; last4?: string | null; bankName?: string | null } | null
  installment?: number | null
  /** PII/kart verisi arındırılmış payload — PaymentEvent'e yazılır */
  safePayload: Record<string, unknown>
  /** Sağlayıcının beklediği HTTP cevabı (PayTR düz "OK" bekler) */
  ack: { status: number; body: string; contentType: string }
}

export interface RefundInput {
  providerRef: string
  providerTxnId: string | null
  amountMinor: number
  currency: 'TRY'
  reason: string
  /** Sağlayıcıya iletilecek benzersiz iade referansı */
  refundRef: string
  buyerIp: string
}

export interface RefundResult {
  ok: boolean
  providerRefundId?: string | null
  providerStatus?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  raw?: unknown
}

export interface PaymentStatusResult {
  ok: boolean
  status: PaymentStatus
  providerTxnId?: string | null
  amountMinor?: number | null
  currency?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

/** Ham istek — adapter'ın imza doğrulaması için ihtiyacı olan her şey. */
export interface RawWebhookRequest {
  headers: Headers
  /** Ham gövde metni — imza HAM gövde üzerinden doğrulanır, parse edilmiş obje üzerinden DEĞİL */
  rawBody: string
  contentType: string | null
}

export interface PaymentProvider {
  readonly key: ProviderKey
  readonly displayName: string
  readonly environment: PaymentEnvironment
  /** Kimlik bilgileri yapılandırılmış mı? Değilse ödeme başlatılamaz. */
  readonly isConfigured: boolean

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>

  getPaymentStatus(ref: {
    providerRef: string
    providerTxnId?: string | null
    checkoutToken?: string | null
  }): Promise<PaymentStatusResult>

  /** İmza/hash doğrulaması. Ayrı metot: tek başına test edilebilir olmalı. */
  verifyWebhook(req: RawWebhookRequest): Promise<boolean> | boolean

  /** Ham isteği ortak domaine çevirir. `signatureValid` alanını doldurur. */
  handleWebhook(req: RawWebhookRequest): Promise<NormalizedWebhook>

  refundPayment(input: RefundInput): Promise<RefundResult>
}

/** Sağlayıcı yapılandırılmamışken ödeme başlatma girişimi. */
export class ProviderNotConfiguredError extends Error {
  readonly code = 'PROVIDER_NOT_CONFIGURED'
  constructor(provider: string) {
    super(
      `"${provider}" ödeme sağlayıcısı yapılandırılmamış. ` +
        'Ödeme alınamaz — merchant bilgileri environment üzerinden tanımlanmalı.',
    )
    this.name = 'ProviderNotConfiguredError'
  }
}

/** Sağlayıcıya erişilemedi / beklenmeyen yanıt. */
export class ProviderCommunicationError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'
  constructor(
    provider: string,
    readonly detail: string,
  ) {
    super(`"${provider}" ödeme sağlayıcısına ulaşılamadı.`)
    this.name = 'ProviderCommunicationError'
  }
}
