import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminHandler } from '../../../_handler'
import { createRefund, getRefundSummary, RefundError } from '@/server/payments/refund'
import { clientIpFrom, rateLimit, rateLimitHeaders } from '@/server/ratelimit'
import { apiError } from '@/server/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orderNo: string }> }

const refundSchema = z.object({
  /** Kuruş. Tam iade için kalan tutarın tamamı gönderilir. */
  amountMinor: z.number().int().positive('İade tutarı sıfırdan büyük olmalıdır.'),
  reason: z.string().trim().min(3, 'İade gerekçesi gerekli.').max(500),
})

/** GET — iade özeti: ne kadarı tahsil edildi, ne kadarı iade edilebilir. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { orderNo } = await ctx.params
  return adminHandler({ minimumRole: 'SUPPORT' }, async () => {
    const summary = await getRefundSummary(orderNo)
    if (!summary) throw new RefundError('ORDER_NOT_FOUND', 'Sipariş bulunamadı.', 404)
    return summary
  })(req)
}

/**
 * POST — iade yap.
 *
 * ⚠️ Minimum rol SUPERADMIN. Para iadesi geri alınamaz bir işlemdir; OPERATOR
 * ve ADMIN yetkisi yetmez (şemadaki çift onay alanlarıyla uyumlu).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { orderNo } = await ctx.params
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''

  return adminHandler(
    { schema: refundSchema, minimumRole: 'SUPERADMIN' },
    async ({ input, actor, req: r, user }) => {
      /**
       * ⚠️ Genel yönetim limiti (100/dk) para iadesi için FAZLA cömerttir:
       * iade geri alınamaz ve her biri sağlayıcıya gerçek bir işlem yollar.
       * Kişi başına ayrı ve dar bir tavan uygulanır.
       */
      const limit = await rateLimit('admin.refund.user', user.id)
      if (!limit.ok) {
        return apiError('RATE_LIMITED', 'Çok fazla iade işlemi. Lütfen bekleyin.', 429, {
          headers: rateLimitHeaders(limit),
        })
      }

      if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
        throw new RefundError(
          'IDEMPOTENCY_KEY_REQUIRED',
          'Geçerli bir Idempotency-Key başlığı gerekir.',
          400,
        )
      }
      return createRefund({
        orderNo,
        amountMinor: input.amountMinor,
        reason: input.reason,
        requestedById: actor.actorId,
        actorIpHash: actor.actorIpHash ?? null,
        idempotencyKey,
        ip: clientIpFrom(r.headers),
      })
    },
  )(req)
}
