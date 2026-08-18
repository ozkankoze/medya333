import type { NextRequest } from 'next/server'
import { adminHandler } from '../_handler'
import { listOrdersForAdmin, type OrderQueue } from '@/server/orders/admin'
import type { OrderStatus } from '@/lib/enums'
import { ORDER_STATUS } from '@/lib/enums'

export const dynamic = 'force-dynamic'

const QUEUES: readonly OrderQueue[] = ['active', 'awaiting_payment', 'completed', 'problem', 'all']

/**
 * GET /api/v1/admin/orders
 *
 * Varsayılan kuyruk: `active` → YALNIZCA ödenmiş siparişler.
 * Ödeme bekleyenler `awaiting_payment` kuyruğunda ayrı durur; fulfillment
 * ekibinin "yapılacak iş" listesine KARIŞMAZ.
 */
export async function GET(req: NextRequest) {
  return adminHandler({ minimumRole: 'SUPPORT' }, async () => {
    const sp = req.nextUrl.searchParams
    const queueParam = sp.get('queue')
    const statusParam = sp.get('status')

    return listOrdersForAdmin({
      queue: QUEUES.includes(queueParam as OrderQueue) ? (queueParam as OrderQueue) : 'active',
      status: (ORDER_STATUS as readonly string[]).includes(statusParam ?? '')
        ? (statusParam as OrderStatus)
        : undefined,
      search: sp.get('q')?.slice(0, 120) ?? undefined,
      platformSlug: sp.get('platform')?.slice(0, 64) ?? undefined,
      page: Number(sp.get('page')) || 1,
      pageSize: Number(sp.get('pageSize')) || 25,
    })
  })(req)
}
