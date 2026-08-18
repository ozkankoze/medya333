'use client'

import { useId } from 'react'
import { Badge } from '@/components/ui/badge'
import { FieldError, FieldHint, Input, Label } from '@/components/ui/input'
import { SelectableCard } from '@/components/ui/card'
import { formatMinor, formatQuantity, formatUnitPriceMinor } from '@/lib/money'
import { perUnit, unitOf, withUnit } from '@/lib/units'
import { cn, formatDuration } from '@/lib/utils'
import type { CatalogPlatform, CatalogService, CatalogVariant } from '@/server/catalog/snapshot'
import { PlatformMark, PlatformTile } from './PlatformMark'

// ---------------------------------------------------------------------------
// Adım başlığı
// ---------------------------------------------------------------------------

export function StepHeading({
  step,
  title,
  hint,
  done,
  id,
}: {
  step: number
  title: string
  hint?: string
  done?: boolean
  /** section'ın aria-labelledby'ı bu id'ye bağlanır */
  id?: string
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold transition-colors duration-[--duration-fast]',
          done ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700',
        )}
        aria-hidden
      >
        {done ? <CheckIcon /> : step}
      </span>
      <h2 id={id} className="text-h3 text-ink-900">
        {title}
      </h2>
      {hint && <span className="text-small text-ink-500">{hint}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1 · Platform
// ---------------------------------------------------------------------------

export function StepPlatform({
  platforms,
  value,
  onChange,
}: {
  platforms: CatalogPlatform[]
  value: string | null
  onChange: (slug: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {platforms.map((p) => {
        const selected = p.slug === value
        return (
          <SelectableCard
            key={p.slug}
            selected={selected}
            onClick={() => onChange(p.slug)}
            className="items-center gap-2.5 p-4 text-center sm:flex-row sm:text-left"
          >
            <PlatformTile slug={p.slug} name={p.name} brandColor={p.brandColor} iconUrl={p.iconUrl} />
            <span className="text-small font-medium text-ink-900">{p.name}</span>
            {selected && (
              <span className="absolute right-3 top-3 text-brand-600" aria-hidden>
                <CheckCircle />
              </span>
            )}
          </SelectableCard>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2 · Hizmet (+ varyant)
// ---------------------------------------------------------------------------

export function StepService({
  services,
  value,
  onChange,
}: {
  services: CatalogService[]
  value: string | null
  onChange: (id: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {services.map((s) => {
        const selected = s.id === value
        const cheapest = Math.min(...s.variants.flatMap((v) => v.tiers.map((t) => t.unitPriceMinor)))
        return (
          <SelectableCard key={s.id} selected={selected} onClick={() => onChange(s.id)} className="h-full gap-1.5">
            <div className="flex w-full items-start justify-between gap-3">
              <span className="text-body font-semibold text-ink-900">{s.name}</span>
              {selected && (
                <span className="text-brand-600" aria-hidden>
                  <CheckCircle />
                </span>
              )}
            </div>
            {s.shortDescription && (
              <span className="text-small leading-snug text-ink-600">{s.shortDescription}</span>
            )}
            <span className="mt-auto pt-2 text-caption text-ink-500">
              {perUnit(formatUnitPriceMinor(cheapest), s.unitLabel)}&apos;den başlar
            </span>
          </SelectableCard>
        )
      })}
    </div>
  )
}

/**
 * Varyant seçici.
 * Tek görünür varyant varsa BU BİLEŞEN HİÇ RENDER EDİLMEZ — kullanıcıya
 * gereksiz teknik seçim gösterilmez (mimari kararı).
 */
export function VariantPicker({
  variants,
  value,
  onChange,
  baselineUnitPrice,
}: {
  variants: CatalogVariant[]
  value: string | null
  onChange: (id: string) => void
  baselineUnitPrice: number
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {variants.map((v) => {
        const selected = v.id === value
        const unit = Math.min(...v.tiers.map((t) => t.unitPriceMinor))
        const deltaPct = baselineUnitPrice > 0 ? Math.round(((unit - baselineUnitPrice) / baselineUnitPrice) * 100) : 0

        return (
          <SelectableCard
            key={v.id}
            selected={selected}
            onClick={() => onChange(v.id)}
            className="h-full justify-between gap-2"
          >
            <div className="flex w-full items-center gap-2">
              <span className="text-small font-semibold text-ink-900">{v.customerLabel}</span>
              {v.badge && <Badge tone="info">{v.badge}</Badge>}
              <span className="ml-auto flex items-center gap-2">
                {deltaPct > 0 && <span className="tabular text-caption text-ink-500">+%{deltaPct}</span>}
                {selected && (
                  <span className="text-brand-600" aria-hidden>
                    <CheckCircle />
                  </span>
                )}
              </span>
            </div>
            {v.tagline && <span className="text-caption leading-snug text-ink-600">{v.tagline}</span>}
            {v.refillDays != null && (
              <span className="mt-0.5 text-caption text-ink-500">
                {v.refillDays} gün telafi garantisi
              </span>
            )}
          </SelectableCard>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3 · Hedef
// ---------------------------------------------------------------------------

export function StepTarget({
  service,
  platform,
  value,
  onChange,
  error,
  checking,
}: {
  service: CatalogService
  platform: CatalogPlatform
  value: string
  onChange: (v: string) => void
  error?: string | null
  checking?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      {/* Etiket, placeholder, yardım metni ve örnek DB'den gelir —
          yeni hizmet eklemek bu bileşende değişiklik gerektirmez. */}
      <Label htmlFor={id}>{service.inputLabel}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60">
          <PlatformMark
            slug={platform.slug}
            name={platform.name}
            brandColor={platform.brandColor}
            size={18}
          />
        </span>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={service.inputPlaceholder}
          invalid={Boolean(error)}
          className="pl-11 pr-10"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
        />
        {checking && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2" aria-hidden>
            <Spinner />
          </span>
        )}
      </div>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : service.inputHelpText ? (
        <FieldHint>{service.inputHelpText}</FieldHint>
      ) : null}
      <FieldHint className="text-ink-400">
        Örnek: <span className="font-mono">{service.inputExample}</span>
      </FieldHint>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4 · Miktar
// ---------------------------------------------------------------------------

export function StepQuantity({
  variant,
  value,
  onChange,
  nextTierHint,
  unitLabel,
}: {
  variant: CatalogVariant
  value: number
  onChange: (n: number) => void
  nextTierHint?: { minQuantity: number; unitPriceMinor: number } | null
  /** SADECE gösterim — fiyat hesabına girmez */
  unitLabel: string
}) {
  const id = useId()
  const presets = variant.presetQuantities.filter(
    (p) => p >= variant.minQuantity && p <= variant.maxQuantity,
  )

  const snap = (n: number) => {
    const step = variant.quantityStep || 1
    const clamped = Math.min(variant.maxQuantity, Math.max(variant.minQuantity, n))
    const offset = Math.round((clamped - variant.minQuantity) / step) * step
    return Math.min(variant.maxQuantity, variant.minQuantity + offset)
  }

  /**
   * LOGARİTMİK SLIDER.
   *
   * Aralık 100–100.000 gibi geniş olduğunda lineer slider kullanılamaz:
   * ilk %1'lik hareket 1.000 adet atlar, kullanıcı 250 seçemez.
   * Oran 50x'i aşınca log ölçeğe geçiyoruz — düşük değerlerde hassas,
   * yüksek değerlerde hızlı. Dar aralıklarda lineer kalır (daha sezgisel).
   */
  const useLog = variant.maxQuantity / variant.minQuantity > 50
  const SLIDER_STEPS = 1000
  const lnMin = Math.log(variant.minQuantity)
  const lnMax = Math.log(variant.maxQuantity)

  const toSlider = (q: number) =>
    useLog
      ? Math.round(((Math.log(q) - lnMin) / (lnMax - lnMin)) * SLIDER_STEPS)
      : q

  const fromSlider = (pos: number) =>
    useLog ? snap(Math.exp(lnMin + (pos / SLIDER_STEPS) * (lnMax - lnMin))) : snap(pos)

  return (
    <div className="flex flex-col gap-4">
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(snap(p))}
              className={cn(
                'tabular h-9 rounded-full border px-4 text-small font-medium transition-colors duration-[--duration-fast]',
                value === p
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
              )}
            >
              {withUnit(p, unitLabel)}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        <input
          id={id}
          type="range"
          min={useLog ? 0 : variant.minQuantity}
          max={useLog ? SLIDER_STEPS : variant.maxQuantity}
          step={useLog ? 1 : variant.quantityStep || 1}
          value={toSlider(value)}
          onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
          aria-label="Miktar"
          aria-valuetext={withUnit(value, unitLabel)}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-ink-200 accent-brand-600"
        />
        <div className="relative w-40 shrink-0">
          <Input
            type="number"
            value={value}
            min={variant.minQuantity}
            max={variant.maxQuantity}
            step={variant.quantityStep || 1}
            onChange={(e) => onChange(snap(Number(e.target.value) || variant.minQuantity))}
            className="tabular h-11 pr-14 text-right"
            aria-label={`Miktar (${unitOf(unitLabel)})`}
          />
          <span
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-small text-ink-500"
            aria-hidden
          >
            {unitOf(unitLabel)}
          </span>
        </div>
      </div>

      {/* Sınırlar ham sayı olarak DEĞİL, slider'ın uçlarında bağlamıyla gösterilir */}
      <div className="tabular -mt-2 flex justify-between text-caption text-ink-400">
        <span>en az {withUnit(variant.minQuantity, unitLabel)}</span>
        <span>en çok {withUnit(variant.maxQuantity, unitLabel)}</span>
      </div>

      {nextTierHint && (
        <div className="flex items-start gap-2.5 rounded-[--radius-control] bg-brand-50 px-3.5 py-3">
          <span className="mt-0.5 text-brand-600" aria-hidden>
            <TrendIcon />
          </span>
          <div className="text-small text-brand-900">
            <p>
              <strong className="font-semibold">
                {withUnit(Math.max(0, nextTierHint.minQuantity - value), unitLabel)}
              </strong>{' '}
              daha ekleyerek bir sonraki fiyat seviyesine geçebilirsiniz.
            </p>
            <p className="mt-0.5 text-brand-700">
              Yeni birim fiyat:{' '}
              <strong className="font-semibold">
                {perUnit(formatUnitPriceMinor(nextTierHint.unitPriceMinor), unitLabel)}
              </strong>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 5 · Özet satırı
// ---------------------------------------------------------------------------

export function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <span className="text-small text-ink-500">{label}</span>
      <span className="text-right text-small font-medium text-ink-900">{value}</span>
    </div>
  )
}

export function formatMoney(minor: number) {
  return formatMinor(minor)
}

// ---------------------------------------------------------------------------
// İkonlar
// ---------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin text-ink-400" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}
