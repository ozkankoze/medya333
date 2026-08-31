import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ROLE_LEVEL } from '@/lib/enums'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth'
import { errorTrackingState } from '@/server/observability'
import { getMailProvider } from '@/server/mail'
import {
  getOperationAlerts,
  listNotifications,
  type NotificationFilter,
} from '@/server/notifications/admin'
import { RetryButton } from '@/components/notifications/RetryButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Bildirimler',
  robots: { index: false, follow: false },
}

const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: 'failed', label: 'Gönderilemeyen' },
  { key: 'sent', label: 'Gönderilen' },
  { key: 'skipped', label: 'Atlanan' },
  { key: 'all', label: 'Tümü' },
]

const TEMPLATE_LABEL: Record<string, string> = {
  ORDER_CREATED: 'Sipariş oluşturuldu',
  PAYMENT_RECEIVED: 'Ödeme alındı',
  ORDER_STARTED: 'İşleme alındı',
  ORDER_PROGRESS: 'Devam ediyor',
  ORDER_COMPLETED: 'Tamamlandı',
  REPLACEMENT_APPROVED: 'Telafi onaylandı',
  REPLACEMENT_COMPLETED: 'Telafi tamamlandı',
  ORDER_TRACKING: 'Takip bağlantısı',
}

const STATUS_STYLE: Record<string, string> = {
  SENT: 'bg-success-100 text-success-700',
  FAILED: 'bg-danger-100 text-danger-700',
  SKIPPED: 'bg-ink-200 text-ink-600',
  PENDING: 'bg-warning-100 text-warning-700',
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Gönderildi',
  FAILED: 'Gönderilemedi',
  SKIPPED: 'Atlandı',
  PENDING: 'Bekliyor',
}

