import type { NextRequest } from 'next/server'
import { adminHandler } from '../../../_handler'
import { apiError } from '@/server/http'
import { writeAudit } from '@/server/audit'
import {
  NotificationRetryError,
  retryNotification,
} from '@/server/notifications/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/admin/notifications/{id}/retry — başarısız bildirimi yeniden dener
 *
 * ⚠️ Minimum rol **ADMIN**. Yeniden gönderim müşteriye e-posta atar; SUPPORT
 * ve OPERATOR bunu tetikleyemez.
 *
 * ⚠️ OTOMATİK TEKRAR YOKTUR. Bu uç yalnızca elle çağrılır ve yalnızca
 * `FAILED` kayıtlarda çalışır — `SENT` bir bildirimi tekrar göndermek
 * müşteriye ikinci bir e-posta demektir.
 *
 * ⚠️ IDEMPOTENCY KORUNUR: yeni bildirim satırı açılmaz, mevcut kayıt
 * `unique(orderEventId, channel)` altında yeniden üretilir.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  return adminHandler({ minimumRole: 'ADMIN' }, async ({ user, actor }) => {
    try {
      const result = await retryNotification(id, { userId: user.id, role: user.role })

      await writeAudit({
        actorId: actor.actorId,
        actorIpHash: actor.actorIpHash ?? null,
        action: 'notification.retry',
        entityType: 'Notification',
        entityId: id,
        // ⚠️ Alıcı adresi ve şablon içeriği audit'e YAZILMAZ.
        after: { outcome: result.outcome, attempts: result.attempts },
      })

      return result
    } catch (err) {
      if (err instanceof NotificationRetryError) {
        return apiError(err.code, err.message, err.status)
      }
      throw err
    }
  })(req)
}
