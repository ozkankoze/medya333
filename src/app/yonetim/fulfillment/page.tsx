import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { QUEUE_BUCKETS, QUEUE_BUCKET_LABELS, type QueueBucket } from '@/lib/fulfillment/status'
import { formatQuantity } from '@/lib/money'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth'
import { listFulfillmentQueue } from '@/server/fulfillment/queue'
import { FulfillmentStatusBadge } from '@/components/fulfillment/StatusBadge'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'İş Kuyruğu',
  robots: { index: false, follow: false },
}

const BUCKETS: Array<QueueBucket | 'all'> = ['new', 'active', 'partial', 'review', 'completed', 'all']

/**
 * /yonetim/fulfillment — OPERATÖR DASHBOARD
 *
 * ⚠️ Tüm sayılar gerçek veritabanı sorgusundan gelir. Sahte istatistik yok.
 * ⚠️ Ödenmemiş siparişler bu kuyruğa DÜŞMEZ (server/fulfillment/queue.ts).
 */
export default async function FulfillmentQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; q?: string; mine?: string; platform?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/giris?next=/yonetim/fulfillment')

  const sp = await searchParams
  const bucket = (
    sp.bucket && (sp.bucket === 'all' || sp.bucket in QUEUE_BUCKETS) ? sp.bucket : 'new'
  ) as QueueBucket | 'all'

  const data = await listFulfillmentQueue(
    {
      bucket,
      ...(sp.q ? { search: sp.q.slice(0, 40) } : {}),
      ...(sp.mine === '1' ? { mineOnly: true } : {}),
      ...(sp.platform ? { platformSlug: sp.platform.slice(0, 64) } : {}),
      pageSize: 50,
    },
    { userId: user.id, role: user.role },
  )

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (sp.q) p.set('q', sp.q)
    if (sp.mine === '1') p.set('mine', '1')
    if (sp.platform) p.set('platform', sp.platform)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) p.delete(k)
      else p.set(k, v)
    }
    const s = p.toString()
    return s ? `/yonetim/fulfillment?${s}` : '/yonetim/fulfillment'
  }

  return (
    <div className="flex flex-col gap-6">
      {/* --------------------------- Kova sayaçları --------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.map((b) => {
          const count =
            b === 'all'
              ? data.counts.new + data.counts.active + data.counts.partial + data.counts.review
              : data.counts[b]
          const active = b === bucket
          return (
            <Link
              key={b}
              href={qs({ bucket: b })}
              className={cn(
                'rounded-[--radius-card] border p-4 transition-shadow',
                active
                  ? 'border-brand-500 bg-white shadow-[--shadow-lifted] ring-1 ring-brand-500'
                  : 'border-ink-200 bg-white shadow-[--shadow-card] hover:shadow-[--shadow-lifted]',
              )}
            >
              <p className="text-caption text-ink-500">
                {b === 'all' ? 'Açık İşler' : QUEUE_BUCKET_LABELS[b]}
              </p>
              <p className="mt-1 text-h2 leading-none text-ink-900" data-testid={`count-${b}`}>
                {count}
              </p>
            </Link>
          )
        })}
      </div>

      {/* ------------------------------- Filtreler ---------------------------- */}
      <form action="/yonetim/fulfillment" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="bucket" value={bucket} />
        <div>
          <label htmlFor="q" className="block text-caption text-ink-600">
            Sipariş No
          </label>
          <input
            id="q"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="M333-XXXXXXXX"
            className="mt-1 h-10 w-56 rounded-[--radius-control] border border-ink-200 px-3 font-mono text-small uppercase"
          />
        </div>
        <label className="flex h-10 items-center gap-2 rounded-[--radius-control] border border-ink-200 px-3 text-small text-ink-700">
          <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === '1'} className="size-4" />
          Bana atananlar ({data.counts.mine})
        </label>
        <button
          type="submit"
          className="h-10 rounded-[--radius-control] bg-brand-600 px-4 text-small font-medium text-white hover:bg-brand-700"
        >
          Filtrele
        </button>
        {(sp.q || sp.mine) && (
          <Link href={qs({ q: undefined, mine: undefined })} className="text-small text-ink-500 underline">
            Temizle
          </Link>
        )}
      </form>

      {/* --------------------------------- Liste ------------------------------ */}
      {data.items.length === 0 ? (
        <div className="rounded-[--radius-card] border border-dashed border-ink-200 bg-white p-12 text-center">
          <p className="text-body text-ink-700">Bu kuyrukta iş yok.</p>
          <p className="mt-1 text-small text-ink-500">
            Ödemesi doğrulanan siparişler buraya otomatik düşer.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
          <table className="w-full text-small">
            <thead className="border-b border-ink-200 text-left text-caption text-ink-500">
              <tr>
                <Th>Sipariş</Th>
                <Th>Hizmet</Th>
                <Th>Hedef</Th>
                <Th className="text-right">İstenen</Th>
                <Th className="text-right">Teslim</Th>
                <Th className="w-32">İlerleme</Th>
                <Th>Operatör</Th>
                <Th>Durum</Th>
                <Th>Oluşturma</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {data.items.map((f) => (
                <tr key={f.id} className="hover:bg-ink-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/yonetim/fulfillment/${f.id}`}
                      className="font-mono text-caption font-medium text-brand-700 underline underline-offset-2"
                      data-testid="queue-row-link"
                    >
                      {f.orderNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-ink-900">
                      {f.platformName} · {f.serviceName}
                    </span>
                    <span className="block text-caption text-ink-500">{f.variantLabel}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-caption text-ink-700">
                    {f.targetHandle ? `@${f.targetHandle}` : '—'}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-ink-900">
                    {formatQuantity(f.requestedQuantity)}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-ink-900">
                    {formatQuantity(f.deliveredQuantity)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${f.percent}%` }} />
                      </div>
                      <span className="tabular text-caption text-ink-600">%{f.percent}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{f.assignedToName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <FulfillmentStatusBadge status={f.status} />
                  </td>
                  <td className="px-4 py-3 text-caption text-ink-500">
                    {new Date(f.createdAt).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-caption text-ink-500">
        {data.total} kayıt · sayfa {data.page}/{data.totalPages}
      </p>
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-4 py-3 font-medium', className)}>{children}</th>
}
