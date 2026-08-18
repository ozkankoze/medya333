import type { NextRequest } from 'next/server'
import { FULFILLMENT_STATUS, type FulfillmentStatus } from '@/lib/enums'
import { QUEUE_BUCKETS, type QueueBucket } from '@/lib/fulfillment/status'
import { adminHandler } from '../_handler'
import { listFulfillmentQueue } from '@/server/fulfillment/queue'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/admin/fulfillments — operasyon kuyruğu
 *
 * ⚠️ Ödenmemiş siparişler burada GÖRÜNMEZ (queue.ts'te açık filtre).
 * Sayılar gerçek DB verisinden gelir; sahte istatistik yoktur.
 *
 * Minimum rol SUPPORT (okuma).
 */
export async function GET(req: NextRequest) {
  return adminHandler({ minimumRole: 'SUPPORT' }, async ({ user }) => {
    const sp = req.nextUrl.searchParams
    const bucket = sp.get('bucket')
    const status = sp.get('status')

    return listFulfillmentQueue(
      {
        bucket:
          bucket === 'all' || (bucket && bucket in QUEUE_BUCKETS)
            ? (bucket as QueueBucket | 'all')
            : 'all',
        ...((FULFILLMENT_STATUS as readonly string[]).includes(status ?? '')
          ? { status: status as FulfillmentStatus }
          : {}),
        ...(sp.get('platform') ? { platformSlug: sp.get('platform')!.slice(0, 64) } : {}),
        ...(sp.get('service') ? { serviceSlug: sp.get('service')!.slice(0, 64) } : {}),
        ...(sp.get('operator') ? { assignedToUserId: sp.get('operator')!.slice(0, 40) } : {}),
        ...(sp.get('mine') === '1' ? { mineOnly: true } : {}),
        ...(sp.get('q') ? { search: sp.get('q')!.slice(0, 40) } : {}),
        page: Number(sp.get('page')) || 1,
        pageSize: Number(sp.get('pageSize')) || 25,
      },
      { userId: user.id, role: user.role },
    )
  })(req)
}
