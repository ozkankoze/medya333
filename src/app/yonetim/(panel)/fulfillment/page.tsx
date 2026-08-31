import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FULFILLMENT_STATUS, ORDER_STATUS, type FulfillmentStatus, type OrderStatus } from '@/lib/enums'
import { ORDER_STATUS_META } from '@/lib/orders/status'
import { QUEUE_BUCKETS, QUEUE_BUCKET_LABELS, type QueueBucket } from '@/lib/fulfillment/status'
import { formatQuantity } from '@/lib/money'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth'
import {
  listAssignableOperators,
  listFulfillmentQueue,
  listQueueFilterOptions,
  QUEUE_SORT_LABELS,
  QUEUE_SORTS,
  type QueueSort,
} from '@/server/fulfillment/queue'
import {
  FulfillmentStatusBadge,
  FULFILLMENT_STATUS_LABEL,
} from '@/components/fulfillment/StatusBadge'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'İş Kuyruğu',
  robots: { index: false, follow: false },
}

const BUCKETS: Array<QueueBucket | 'all'> = ['new', 'active', 'partial', 'review', 'completed', 'all']

type SP = {
  bucket?: string
  q?: string
  mine?: string
  platform?: string
  service?: string
  variant?: string
  status?: string
  orderStatus?: string
  operator?: string
  from?: string
  to?: string
  sort?: string
  cursor?: string
  dir?: string
}

/**
 * /yonetim/fulfillment — OPERASYON KUYRUĞU
 *
 * ⚠️ SUNUCU BİLEŞENİ. Filtreler basit `<form method="get">` ile çalışır:
 * arama ve filtre için istemci JavaScript'i gerekmez, sayfa adres çubuğundan
 * paylaşılabilir ve JS kapalıyken de çalışır.
 *
 * ⚠️ Tüm sayılar gerçek veritabanı sorgusundan gelir. Sahte istatistik yok.
 * ⚠️ Ödenmemiş siparişler bu kuyruğa DÜŞMEZ (server/fulfillment/queue.ts).
 * ⚠️ Sayfalama CURSOR tabanlıdır — sayfa numarası yoktur.
 */
