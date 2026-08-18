import 'server-only'

import { createHash } from 'node:crypto'
import { PricingError } from '@/lib/pricing'
import { buildConsentSnapshot, LEGAL_DOCUMENTS } from '@/lib/legal'
import type { CreateOrderInput } from '@/lib/validation'
import { db } from '@/server/db'
import { CouponInvalidError, resolvePrice, VariantNotFoundError } from '@/server/pricing/resolve'
import { createAccessToken, generateOrderNo } from './order-no'

/**
 * SİPARİŞ OLUŞTURMA — otorite akış
 *
 * İSTEMCİDEN GELEN FİYAT HİÇBİR ŞEKİLDE KULLANILMAZ. Girdi şeması `unitPrice`,
 * `subtotal`, `tax`, `total` gibi alanları zaten kabul etmez; `clientTotalMinor`
 * yalnızca KARŞILAŞTIRMA içindir.
 *
 * Sunucu sırasıyla:
 *   1. Katalogdan varyantı okur (aktiflik dahil)
 *   2. Hedefi doğrular ve siparişe bağlar
 *   3. Miktarı min/max/step kurallarına göre doğrular
 *   4. PricingRule'ları TAZE okur
 *   5. Pricing engine'i yeniden çalıştırır
 *   6. KDV'yi yeniden ayrıştırır
 *   7. Kuponu yeniden doğrular
 *   8. Fiyat snapshot'ını dondurur
 *   9. Sözleşme onaylarını sürümleriyle snapshot'lar
 *  10. Order + OrderItem + OrderEvent'i TEK TRANSACTION'da yazar
 */

export class PriceChangedError extends Error {
  readonly code = 'PRICE_CHANGED'
  constructor(
    readonly clientTotalMinor: number,
    readonly serverTotalMinor: number,
    readonly breakdown: unknown,
  ) {
    super('Fiyat güncellendi. Lütfen sipariş özetini kontrol edin.')
    this.name = 'PriceChangedError'
  }
}

export class TargetNotConfirmedError extends Error {
  readonly code = 'TARGET_NOT_CONFIRMED'
  constructor() {
    super('Devam etmek için hedefin doğru olduğunu onaylamanız gerekir.')
  }
}

export class TargetUnusableError extends Error {
  readonly code = 'TARGET_UNUSABLE'
  constructor(message: string) {
    super(message)
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT'
  constructor() {
    super('Bu istek anahtarı farklı bir sipariş için kullanılmış. Lütfen sayfayı yenileyin.')
  }
}

export interface CreateOrderContext {
  /** Oturum açmış kullanıcı; misafir siparişinde null */
  userId: string | null
  idempotencyKey: string
  ipHash: string | null
  userAgent: string | null
}

export interface CreateOrderResult {
  order: {
    id: string
    orderNo: string
    status: string
    totalMinor: number
    currency: string
  }
  /** Yalnızca YENİ oluşturulduğunda dolu — e-posta ile gönderilecek ham token */
  accessToken: string | null
  /** Idempotency sayesinde mevcut sipariş döndürüldüyse true */
  reused: boolean
}

/** İsteğin anlamlı parçalarından parmak izi — aynı key + farklı gövde = çakışma. */
function fingerprint(input: CreateOrderInput, userId: string | null): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        v: input.serviceVariantId,
        q: input.quantity,
        t: input.targetId,
        c: input.couponCode ?? null,
        e: input.guestEmail ?? null,
        u: userId,
      }),
    )
    .digest('hex')
}

