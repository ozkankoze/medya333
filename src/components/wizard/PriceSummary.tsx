'use client'

import { formatMinor, formatUnitPriceMinor } from '@/lib/money'
import { withUnit } from '@/lib/units'
import type { PriceBreakdown } from '@/lib/pricing/types'
import { cn, formatDuration } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * FİYAT KARTI
 *
 * Masaüstünde sağ sütunda sticky, mobilde ekranın altına yapışır.
 * Değer izomorfik `calculatePrice` ile 0 ms'de hesaplanır — ağ isteği yok.
 * `aria-live` sayesinde ekran okuyucular fiyat değişimini duyurur.
 */

export function PriceRows({
  breakdown,
  unitLabel,
}: {
  breakdown: PriceBreakdown
  unitLabel: string
}) {
  return (
    <dl className="flex flex-col gap-2.5 text-small">
      {/* Birim adı tekrarlanmaz: "1 hafta × 299,00 ₺" — "…/ hafta" eklemek
          miktarda zaten görünen birimi ikinci kez yazmak olurdu.
          Tek birimlik siparişte çarpım da anlamsız olduğu için gizlenir. */}
      <Row
        label={
          // Sabit pakette birim fiyat yoktur; "1 × 0,00 ₺" yazmak yanıltıcı olur.
          breakdown.pricingMode === 'PACKAGE' || breakdown.quantity === 1
            ? withUnit(breakdown.quantity, unitLabel)
            : `${withUnit(breakdown.quantity, unitLabel)} × ${formatUnitPriceMinor(breakdown.unitPriceMinor)}`
        }
        value={formatMinor(breakdown.listSubtotalMinor - breakdown.setupFeeMinor)}
      />
      {breakdown.setupFeeMinor > 0 && (
        <Row label="Hizmet bedeli" value={formatMinor(breakdown.setupFeeMinor)} />
      )}
      {breakdown.discountMinor > 0 && (
        <Row
          label="İndirim"
          value={`−${formatMinor(breakdown.discountMinor)}`}
          className="text-success-700"
        />
      )}

      {/* ⚠️ KDV EKLENMEZ, AYRIŞTIRILIR. Fiyatlar KDV dahildir; buradaki iki
          satır yalnızca dökümdür ve toplamı DEĞİŞTİRMEZ. */}
      <Row
        label="Ara toplam (matrah)"
        value={formatMinor(breakdown.subtotalMinor)}
        className="text-ink-500"
      />
      <Row
        label={`KDV (%${breakdown.taxRateBp / 100})`}
        value={formatMinor(breakdown.taxAmountMinor)}
        className="text-ink-500"
      />
    </dl>
  )
}

function Row({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', className)}>
      <dt className="text-ink-600">{label}</dt>
      <dd className="tabular font-medium text-ink-900">{value}</dd>
    </div>
  )
}

export function PriceSummaryCard({
  breakdown,
  etaMinutes,
  onContinue,
  continueLabel = 'Devam Et',
  disabled,
  hint,
  indicative = false,
  unitLabel = 'adet',
}: {
  breakdown: PriceBreakdown | null
  etaMinutes?: number | null
  onContinue?: () => void
  continueLabel?: string
  disabled?: boolean
  hint?: string | null
  /** Miktar adımı henüz açılmadıysa tutar kesin değil — "başlangıç fiyatı" olarak sunulur. */
  indicative?: boolean
  /** SADECE gösterim — fiyat hesabına girmez */
  unitLabel?: string
}) {
  const eta = formatDuration(etaMinutes)

  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-ink-500">
        Sipariş Özeti
      </h3>

      {breakdown ? (
        <>
          <div className="mt-4">
            <PriceRows breakdown={breakdown} unitLabel={unitLabel} />
          </div>

          <div className="my-4 h-px bg-ink-200" />

          <div className="flex items-end justify-between gap-3" aria-live="polite">
            <div>
              <p className="text-small text-ink-600">{indicative ? 'Başlangıç fiyatı' : 'Toplam'}</p>
              <p className="text-caption text-ink-400">KDV dahil</p>
            </div>
            <p className="tabular text-h1 leading-none text-ink-900">
              {formatMinor(breakdown.totalMinor)}
            </p>
          </div>

          {eta && (
            <p className="mt-4 flex items-center gap-1.5 text-caption text-ink-500">
              <ClockIcon /> Tahmini başlangıç: {eta}
            </p>
          )}
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          <div className="h-4 w-3/5 animate-pulse rounded bg-ink-100" />
          <div className="h-4 w-2/5 animate-pulse rounded bg-ink-100" />
          <div className="mt-3 h-9 w-1/2 animate-pulse rounded bg-ink-100" />
          <p className="mt-2 text-small text-ink-500">
            Fiyatı görmek için hizmet ve miktar seçin.
          </p>
        </div>
      )}

      {onContinue && (
        <Button size="lg" block className="mt-6" disabled={disabled} onClick={onContinue}>
          {continueLabel}
        </Button>
      )}

      {hint && <p className="mt-3 text-center text-caption text-ink-500">{hint}</p>}
    </div>
  )
}

/** Mobilde ekranın altına yapışan çubuk. */
export function MobilePriceBar({
  breakdown,
  onContinue,
  continueLabel = 'Devam Et',
  disabled,
  indicative = false,
  hint,
}: {
  breakdown: PriceBreakdown | null
  onContinue: () => void
  continueLabel?: string
  disabled?: boolean
  indicative?: boolean
  /** CTA pasifken NEDENİ mobilde de görünmeli — masaüstündeki kartla eşit bilgi. */
  hint?: string | null
}) {
  return (
    <div className="sticky-price-bar fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 px-4 pt-3 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-caption text-ink-500">
            {indicative ? 'Başlangıç fiyatı' : 'Toplam'} · KDV dahil
          </p>
          <p className="tabular truncate text-h3 leading-tight text-ink-900">
            {breakdown ? formatMinor(breakdown.totalMinor) : '—'}
          </p>
        </div>
        <Button size="lg" onClick={onContinue} disabled={disabled} className="shrink-0">
          {continueLabel}
        </Button>
      </div>
      {disabled && hint && (
        <p className="mx-auto mt-1.5 max-w-2xl text-caption text-ink-500">{hint}</p>
      )}
    </div>
  )
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  )
}
