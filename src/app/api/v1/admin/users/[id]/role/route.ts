import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { USER_ROLE } from '@/lib/enums'
import { adminHandler } from '../../../_handler'
import { apiError } from '@/server/http'
import { changeUserRole, UserAdminError } from '@/server/users/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({ role: z.enum(USER_ROLE) })

/**
 * PATCH /api/v1/admin/users/{id}/role — kullanıcı rolü değiştirme
 *
 * ⚠️ Minimum rol **ADMIN**. CUSTOMER, SUPPORT ve OPERATOR bu uca hiç giremez —
 * dolayısıyla bir müşterinin kendini ADMIN yapması mümkün değildir.
 *
 * ⚠️ ADMIN olmak da yetmez. Servis katmanı ayrıca şunları uygular:
 *   • kimse KENDİ rolünü değiştiremez
 *   • ADMIN, kendi seviyesinde/üstünde rol ATAYAMAZ
 *   • ADMIN, kendi seviyesinde/üstünde kullanıcıyı DEĞİŞTİREMEZ
 *   • son SUPERADMIN düşürülemez (kilitlenme koruması)
 *
 * ⚠️ Her değişiklik AuditLog'a yazılır: kim, ne zaman, hangi kullanıcı,
 * eski rol → yeni rol. PII yazılmaz.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  return adminHandler({ schema, minimumRole: 'ADMIN' }, async ({ input, user, actor }) => {
    try {
      return await changeUserRole({
        userId: id,
        role: input.role,
        actorId: user.id,
        actorRole: user.role,
        actorIpHash: actor.actorIpHash ?? null,
      })
    } catch (err) {
      if (err instanceof UserAdminError) {
        return apiError(err.code, err.message, err.status)
      }
      throw err
    }
  })(req)
}
