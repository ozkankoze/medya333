import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import type { ZodTypeAny, z } from 'zod'
import { requireRole, type SessionUser } from '@/server/auth'
import { CatalogAdminError, type ActorContext } from '@/server/catalog/admin'
import { AdminOrderError } from '@/server/orders/admin'
import { PaymentError } from '@/server/payments/create'
import { apiError, handleUnexpected, MAX_ADMIN_BODY_BYTES, readJsonBody } from '@/server/http'
import { hashIp, clientIpFrom, rateLimit, rateLimitHeaders } from '@/server/ratelimit'
import type { UserRole } from '@/lib/enums'

/**
 * ADMIN ROUTE SARMALAYICISI
 *
 * Her admin endpoint'i BU fonksiyondan geçer. Böylece hiçbir endpoint
 * yanlışlıkla korumasız kalamaz. Sağladıkları:
 *
 *   1. AUTHENTICATION — oturum yoksa 401
 *   2. AUTHORIZATION  — rol yetersizse 403 (varsayılan minimum: ADMIN)
 *   3. Rate limit     — kullanıcı başına 100/dk
 *   4. İstek boyutu   — 256 KB üstü 413
 *   5. Zod doğrulama  — gövde şemaya uymazsa 400 + alan bazlı detay
 *   6. Güvenli hata   — iç detay sızmaz, stack log'a gider
 *   7. Aktör bağlamı  — audit log için actorId + tuzlanmış IP hash'i
 */

export interface AdminContext<T> {
  input: T
  actor: ActorContext
  user: SessionUser
  req: NextRequest
}

export interface AdminHandlerOptions<S extends ZodTypeAny | undefined> {
  schema?: S
  minimumRole?: UserRole
}

type Inferred<S> = S extends ZodTypeAny ? z.infer<S> : undefined

export function adminHandler<S extends ZodTypeAny | undefined = undefined>(
  options: AdminHandlerOptions<S>,
  handler: (ctx: AdminContext<Inferred<S>>) => Promise<unknown>,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      // 1-2) Kimlik + yetki
      const user = await requireRole(options.minimumRole ?? 'ADMIN')

      // 3) Rate limit
      const limit = await rateLimit('admin.api.user', user.id)
      if (!limit.ok) {
        return apiError('RATE_LIMITED', 'Çok fazla istek.', 429, {
          headers: rateLimitHeaders(limit),
        })
      }

      // 4-5) Gövde + doğrulama
      let input: unknown = undefined
      if (options.schema) {
        const body = await readJsonBody(req, MAX_ADMIN_BODY_BYTES)
        if (!body.ok) return body.response
        const parsed = options.schema.safeParse(body.data)
        if (!parsed.success) {
          return apiError('VALIDATION_ERROR', 'Girdiler geçersiz.', 400, {
            details: parsed.error.flatten().fieldErrors,
          })
        }
        input = parsed.data
      }

      const actor: ActorContext = {
        actorId: user.id,
        actorIpHash: hashIp(clientIpFrom(req.headers)),
      }

      const result = await handler({
        input: input as Inferred<S>,
        actor,
        user,
        req,
      })

      return NextResponse.json(result ?? { ok: true }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    } catch (err) {
      // 6) Güvenli hata cevabı
      if (err instanceof CatalogAdminError) {
        return apiError(err.code, err.message, err.status, { details: err.details })
      }
      if (err instanceof AdminOrderError) {
        return apiError(err.code, err.message, err.status)
      }
      // PaymentError / RefundError (RefundError ondan türer)
      if (err instanceof PaymentError) {
        return apiError(err.code, err.message, err.status)
      }
      return handleUnexpected('admin', err)
    }
  }
}