/**
 * /admin/notifications — BİLDİRİM İZLEME (Faz 9)
 *
 * ⚠️ BU EKRAN "E-POSTA GİTTİ Mİ?" SORUSUNUN CEVABIDIR.
 * Faz 8'de bildirim kayıtları tutulmaya başlandı ama görülebilecekleri bir
 * yer yoktu; sağlayıcı bağlı değilken sessizce biriken `FAILED` kayıtları
 * kimse fark etmezdi.
 *
 * ⚠️ GÖSTERİLMEYENLER: ham e-posta adresi (kayıtta zaten maskeli),
 * takip token'ı, sağlayıcının ham cevabı, API anahtarı.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; cursor?: string; dir?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/giris?next=/admin/notifications')

  const sp = await searchParams
  const filter = (FILTERS.some((f) => f.key === sp.filter) ? sp.filter : 'failed') as NotificationFilter

  const [data, alerts] = await Promise.all([
    listNotifications({
      filter,
      ...(sp.q ? { search: sp.q } : {}),
      ...(sp.cursor ? { cursor: sp.cursor } : {}),
      ...(sp.dir === 'backward' ? { direction: 'backward' as const } : {}),
    }),
    getOperationAlerts(),
  ])

  const canRetry = ROLE_LEVEL[user.role] >= ROLE_LEVEL.ADMIN
  const mailProvider = getMailProvider()
  const tracking = errorTrackingState()

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (sp.q) p.set('q', sp.q)
    p.set('filter', filter)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) p.delete(k)
      else p.set(k, v)
    }
    return `/admin/notifications?${p.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------- Sağlayıcı durumu -------------------------- */}
      {!mailProvider.canDeliver && (
        <div
          role="alert"
          className="rounded-[--radius-card] border border-danger-600/30 bg-danger-100 p-4"
          data-testid="mail-provider-warning"
        >
          <p className="text-small font-semibold text-danger-700">
            E-posta sağlayıcısı teslim edemiyor ({mailProvider.name}).
          </p>
          <p className="mt-1 text-caption text-danger-700">
            Müşterilere <strong>hiçbir e-posta gitmiyor</strong>. Aşağıdaki başarısız kayıtlar
            bunun sonucudur — bir arıza değil, eksik yapılandırmadır.{' '}
            <code className="font-mono">EMAIL_PROVIDER=resend</code> ve{' '}
            <code className="font-mono">RESEND_API_KEY</code> tanımlandığında yeniden gönderim
            yapılabilir.
          </p>
        </div>
      )}

      {tracking !== 'active' && (
        <p className="text-caption text-ink-500" data-testid="tracking-state">
          Hata izleme durumu:{' '}
          <strong>
            {tracking === 'not_configured'
              ? 'yapılandırılmadı'
              : 'DSN var ama SDK kurulu değil — olay gönderilmiyor'}
          </strong>
        </p>
      )}

      {/* --------------------------- Operasyon uyarıları --------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Alert
          label="Gönderilemeyen bildirim"
          value={alerts.failedNotifications}
          tone={alerts.failedNotifications > 0 ? 'danger' : 'ok'}
          testId="alert-failed"
        />
        <Alert
          label="İnceleme bekleyen iş"
          value={alerts.reviewRequired}
          tone={alerts.reviewRequired > 0 ? 'warning' : 'ok'}
          href="/admin/fulfillment?bucket=review"
          testId="alert-review"
        />
        <Alert
          label="24 saatten uzun sıradaki iş"
          value={alerts.waitingOver24h}
          tone={alerts.waitingOver24h > 0 ? 'warning' : 'ok'}
          href="/admin/fulfillment?bucket=new&sort=oldest"
          testId="alert-waiting"
          /**
           * ⚠️ "GECİKTİ" DEMİYORUZ. Sistemde tanımlı bir SLA yok; uydurma bir
           * eşiğe göre gecikme ilan etmek sahte aciliyet üretir.
           */
          note="Hedef teslim süresi tanımlı değil — bu bir gecikme bildirimi değil, bir ölçümdür."
        />
        <Alert
          label="30 gün içinde garantisi bitecek"
          value={alerts.guaranteeEndingSoon}
          tone="neutral"
          testId="alert-guarantee"
          note={`Garanti süresi tanımlı olmayan ${alerts.variantsWithoutGuarantee} aktif varyant var — bu üründe garanti yoktur, süre tahmin edilmez.`}
        />
      </div>

      {/* ------------------------------- Filtreler --------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/notifications?filter=${f.key}`}
            data-testid={`filter-${f.key}`}
            className={cn(
              'rounded-[--radius-control] border px-3 py-1.5 text-small',
              f.key === filter
                ? 'border-brand-500 bg-white text-brand-700 ring-1 ring-brand-500'
                : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
            )}
          >
            {f.label}
            {f.key === 'failed' && data.counts.failed > 0 && (
              <span className="ml-1.5 rounded-full bg-danger-100 px-1.5 text-caption text-danger-700">
                {data.counts.failed}
              </span>
            )}
          </Link>
        ))}

        <form action="/admin/notifications" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="M333-XXXXXXXX"
            data-testid="notification-search"
            className="h-9 w-48 rounded-[--radius-control] border border-ink-200 px-3 font-mono text-caption uppercase"
          />
          <button
            type="submit"
            className="h-9 rounded-[--radius-control] bg-brand-600 px-3 text-small font-medium text-white hover:bg-brand-700"
          >
            Ara
          </button>
        </form>
      </div>

      {/* --------------------------------- Liste ----------------------------- */}
      {data.items.length === 0 ? (
        <div
          className="rounded-[--radius-card] border border-dashed border-ink-200 bg-white p-12 text-center"
          data-testid="notifications-empty"
        >
          <p className="text-body text-ink-700">Bu filtrede bildirim yok.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
          <table className="w-full min-w-[56rem] text-small">
            <thead className="border-b border-ink-200 text-left text-caption text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Şablon</th>
                <th className="px-4 py-3 font-medium">Sipariş</th>
                <th className="px-4 py-3 font-medium">Alıcı</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium">Sağlayıcı</th>
                <th className="px-4 py-3 font-medium">Oluşturma</th>
                <th className="px-4 py-3 font-medium">Gönderim</th>
                {canRetry && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {data.items.map((n) => (
                <tr key={n.id} data-testid="notification-row" className="hover:bg-ink-50">
                  <td className="px-4 py-3 text-ink-900">
                    {TEMPLATE_LABEL[n.template] ?? n.template}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/fulfillment?bucket=all&q=${n.orderNo}`}
                      className="font-mono text-caption text-brand-700 underline underline-offset-2"
                    >
                      {n.orderNo}
                    </Link>
                  </td>
                  {/* ⚠️ MASKELİ ADRES. Ham e-posta veritabanında da yok. */}
                  <td className="px-4 py-3 font-mono text-caption text-ink-600">
                    {n.recipientMasked}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-caption font-medium',
                        STATUS_STYLE[n.status] ?? 'bg-ink-200 text-ink-600',
                      )}
                    >
                      {STATUS_LABEL[n.status] ?? n.status}
                    </span>
                    {n.failureReason && (
                      <span className="mt-0.5 block text-caption text-ink-500">
                        {n.failureReason}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-caption text-ink-600">
                    {n.provider}
                    {n.attempts > 1 && (
                      <span className="block text-ink-400">{n.attempts} deneme</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-caption text-ink-500">
                    {new Date(n.createdAt).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-caption text-ink-500">
                    {n.sentAt
                      ? new Date(n.sentAt).toLocaleString('tr-TR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  {canRetry && (
                    <td className="px-4 py-3 text-right">
                      {n.status === 'FAILED' && <RetryButton id={n.id} orderNo={n.orderNo} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-ink-500" data-testid="notification-summary">
          Toplam {data.counts.total} bildirim · {data.counts.sent} gönderildi ·{' '}
          {data.counts.failed} gönderilemedi
        </p>
        <div className="flex gap-2">
          {data.prevCursor && (
            <Link
              href={qs({ cursor: data.prevCursor, dir: 'backward' })}
              className="rounded-[--radius-control] border border-ink-200 px-4 py-2 text-small text-ink-700 hover:bg-ink-50"
            >
              ← Önceki
            </Link>
          )}
          {data.nextCursor && (
            <Link
              href={qs({ cursor: data.nextCursor, dir: 'forward' })}
              className="rounded-[--radius-control] border border-ink-200 px-4 py-2 text-small text-ink-700 hover:bg-ink-50"
            >
              Sonraki →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function Alert({
  label,
  value,
  tone,
  href,
  note,
  testId,
}: {
  label: string
  value: number
  tone: 'ok' | 'warning' | 'danger' | 'neutral'
  href?: string
  note?: string
  testId: string
}) {
  const styles = {
    ok: 'border-ink-200 bg-white',
    warning: 'border-warning-600/30 bg-warning-100',
    danger: 'border-danger-600/30 bg-danger-100',
    neutral: 'border-ink-200 bg-white',
  }[tone]

  const body = (
    <div className={cn('h-full rounded-[--radius-card] border p-4', styles)}>
      <p className="text-caption text-ink-600">{label}</p>
      <p className="mt-1 text-h3 leading-none text-ink-900" data-testid={testId}>
        {value}
      </p>
      {note && <p className="mt-2 text-caption leading-snug text-ink-500">{note}</p>}
    </div>
  )

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}
