import { FulfillmentProgress } from '@/components/orders/FulfillmentProgress'
import { PayButton } from '@/components/payments/PayButton'
import { Money } from '@/components/primitives/Money'
import { StatusBadge } from '@/components/primitives/StatusBadge'
import { formatMinor } from '@/lib/money'
import { withUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { PublicOrderView } from '@/server/orders/lookup'

/**
 * SİPARİŞ DURUM GÖRÜNÜMÜ
 *
 * Aynı bileşen üç yerde kullanılır: takip sayfası, sipariş detayı, hesabım.
 *
 * ⚠️ PII MİNİMİZASYONU: Burada müşteri adı, telefonu veya tam e-postası
 * GÖSTERİLMEZ. `maskedEmail` yalnızca "doğru siparişte miyim" teyidi içindir.
 */
export function OrderView({
  order,
  trackingToken,
}: {
  order: PublicOrderView
  /** Misafir erişiminde ödeme başlatabilmek için sahiplik kanıtı */
  trackingToken?: string | null
}) {
  const awaitingPayment = order.status === 'PENDING_PAYMENT'

  return (
    <div className="flex flex-col gap-6">
      {/* --------------------------------- Başlık -------------------------------- */}
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-caption uppercase tracking-wide text-ink-500">Sipariş numarası</p>
            <p className="mt-0.5 font-mono text-h3 tracking-[0.05em] text-ink-900" data-testid="order-no">
              {order.orderNo}
            </p>
            <p className="mt-1 text-caption text-ink-500">
              {new Date(order.createdAt).toLocaleDateString('tr-TR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        <p className="mt-4 text-small leading-relaxed text-ink-600">{order.statusDescription}</p>

        {awaitingPayment && (
          <div
            className="mt-4 rounded-[--radius-control] border border-warning-600/30 bg-warning-100 p-4"
            data-testid="pending-payment-notice"
          >
            <p className="text-small font-semibold text-warning-700">Ödeme bekleniyor</p>
            <p className="mt-1 text-small leading-relaxed text-warning-700/90">
              Siparişiniz <strong>ödeme tamamlanana kadar işleme alınmaz</strong>. Bu aşamada
              hiçbir işlem başlatılmamıştır.
            </p>
            <div className="mt-4">
              <PayButton orderNo={order.orderNo} trackingToken={trackingToken ?? null} />
            </div>
          </div>
        )}
      </div>

      {/* ------------------------- Operasyon ilerlemesi -------------------------- */}
      {order.fulfillment && (
        <FulfillmentProgress
          orderNo={order.orderNo}
          unitLabel={order.unitLabel}
          initial={order.fulfillment}
          trackingToken={trackingToken ?? null}
        />
      )}

      {/* -------------------------------- Zaman çizelgesi ------------------------- */}
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
        <h2 className="text-h3 text-ink-900">Sipariş durumu</h2>

        <ol className="mt-5 flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-2">
          {order.steps.map((s, i) => (
            <li key={s.step} className="flex flex-1 items-start gap-3 pb-4 sm:flex-col sm:pb-0">
              <div className="flex items-center gap-2 sm:w-full">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                    s.state === 'done'
                      ? 'bg-brand-600 text-white'
                      : s.state === 'current'
                        ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500'
                        : 'bg-ink-100 text-ink-400',
                  )}
                  aria-hidden
                >
                  {s.state === 'done' ? '✓' : s.step + 1}
                </span>
                {i < order.steps.length - 1 && (
                  <span
                    className={cn(
                      'hidden h-0.5 flex-1 rounded-full sm:block',
                      s.state === 'done' ? 'bg-brand-600' : 'bg-ink-200',
                    )}
                    aria-hidden
                  />
                )}
              </div>
              <span
                className={cn(
                  'text-small sm:mt-2',
                  s.state === 'upcoming' ? 'text-ink-400' : 'font-medium text-ink-800',
                )}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {/* İlerleme çubuğu artık FulfillmentProgress kartında; burada
            tekrarlanmaz. Fulfillment henüz açılmamışsa (ödeme bekliyor)
            gösterilecek ilerleme de yoktur. */}
      </div>

      {/* ---------------------------------- Detay -------------------------------- */}
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
        <h2 className="text-h3 text-ink-900">Sipariş detayı</h2>
        <dl className="mt-4 divide-y divide-ink-200 border-t border-ink-200">
          <Row label="Platform" value={order.platformName} />
          <Row label="Hizmet" value={`${order.serviceName} · ${order.variantLabel}`} />
          <Row
            label="Hedef"
            value={
              <span className="font-mono text-caption">
                {order.targetHandle ? `@${order.targetHandle}` : '—'}
              </span>
            }
          />
          <Row label="Miktar" value={withUnit(order.quantity, order.unitLabel)} />
          {order.discountMinor > 0 && (
            <Row label="İndirim" value={`− ${formatMinor(order.discountMinor)}`} />
          )}
          <Row
            label="Toplam"
            value={
              <span className="text-body font-semibold text-ink-900">
                <Money minor={order.totalMinor} />{' '}
                <span className="text-caption font-normal text-ink-500">KDV dahil</span>
              </span>
            }
          />
          {order.maskedEmail && <Row label="E-posta" value={order.maskedEmail} />}
        </dl>
      </div>

      {/* -------------------------------- Olay geçmişi ---------------------------- */}
      {order.timeline.length > 0 && (
        <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
          <h2 className="text-h3 text-ink-900">Geçmiş</h2>
          <ol className="mt-4 flex flex-col gap-4">
            {order.timeline.map((e, i) => (
              <li key={`${e.type}-${i}`} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
                <div>
                  <p className="text-small font-medium text-ink-800">{e.label}</p>
                  {/* Mesaj etiketin tekrarıysa gösterilmez ("Sipariş oluşturuldu"
                      iki kez alt alta yazılıyordu). */}
                  {e.message && e.message.replace(/\.$/, '') !== e.label && (
                    <p className="text-caption text-ink-600">{e.message}</p>
                  )}
                  <p className="text-caption text-ink-400">
                    {new Date(e.at).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-small text-ink-600">{label}</dt>
      <dd className="text-right text-small text-ink-900">{value}</dd>
    </div>
  )
}
