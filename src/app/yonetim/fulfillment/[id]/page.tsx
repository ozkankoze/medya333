import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { formatQuantity } from '@/lib/money'
import { withUnit } from '@/lib/units'
import { ROLE_LEVEL } from '@/lib/enums'
import { ORDER_STATUS_META } from '@/lib/orders/status'
import { getSessionUser } from '@/server/auth'
import { FulfillmentError } from '@/server/fulfillment/create'
import { getFulfillmentDetail, listAssignableOperators } from '@/server/fulfillment/queue'
import {
  FulfillmentStatusBadge,
  FULFILLMENT_EVENT_LABEL,
  REPLACEMENT_STATUS_LABEL,
} from '@/components/fulfillment/StatusBadge'
import { OperatorActions } from '@/components/fulfillment/OperatorActions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'İş Detayı',
  robots: { index: false, follow: false },
}

/**
 * /yonetim/fulfillment/[id] — OPERATÖR DETAY EKRANI
 *
 * Butonlar hem DURUMA hem ROLE göre gösterilir. Sunucu tarafı yetki
 * kontrolü ayrıca her API ucunda yapılır — buradaki gizleme yalnızca UX'tir.
 */
export default async function FulfillmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/giris?next=/yonetim/fulfillment')

  const { id } = await params

  let f
  try {
    f = await getFulfillmentDetail(id, { userId: user.id, role: user.role })
  } catch (err) {
    if (err instanceof FulfillmentError) notFound()
    throw err
  }

  const isAdmin = ROLE_LEVEL[user.role] >= ROLE_LEVEL.ADMIN
  const isOperator = ROLE_LEVEL[user.role] >= ROLE_LEVEL.OPERATOR
  const operators = isOperator ? await listAssignableOperators() : []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/yonetim/fulfillment" className="text-small text-ink-500 underline">
          ← İş kuyruğu
        </Link>
      </div>

      {/* --------------------------------- Özet -------------------------------- */}
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-h3 text-ink-900" data-testid="detail-order-no">
              {f.orderNo}
            </p>
            <p className="mt-1 text-body text-ink-700">
              {f.platformName} · {f.serviceName} <span className="text-ink-500">({f.variantLabel})</span>
            </p>
            {/*
              ⚠️ HEDEF — YALNIZCA HERKESE AÇIK BİLGİ.
              Snapshot'ta parola, token, oturum veya yetkilendirme başlığı
              tutulmaz; burada gösterilebilecek tek şey zaten herkesin
              görebildiği profil/gönderi adresidir.
            */}
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-small text-ink-600">
              <span data-testid="detail-target">
                {f.targetHandle ? `@${f.targetHandle}` : '—'}
              </span>
              <span className="rounded-full bg-ink-100 px-2 py-0.5 font-sans text-caption text-ink-600">
                {f.targetType}
              </span>
              {f.targetCanonicalUrl && (
                <a
                  href={f.targetCanonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-sans text-caption text-brand-700 underline underline-offset-2"
                >
                  Hedefi aç ↗
                </a>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <FulfillmentStatusBadge status={f.status} />
            <span className="text-caption text-ink-500" data-testid="detail-order-status">
              Sipariş: {ORDER_STATUS_META[f.orderStatus].label}
            </span>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-ink-200 pt-5 sm:grid-cols-4">
          <Cell label="İstenen" value={withUnit(f.requestedQuantity, f.unitLabel)} />
          <Cell label="Başlangıç" value={f.initialMetric === null ? '—' : formatQuantity(f.initialMetric)} />
          <Cell label="Mevcut" value={f.currentMetric === null ? '—' : formatQuantity(f.currentMetric)} />
          <Cell label="Hedef" value={f.goalMetric === null ? '—' : formatQuantity(f.goalMetric)} />
          <Cell label="Teslim" value={formatQuantity(f.deliveredQuantity)} />
          <Cell label="Kalan" value={formatQuantity(f.remaining)} />
          <Cell label="İlerleme" value={`%${f.percent}`} testId="detail-percent" />
          <Cell label="Atanan" value={f.assignedToName ?? 'Atanmamış'} testId="detail-assignee" />
          {/*
            ⚠️ Ölçülen süre — yargı değil. Tanımlı SLA olmadığı için "gecikti"
            yazılmaz (bkz. src/lib/fulfillment/waiting.ts).
          */}
          <Cell
            label={f.waitingKind === 'running' ? 'İşlemde' : 'Bekleme'}
            value={f.waitingLabel?.split(': ')[1] ?? '—'}
            testId="detail-waiting"
          />
        </dl>

        {f.guaranteeEndsAt && (
          <p className="mt-4 text-caption text-ink-500">
            Garanti bitişi:{' '}
            {new Date(f.guaranteeEndsAt).toLocaleDateString('tr-TR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}{' '}
            ({f.guaranteeDays} gün)
          </p>
        )}

        {f.failureReason && (
          <div className="mt-4 rounded-[--radius-control] border border-danger-600/30 bg-danger-100 p-3">
            <p className="text-caption font-medium text-danger-700">İç hata kaydı (müşteriye gösterilmez)</p>
            <p className="mt-1 text-small text-danger-700">{f.failureReason}</p>
          </div>
        )}
      </div>

      {/* -------------------------------- Aksiyonlar --------------------------- */}
      {isOperator ? (
        <OperatorActions
          fulfillmentId={f.id}
          status={f.status}
          canOperate={f.canOperate}
          isAdmin={isAdmin}
          measurementMode={f.measurementMode}
          currentMetric={f.currentMetric}
          deliveredQuantity={f.deliveredQuantity}
          requestedQuantity={f.requestedQuantity}
          assignedToUserId={f.assignedToUserId}
          currentUserId={user.id}
          operators={operators}
          guaranteeActive={Boolean(f.guaranteeEndsAt && new Date(f.guaranteeEndsAt) > new Date())}
        />
      ) : (
        <div className="rounded-[--radius-card] border border-ink-200 bg-ink-50 p-5 text-small text-ink-600">
          Rolünüz ({user.role}) yalnızca görüntüleme yetkisi taşır. Durum ve ilerleme
          değiştirilemez; müşteriye görünür not ekleyebilirsiniz.
        </div>
      )}

      {/* ---------------------------------- Notlar ----------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <NoteCard title="İç not (müşteriye görünmez)" body={f.internalNote} />
        <NoteCard title="Müşteri notu" body={f.customerNote} />
      </div>

      {/* --------------------------------- Telafi ------------------------------ */}
      {f.replacements.length > 0 && (
        <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
          <h2 className="text-h3 text-ink-900">Telafi vakaları</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {f.replacements.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-control] border border-ink-200 p-3"
              >
                <div>
                  <p className="text-small text-ink-900">{r.reason}</p>
                  <p className="text-caption text-ink-500">
                    {formatQuantity(r.replacementQuantity)} adet ·{' '}
                    {new Date(r.createdAt).toLocaleDateString('tr-TR')}
                  </p>
                </div>
                <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-caption font-medium text-ink-700">
                  {REPLACEMENT_STATUS_LABEL[r.status] ?? r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------ Olay geçmişi --------------------------- */}
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
        <h2 className="text-h3 text-ink-900">Olay geçmişi</h2>
        <ol className="mt-4 flex flex-col gap-3">
          {f.events.map((e) => (
            <li key={e.id} className="flex gap-3 border-b border-ink-100 pb-3 last:border-0">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-small font-medium text-ink-800">
                  {FULFILLMENT_EVENT_LABEL[e.type] ?? e.type}
                  {e.fromStatus && e.toStatus && (
                    <span className="ml-2 font-normal text-ink-500">
                      {e.fromStatus} → {e.toStatus}
                    </span>
                  )}
                </p>
                {e.note && <p className="text-caption text-ink-600">{e.note}</p>}
                {(e.quantity !== null || e.currentMetric !== null) && (
                  <p className="text-caption text-ink-500">
                    {e.quantity !== null && `teslim: ${formatQuantity(e.quantity)}`}
                    {e.previousMetric !== null && e.currentMetric !== null && (
                      <> · ölçüm: {formatQuantity(e.previousMetric)} → {formatQuantity(e.currentMetric)}</>
                    )}
                  </p>
                )}
                <p className="text-caption text-ink-400">
                  {e.actorName ?? 'Sistem'} ·{' '}
                  {new Date(e.createdAt).toLocaleString('tr-TR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {e.isCustomerVisible && ' · müşteriye görünür'}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function Cell({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="tabular mt-0.5 text-body font-semibold text-ink-900" data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}

function NoteCard({ title, body }: { title: string; body: string | null }) {
  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card]">
      <p className="text-caption font-medium text-ink-500">{title}</p>
      <p className="mt-2 text-small text-ink-700">{body ?? '—'}</p>
    </div>
  )
}