export default async function FulfillmentQueuePage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/yonetim/giris?next=/yonetim/fulfillment')

  const sp = await searchParams
  const bucket = (
    sp.bucket && (sp.bucket === 'all' || sp.bucket in QUEUE_BUCKETS) ? sp.bucket : 'new'
  ) as QueueBucket | 'all'
  const sort = (QUEUE_SORTS as string[]).includes(sp.sort ?? '')
    ? (sp.sort as QueueSort)
    : 'newest'

  const [data, platforms, operators] = await Promise.all([
    listFulfillmentQueue(
      {
        bucket,
        sort,
        ...(sp.q ? { search: sp.q } : {}),
        ...(sp.mine === '1' ? { mineOnly: true } : {}),
        ...(sp.platform ? { platformSlug: sp.platform } : {}),
        ...(sp.service ? { serviceSlug: sp.service } : {}),
        ...(sp.variant ? { variantSlug: sp.variant } : {}),
        ...((FULFILLMENT_STATUS as readonly string[]).includes(sp.status ?? '')
          ? { status: sp.status as FulfillmentStatus }
          : {}),
        ...((ORDER_STATUS as readonly string[]).includes(sp.orderStatus ?? '')
          ? { orderStatus: sp.orderStatus as OrderStatus }
          : {}),
        ...(sp.operator ? { assignedToUserId: sp.operator } : {}),
        ...(sp.from ? { createdFrom: sp.from } : {}),
        ...(sp.to ? { createdTo: sp.to } : {}),
        ...(sp.cursor ? { cursor: sp.cursor } : {}),
        ...(sp.dir === 'backward' ? { direction: 'backward' as const } : {}),
      },
      { userId: user.id, role: user.role },
    ),
    listQueueFilterOptions(),
    listAssignableOperators(),
  ])

  /** Mevcut filtreleri koruyarak yeni bir adres üretir. */
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const keep: Array<keyof SP> = [
      'q', 'mine', 'platform', 'service', 'variant',
      'status', 'orderStatus', 'operator', 'from', 'to', 'sort', 'bucket',
    ]
    for (const k of keep) if (sp[k]) p.set(k, sp[k]!)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) p.delete(k)
      else p.set(k, v)
    }
    const s = p.toString()
    return s ? `/yonetim/fulfillment?${s}` : '/yonetim/fulfillment'
  }

  const selectedPlatform = platforms.find((pf) => pf.slug === sp.platform)
  const selectedService = selectedPlatform?.services.find((sv) => sv.slug === sp.service)

  /**
   * ⚠️ Slug'lar platformlar ARASINDA tekrar eder ("takipci" hem Instagram'da
   * hem TikTok'ta vardır). Platform seçilmediğinde listeyi slug'a göre
   * tekilleştirmezsek hem yinelenen React anahtarı hem de aynı adın iki kez
   * göründüğü bir açılır liste oluşur.
   */
  const uniqueBySlug = <T extends { slug: string }>(items: T[]): T[] => {
    const seen = new Set<string>()
    return items.filter((i) => (seen.has(i.slug) ? false : (seen.add(i.slug), true)))
  }

  const serviceOptions = uniqueBySlug(
    selectedPlatform?.services ?? platforms.flatMap((pf) => pf.services),
  )
  const variantOptions = uniqueBySlug(
    selectedService?.variants ?? serviceOptions.flatMap((sv) => sv.variants),
  )

  const hasFilters = Boolean(
    sp.q || sp.mine || sp.platform || sp.service || sp.variant ||
      sp.status || sp.orderStatus || sp.operator || sp.from || sp.to,
  )

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
              href={qs({ bucket: b, cursor: undefined, dir: undefined })}
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
      <form
        action="/yonetim/fulfillment"
        className="rounded-[--radius-card] border border-ink-200 bg-white p-4"
        data-testid="queue-filters"
      >
        <input type="hidden" name="bucket" value={bucket} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Ara" hint="Sipariş no · e-posta · hedef" htmlFor="q" className="lg:col-span-2">
            <input
              id="q"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="M333-XXXXXXXX · ornek@site.com · @kullanici"
              data-testid="queue-search"
              className="h-10 w-full rounded-[--radius-control] border border-ink-200 px-3 text-small"
            />
          </Field>

          <Field label="Platform" htmlFor="platform">
            <Select id="platform" name="platform" defaultValue={sp.platform ?? ''}>
              <option value="">Tümü</option>
              {platforms.map((pf) => (
                <option key={pf.slug} value={pf.slug}>
                  {pf.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Hizmet" htmlFor="service">
            <Select id="service" name="service" defaultValue={sp.service ?? ''}>
              <option value="">Tümü</option>
              {serviceOptions.map((sv) => (
                <option key={sv.slug} value={sv.slug}>
                  {sv.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Paket" htmlFor="variant">
            <Select id="variant" name="variant" defaultValue={sp.variant ?? ''}>
              <option value="">Tümü</option>
              {variantOptions.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.customerLabel}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="İş durumu" htmlFor="status">
            <Select id="status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Tümü</option>
              {FULFILLMENT_STATUS.map((st) => (
                <option key={st} value={st}>
                  {FULFILLMENT_STATUS_LABEL[st]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Sipariş durumu" htmlFor="orderStatus">
            <Select id="orderStatus" name="orderStatus" defaultValue={sp.orderStatus ?? ''}>
              <option value="">Tümü</option>
              {ORDER_STATUS.map((st) => (
                <option key={st} value={st}>
                  {ORDER_STATUS_META[st].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Operatör" htmlFor="operator">
            <Select id="operator" name="operator" defaultValue={sp.operator ?? ''}>
              <option value="">Tümü</option>
              <option value="unassigned">Atanmamış</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Sıralama" htmlFor="sort">
            <Select id="sort" name="sort" defaultValue={sort}>
              {QUEUE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {QUEUE_SORT_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Başlangıç" htmlFor="from">
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={sp.from ?? ''}
              className="h-10 w-full rounded-[--radius-control] border border-ink-200 px-3 text-small"
            />
          </Field>

          <Field label="Bitiş" htmlFor="to">
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={sp.to ?? ''}
              className="h-10 w-full rounded-[--radius-control] border border-ink-200 px-3 text-small"
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex h-10 items-center gap-2 rounded-[--radius-control] border border-ink-200 px-3 text-small text-ink-700">
            <input
              type="checkbox"
              name="mine"
              value="1"
              defaultChecked={sp.mine === '1'}
              className="size-4"
            />
            Bana atananlar ({data.counts.mine})
          </label>
          <button
            type="submit"
            data-testid="queue-filter-submit"
            className="h-10 rounded-[--radius-control] bg-brand-600 px-4 text-small font-medium text-white hover:bg-brand-700"
          >
            Filtrele
          </button>
          {hasFilters && (
            <Link
              href={`/yonetim/fulfillment?bucket=${bucket}`}
              className="text-small text-ink-500 underline"
            >
              Temizle
            </Link>
          )}
        </div>
      </form>

      {/* --------------------------------- Liste ------------------------------ */}
      {data.items.length === 0 ? (
        <div
          className="rounded-[--radius-card] border border-dashed border-ink-200 bg-white p-12 text-center"
          data-testid="queue-empty"
        >
          <p className="text-body text-ink-700">
            {hasFilters ? 'Bu filtrelerle eşleşen iş yok.' : 'Bu kuyrukta iş yok.'}
          </p>
          <p className="mt-1 text-small text-ink-500">
            {hasFilters
              ? 'Filtreleri temizleyip tekrar deneyin.'
              : 'Ödemesi doğrulanan siparişler buraya otomatik düşer.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
          <table className="w-full min-w-[74rem] text-small">
            <thead className="border-b border-ink-200 text-left text-caption text-ink-500">
              <tr>
                <Th>Sipariş</Th>
                <Th>Hizmet</Th>
                <Th>Hedef</Th>
                <Th className="text-right">İstenen</Th>
                <Th className="text-right">Teslim</Th>
                <Th className="w-32">İlerleme</Th>
                <Th>Operatör</Th>
                <Th>İş durumu</Th>
                <Th>Süre</Th>
                <Th>Oluşturma</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {data.items.map((f) => (
                <tr key={f.id} className="hover:bg-ink-50" data-testid="queue-row">
                  <td className="px-4 py-3">
                    <Link
                      href={`/yonetim/fulfillment/${f.id}`}
                      className="font-mono text-caption font-medium text-brand-700 underline underline-offset-2"
                      data-testid="queue-row-link"
                    >
                      {f.orderNo}
                    </Link>
                    <span className="block text-caption text-ink-400">
                      {ORDER_STATUS_META[f.orderStatus].label}
                    </span>
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
                        <div
                          className="h-full rounded-full bg-brand-600"
                          style={{ width: `${f.percent}%` }}
                        />
                      </div>
                      <span className="tabular text-caption text-ink-600">%{f.percent}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{f.assignedToName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <FulfillmentStatusBadge status={f.status} />
                  </td>
                  {/*
                    ⚠️ YALNIZCA ÖLÇÜLEN SÜRE. "gecikti" / "geç kaldı" gibi bir
                    yargı YAZILMAZ: tanımlı bir SLA olmadan hangi işin geç
                    olduğu bilinemez (bkz. src/lib/fulfillment/waiting.ts).
                    Renk de kullanılmaz — kırmızı bir rozet, yazılmamış bir
                    "gecikti" cümlesidir.
                  */}
                  <td
                    className="tabular whitespace-nowrap px-4 py-3 text-caption text-ink-600"
                    data-testid="queue-row-waiting"
                  >
                    {f.waitingLabel ?? '—'}
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

      {/* ------------------------------ Sayfalama ----------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-ink-500" data-testid="queue-summary">
          {data.filteredTotal} kayıt · sayfa başına {data.pageSize}
        </p>
        <div className="flex gap-2">
          <PageLink
            href={data.prevCursor ? qs({ cursor: data.prevCursor, dir: 'backward' }) : null}
            testId="queue-prev"
          >
            ← Önceki
          </PageLink>
          <PageLink
            href={data.nextCursor ? qs({ cursor: data.nextCursor, dir: 'forward' }) : null}
            testId="queue-next"
          >
            Sonraki →
          </PageLink>
        </div>
      </div>
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-4 py-3 font-medium', className)}>{children}</th>
}

function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string
  hint?: string
  htmlFor: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-caption text-ink-600">
        {label}
        {hint && <span className="ml-1 text-ink-400">· {hint}</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-10 w-full rounded-[--radius-control] border border-ink-200 bg-white px-2 text-small"
    />
  )
}

/** Cursor yoksa düğme pasif görünür — tıklanabilir ama boşa giden bağlantı yoktur. */
function PageLink({
  href,
  testId,
  children,
}: {
  href: string | null
  testId: string
  children: React.ReactNode
}) {
  if (!href) {
    return (
      <span
        data-testid={testId}
        aria-disabled="true"
        className="rounded-[--radius-control] border border-ink-200 px-4 py-2 text-small text-ink-300"
      >
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      data-testid={testId}
      className="rounded-[--radius-control] border border-ink-200 px-4 py-2 text-small text-ink-700 hover:bg-ink-50"
    >
      {children}
    </Link>
  )
}
