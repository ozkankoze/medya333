import { NextResponse, type NextRequest } from 'next/server'
import { PricingError } from '@/lib/pricing'
import { createOrderSchema } from '@/lib/validation'
import { writeAudit } from '@/server/audit'
import { getSessionUser } from '@/server/auth'
import { db } from '@/server/db'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { orderCreatedEmail, sendMail } from '@/server/mail'
import {
  createOrder,
  IdempotencyConflictError,
  PriceChangedError,
  TargetNotConfirmedError,
  TargetUnusableError,
} from '@/server/orders/create'
import { CouponInvalidError, VariantNotFoundError } from '@/server/pricing/resolve'
import {
  clientIpFrom,
  hashIp,
  rateLimit,
  rateLimitHeaders,
  rateLimitIdentifier,
} from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orders — SİPARİŞ OLUŞTURMA
 *
 * ⚠️ İSTEMCİ FİYATINA GÜVENİLMEZ.
 * Şema `unitPrice`, `subtotal`, `tax`, `total` alanlarını kabul etmez.
 * `clientTotalMinor` yalnızca "ekrandaki fiyat hâlâ geçerli mi" kontrolü içindir;
 * uyuşmazsa `PRICE_CHANGED` döner ve sipariş OLUŞMAZ.
 *
 * ⚠️ ÖDEME YOK → FULFILLMENT YOK.
 * Sipariş `PENDING_PAYMENT` olarak oluşur. Bu durum "aktif iş" değildir.
 *
 * IDEMPOTENCY: `Idempotency-Key` başlığı zorunlu.
 *   • aynı key + aynı gövde  → aynı sipariş, yeni kayıt açılmaz (200)
 *   • aynı key + farklı gövde → 409 IDEMPOTENCY_CONFLICT
 */

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{16,128}$/

export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return apiError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Geçerli bir Idempotency-Key başlığı gerekir.',
      400,
    )
  }

  const ipKey = rateLimitIdentifier(req.headers)
  let ipLimit
  try {
    ipLimit = await rateLimit('orders.create.ip', ipKey)
  } catch (err) {
    return handleUnexpected('orders.create', err)
  }
  if (!ipLimit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla sipariş denemesi. Lütfen biraz bekleyin.', 429, {
      headers: rateLimitHeaders(ipLimit),
    })
  }

  const user = await getSessionUser()
  if (user) {
    const userLimit = await rateLimit('orders.create.user', user.id)
    if (!userLimit.ok) {
      return apiError('RATE_LIMITED', 'Saatlik sipariş sınırına ulaşıldı.', 429, {
        headers: rateLimitHeaders(userLimit),
      })
    }
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = createOrderSchema.safeParse(body.data)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: parsed.error.flatten().fieldErrors,
    })
  }

  // Misafir siparişinde e-posta zorunlu; oturumdaki kullanıcıda gerekmez.
  if (!user && !parsed.data.guestEmail) {
    return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
      details: { guestEmail: ['E-posta adresi gerekli.'] },
    })
  }

  const ipHash = hashIp(clientIpFrom(req.headers))

  try {
    const result = await createOrder(parsed.data, {
      userId: user?.id ?? null,
      idempotencyKey,
      ipHash,
      userAgent: req.headers.get('user-agent'),
    })

    // Idempotent tekrar: yeni kayıt yok, e-posta yeniden gönderilmez.
    if (result.reused) {
      return NextResponse.json(
        {
          orderNo: result.order.orderNo,
          status: result.order.status,
          totalMinor: result.order.totalMinor,
          currency: result.order.currency,
          trackingToken: null,
          reused: true,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    await writeAudit({
      actorId: user?.id ?? null,
      actorIpHash: ipHash,
      action: 'order.create',
      entityType: 'Order',
      entityId: result.order.id,
      // PII YAZILMAZ — ad/e-posta/telefon audit'e girmez
      after: {
        orderNo: result.order.orderNo,
        status: result.order.status,
        totalMinor: result.order.totalMinor,
        isGuest: !user,
      },
    })

    // E-posta — asla siparişi düşürmez (sendMail throw etmez)
    const detail = await db.order.findUnique({
      where: { id: result.order.id },
      select: {
        orderNo: true,
        customerEmail: true,
        quantity: true,
        totalMinor: true,
        status: true,
        platform: { select: { name: true } },
        service: { select: { name: true, unitLabel: true } },
        serviceVariant: { select: { customerLabel: true } },
        target: { select: { handle: true, normalized: true } },
      },
    })
    if (detail?.customerEmail) {
      await sendMail(
        orderCreatedEmail({
          orderNo: detail.orderNo,
          email: detail.customerEmail,
          platformName: detail.platform.name,
          serviceName: detail.service.name,
          variantLabel: detail.serviceVariant.customerLabel,
          quantity: detail.quantity,
          unitLabel: detail.service.unitLabel,
          totalMinor: detail.totalMinor,
          targetHandle: detail.target.handle ?? detail.target.normalized,
          status: detail.status,
          trackingToken: result.accessToken,
        }),
      )
    }

    return NextResponse.json(
      {
        orderNo: result.order.orderNo,
        status: result.order.status,
        totalMinor: result.order.totalMinor,
        currency: result.order.currency,
        /** Başarı ekranındaki "Siparişimi Görüntüle" linki için — tek seferlik döner */
        trackingToken: result.accessToken,
        reused: false,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof PriceChangedError) {
      return apiError('PRICE_CHANGED', err.message, 409, {
        details: { serverTotalMinor: err.serverTotalMinor, breakdown: err.breakdown },
      })
    }
    if (err instanceof IdempotencyConflictError) {
      return apiError('IDEMPOTENCY_CONFLICT', err.message, 409)
    }
    if (err instanceof TargetNotConfirmedError) {
      return apiError('TARGET_NOT_CONFIRMED', err.message, 400)
    }
    if (err instanceof TargetUnusableError) {
      return apiError('TARGET_UNUSABLE', err.message, 400)
    }
    if (err instanceof VariantNotFoundError) {
      return apiError('VARIANT_NOT_FOUND', err.message, 404)
    }
    if (err instanceof CouponInvalidError) {
      return apiError('COUPON_INVALID', err.message, 400)
    }
    if (err instanceof PricingError) {
      return apiError(err.code, err.message, 400, { details: err.details })
    }
    // Unique constraint yarışı: aynı key ile iki eşzamanlı istek
    if ((err as { code?: string }).code === 'P2002') {
      return apiError(
        'IDEMPOTENCY_IN_PROGRESS',
        'Bu sipariş şu anda işleniyor. Lütfen birkaç saniye sonra tekrar deneyin.',
        409,
      )
    }
    return handleUnexpected('orders.create', err)
  }
}
