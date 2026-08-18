'use client'

import { useEffect, useState } from 'react'
import { formatQuantity } from '@/lib/money'
import { withUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { PublicOrderView } from '@/server/orders/lookup'

/**
 * MÜŞTERİ İLERLEME GÖRÜNÜMÜ
 *
 * ⚠️ Yalnızca güvenli alanlar gösterilir. Operatör adı, iç not, teknik hata
 * sebebi, atama ve maliyet bilgisi bu bileşene HİÇ ULAŞMAZ — sunucudaki
 * `PublicOrderView.fulfillment` zaten bunları taşımaz.
 *
 * YOKLAMA (Faz 4 kuralı 23)
 * WebSocket/SSE YOK. Aktif siparişte 20 saniyede bir sunucudan durum okunur.
 * Sipariş tamamlandığında / iptal edildiğinde yoklama DURUR.
 */

const POLL_MS = 20_000

type FulfillmentView = NonNullable<PublicOrderView['fulfillment']>

const TONE_CLASS: Record<string, string> = {
  neutral: 'border-ink-200 bg-ink-50 text-ink-700',
  info: 'border-brand-500/25 bg-brand-50 text-brand-700',
  progress: 'border-brand-500/30 bg-brand-100 text-brand-700',
  success: 'border-success-600/30 bg-success-100 text-success-700',
  warning: 'border-warning-600/30 bg-warning-100 text-warning-700',
}

export function FulfillmentProgress({
  orderNo,
  unitLabel,
  initial,
  trackingToken,
}: {
  orderNo: string
  unitLabel: string
  initial: FulfillmentView
  trackingToken?: string | null
}) {
  const [data, setData] = useState<FulfillmentView>(initial)

  useEffect(() => {
    if (!data.polling) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function tick() {
      if (cancelled) return
      try {
        const url = `/api/v1/orders/${encodeURIComponent(orderNo)}${
          trackingToken ? `?t=${encodeURIComponent(trackingToken)}` : ''
        }`
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const json = (await res.json()) as PublicOrderView
          if (!cancelled && json.fulfillment) setData(json.fulfillment)
          // Terminal duruma gelindiyse bir sonraki tur planlanmaz.
          if (json.fulfillment && !json.fulfillment.polling) return
        }
      } catch {
        /* geçici hata — bir sonraki turda tekrar denenir */
      }
      if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS)
    }

    timer = setTimeout(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [orderNo, trackingToken, data.polling])

  const showMetrics = data.initialMetric !== null && data.goalMetric !== null

  return (
    <div
      className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]"
      data-testid="fulfillment-progress"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-h3 text-ink-900">İşlem durumu</h2>
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-caption font-medium',
            TONE_CLASS[data.tone] ?? TONE_CLASS.neutral,
          )}
          data-testid="fulfillment-status"
        >
          {data.polling && data.tone === 'progress' && (
            <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
          )}
          {data.label}
        </span>
      </div>

      <p className="mt-3 text-small leading-relaxed text-ink-600">{data.description}</p>

      {data.customerNote && (
        <p className="mt-3 rounded-[--radius-control] border border-ink-200 bg-ink-50 p-3 text-small text-ink-700">
          {data.customerNote}
        </p>
      )}

      {/* --------------------------------- İlerleme ---------------------------- */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between text-small">
          <span className="tabular text-ink-700" data-testid="progress-counts">
            {formatQuantity(data.delivered)} / {formatQuantity(data.requested)} {unitLabel}
          </span>
          <span className="tabular font-semibold text-ink-900" data-testid="progress-percent">
            %{data.percent}
          </span>
        </div>
        <div
          className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-ink-100"
          role="progressbar"
          aria-valuenow={data.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="İşlem ilerlemesi"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-[--duration-base] ease-[--ease-out-soft]"
            style={{ width: `${data.percent}%` }}
          />
        </div>
      </div>

      {/* --------------------------- Ölçüm ayrıntısı --------------------------- */}
      {showMetrics && (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink-200 pt-5 sm:grid-cols-4">
          <Metric label="Başlangıç" value={formatQuantity(data.initialMetric!)} />
          <Metric label="Mevcut" value={formatQuantity(data.currentMetric ?? data.initialMetric!)} />
          <Metric label="Hedef" value={formatQuantity(data.goalMetric!)} />
          <Metric label="Kalan" value={withUnit(data.remaining, unitLabel)} />
        </dl>
      )}

      {!showMetrics && data.remaining > 0 && (
        <p className="mt-4 text-small text-ink-600">
          Kalan: <strong>{withUnit(data.remaining, unitLabel)}</strong>
        </p>
      )}

      {data.polling && (
        <p className="mt-5 text-caption text-ink-500">
          Bu sayfa otomatik güncellenir. Kapatabilirsiniz — durum değiştiğinde size e-posta
          gönderilir.
        </p>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="tabular mt-0.5 text-body font-semibold text-ink-900">{value}</dd>
    </div>
  )
}
