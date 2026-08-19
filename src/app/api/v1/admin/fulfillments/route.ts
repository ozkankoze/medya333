import type { NextRequest } from 'next/server'
import {
  FULFILLMENT_STATUS,
  ORDER_STATUS,
  type FulfillmentStatus,
  type OrderStatus,
} from '@/lib/enums'
import { QUEUE_BUCKETS, type QueueBucket } from '@/lib/fulfillment/status'
import { adminHandler } from '../_handler'
import {
  DEFAULT_QUEUE_PAGE_SIZE,
  listFulfillmentQueue,
  QUEUE_SORTS,
  type QueueSort,
} from '@/server/fulfillment/queue'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/admin/fulfillments — operasyon kuyruğu
 *
 * ⚠️ ZİNCİR: kimlik → yetki (min. SUPPORT) → rate limit → doğrulama.
 * Dördü de `adminHandler` içinde uygulanır; bu uç hiçbirini atlayamaz.
 * CUSTOMER rolü 403 alır.
 *
 * ⚠️ Ödenmemiş siparişler burada GÖRÜNMEZ (queue.ts'te açık filtre).
 * ⚠️ Sayfalama CURSOR tabanlıdır; `page` parametresi YOKTUR.
 * Sayılar gerçek DB verisinden gelir; sahte istatistik yoktur.
 */
export async function GET(req: NextRequest) {
  return adminHandler({ minimumRole: 'SUPPORT' }, async ({ user }) => {
    const sp = req.nextUrl.searchParams

    /** ⚠️ Her serbest metin alanı uzunlukla sınırlanır (pahalı tarama engeli). */
    const str = (key: string, max: number) => {
      const v = sp.get(key)?.trim()
      return v ? v.slice(0, max) : undefined
    }

    const bucket = sp.get('bucket')
    const status = sp.get('status')
    const orderStatus = sp.get('orderStatus')
    const sort = sp.get('sort')

    return listFulfillmentQueue(
      {
        bucket:
          bucket === 'all' || (bucket && bucket in QUEUE_BUCKETS)
            ? (bucket as QueueBucket | 'all')
            : 'all',
        ...((FULFILLMENT_STATUS as readonly string[]).includes(status ?? '')
          ? { status: status as FulfillmentStatus }
          : {}),
        ...((ORDER_STATUS as readonly string[]).includes(orderStatus ?? '')
          ? { orderStatus: orderStatus as OrderStatus }
          : {}),
        ...(str('platform', 64) ? { platformSlug: str('platform', 64)! } : {}),
        ...(str('service', 64) ? { serviceSlug: str('service', 64)! } : {}),
        ...(str('variant', 64) ? { variantSlug: str('variant', 64)! } : {}),
        ...(str('operator', 40) ? { assignedToUserId: str('operator', 40)! } : {}),
        ...(sp.get('mine') === '1' ? { mineOnly: true } : {}),
        ...(str('q', 120) ? { search: str('q', 120)! } : {}),
        ...(str('from', 32) ? { createdFrom: str('from', 32)! } : {}),
        ...(str('to', 32) ? { createdTo: str('to', 32)! } : {}),
        ...((QUEUE_SORTS as readonly string[]).includes(sort ?? '')
          ? { sort: sort as QueueSort }
          : {}),
        ...(str('cursor', 40) ? { cursor: str('cursor', 40)! } : {}),
        ...(sp.get('dir') === 'backward' ? { direction: 'backward' as const } : {}),
        pageSize: Number(sp.get('pageSize')) || DEFAULT_QUEUE_PAGE_SIZE,
      },
      { userId: user.id, role: user.role },
    )
  })(req)
}