export async function createOrder(
  input: CreateOrderInput,
  ctx: CreateOrderContext,
): Promise<CreateOrderResult> {
  const requestHash = fingerprint(input, ctx.userId)

  // --- IDEMPOTENCY: aynı key daha önce kullanıldıysa aynı siparişi döndür ---
  const existing = await db.order.findUnique({
    where: { idempotencyKey: ctx.idempotencyKey },
    select: {
      id: true,
      orderNo: true,
      status: true,
      totalMinor: true,
      currency: true,
      requestHash: true,
    },
  })
  if (existing) {
    if (existing.requestHash !== requestHash) throw new IdempotencyConflictError()
    return { order: existing, accessToken: null, reused: true }
  }

  // --- 1) Varyant + katalog ---------------------------------------------
  const variant = await db.serviceVariant.findFirst({
    where: { id: input.serviceVariantId, isActive: true, isVisible: true },
    include: { service: { include: { platform: true } } },
  })
  if (!variant || !variant.service.isActive || !variant.service.platform.isActive) {
    throw new VariantNotFoundError()
  }

  // --- 2) Hedef ----------------------------------------------------------
  const target = await db.target.findUnique({ where: { id: input.targetId } })
  if (!target) throw new TargetUnusableError('Hedef bulunamadı. Lütfen hedefi tekrar girin.')
  if (target.platformId !== variant.service.platformId) {
    throw new TargetUnusableError('Hedef, seçilen platforma ait değil.')
  }
  if (target.status === 'PRIVATE') {
    throw new TargetUnusableError('Bu hesap gizli. Hizmet verebilmemiz için herkese açık olmalı.')
  }
  if (target.status === 'NOT_FOUND' || target.status === 'INVALID') {
    throw new TargetUnusableError('Hedef geçersiz. Lütfen tekrar girin.')
  }
  // Doğrulanamayan hedeflerde kullanıcı onayı ZORUNLU
  const needsConfirmation = target.status === 'UNVERIFIED'
  if (needsConfirmation && !input.targetConfirmed) throw new TargetNotConfirmedError()

  // --- 3-7) Fiyat: miktar, kademeler, KDV, kupon — hepsi SUNUCUDA ---------
  const priced = await resolvePrice({
    serviceVariantId: variant.id,
    quantity: input.quantity,
    couponCode: input.couponCode ?? null,
    userId: ctx.userId,
  })
  const b = priced.breakdown

  // --- 8) İstemci fiyatıyla karşılaştır (kullanılmaz, yalnızca kontrol) ---
  if (input.clientTotalMinor != null && input.clientTotalMinor !== b.totalMinor) {
    throw new PriceChangedError(input.clientTotalMinor, b.totalMinor, b)
  }

  // --- Müşteri / misafir kullanıcı --------------------------------------
  const email = (input.guestEmail ?? '').trim().toLowerCase()
  let userId = ctx.userId
  let isGuestOrder = false

  if (!userId) {
    if (!email) throw new TargetUnusableError('E-posta adresi gerekli.')
    isGuestOrder = true
    // Aynı e-postayla daha önce misafir siparişi varsa AYNI gölge kullanıcı
    // kullanılır; böylece hesap açıldığında hepsi tek seferde devralınır.
    const shadow = await db.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        isGuest: true,
        name: [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || null,
      },
      select: { id: true, isBlocked: true },
    })
    if (shadow.isBlocked) throw new TargetUnusableError('Bu hesapla sipariş oluşturulamıyor.')
    userId = shadow.id
  }

  // --- 9) Sözleşme onayı snapshot'ı --------------------------------------
  const acceptedAt = new Date()
  const consentSnapshot = buildConsentSnapshot({
    acceptedAt,
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent,
  })

  // --- Takip token'ı: ham token e-postaya gider, DB'de yalnızca hash ------
  const { token, hash } = createAccessToken()
  const accessExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90) // 90 gün

  const orderNo = generateOrderNo()
  const customerEmail =
    email || (ctx.userId ? ((await db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }))?.email ?? null) : null)

  // --- 10) Tek transaction: Order + OrderItem + OrderEvent ---------------
  const created = await db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNo,
        userId: userId!,
        isGuestOrder,

        customerFirstName: input.customerFirstName,
        customerLastName: input.customerLastName,
        customerEmail,
        customerPhone: input.guestPhone ?? null,
        guestEmail: isGuestOrder ? email : null,
        guestName: [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || null,
        guestPhone: input.guestPhone ?? null,

        accessTokenHash: hash,
        accessExpiresAt,
        idempotencyKey: ctx.idempotencyKey,
        requestHash,

        platformId: variant.service.platformId,
        serviceId: variant.serviceId,
        serviceVariantId: variant.id,
        targetId: target.id,
        quantity: b.quantity,

        currency: b.currency,
        unitPriceMinor: b.unitPriceMinor,
        listSubtotalMinor: b.listSubtotalMinor,
        discountMinor: b.discountMinor,
        totalMinor: b.totalMinor,
        taxRateBp: b.taxRateBp,
        taxAmountMinor: b.taxAmountMinor,
        subtotalMinor: b.subtotalMinor,

        couponId: priced.couponId,
        campaignId: priced.campaignId,

        consentAcceptedAt: acceptedAt,
        consentTermsVersion: LEGAL_DOCUMENTS.terms.version,
        consentRefundVersion: LEGAL_DOCUMENTS.refund.version,
        consentPrivacyVersion: LEGAL_DOCUMENTS.privacy.version,
        consentSnapshot: consentSnapshot as never,

        customerNote: input.customerNote ?? null,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,

        // Sipariş DOĞRUDAN ödeme bekler durumda oluşur.
        // FULFILLMENT BAŞLAMAZ — PENDING_PAYMENT aktif iş kuyruğunda değildir.
        status: 'PENDING_PAYMENT',

        items: {
          create: {
            serviceVariantId: variant.id,
            targetId: target.id,
            quantity: b.quantity,
            unitPriceMinor: b.unitPriceMinor,
            lineSubtotalMinor: b.listSubtotalMinor,
            lineTotalMinor: b.totalMinor,
            appliedPricingRuleId: b.tierId,
            pricingSnapshot: b as never,
            platformNameSnapshot: variant.service.platform.name,
            serviceNameSnapshot: variant.service.name,
            variantLabelSnapshot: variant.customerLabel,
            status: 'PENDING_PAYMENT',
          },
        },

        events: {
          create: [
            {
              type: 'ORDER_CREATED',
              toStatus: 'PENDING_PAYMENT',
              isCustomerVisible: true,
              message: 'Sipariş oluşturuldu.',
              actorType: isGuestOrder ? 'CUSTOMER' : 'CUSTOMER',
              actorId: userId,
            },
            {
              type: 'TARGET_CONFIRMED',
              isCustomerVisible: true,
              message: needsConfirmation
                ? 'Hedef kullanıcı tarafından onaylandı.'
                : 'Hedef doğrulandı.',
              actorType: 'CUSTOMER',
              actorId: userId,
              payload: { targetStatus: target.status, userConfirmed: input.targetConfirmed } as never,
            },
            {
              type: 'CUSTOMER_INFO_ADDED',
              isCustomerVisible: false,
              // PII MİNİMİZASYONU: ad/e-posta olay payload'ına YAZILMAZ.
              message: 'Müşteri bilgileri kaydedildi.',
              actorType: 'CUSTOMER',
              actorId: userId,
            },
            {
              type: 'CONSENT_ACCEPTED',
              isCustomerVisible: false,
              message: 'Sözleşmeler kabul edildi.',
              actorType: 'CUSTOMER',
              actorId: userId,
              payload: {
                terms: LEGAL_DOCUMENTS.terms.version,
                refund: LEGAL_DOCUMENTS.refund.version,
                privacy: LEGAL_DOCUMENTS.privacy.version,
              } as never,
            },
            {
              type: 'PAYMENT_PENDING',
              toStatus: 'PENDING_PAYMENT',
              isCustomerVisible: true,
              message: 'Ödeme bekleniyor.',
              actorType: 'SYSTEM',
            },
          ],
        },
      },
      select: { id: true, orderNo: true, status: true, totalMinor: true, currency: true },
    })

    // Hedefteki onay kaydı — kanıt olarak hedefte de tutulur
    if (needsConfirmation) {
      await tx.target.update({
        where: { id: target.id },
        data: { userConfirmed: true, userConfirmedAt: acceptedAt },
      })
    }

    // Kupon kullanımı
    if (priced.couponId) {
      await tx.coupon.update({
        where: { id: priced.couponId },
        data: { redemptionCount: { increment: 1 } },
      })
      await tx.couponRedemption.create({
        data: {
          couponId: priced.couponId,
          userId: userId!,
          orderId: order.id,
          amountMinor: b.couponDiscountMinor,
        },
      })
    }

    return order
  })

  return { order: created, accessToken: token, reused: false }
}
