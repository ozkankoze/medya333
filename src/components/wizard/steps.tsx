'use client'

import { useId } from 'react'
import { Badge } from '@/components/ui/badge'
import { FieldError, FieldHint, Input, Label } from '@/components/ui/input'
import { SelectableCard } from '@/components/ui/card'
import { formatMinor, formatQuantity, formatUnitPriceMinor } from '@/lib/money'
import { entryPriceOf, listPriceAtQuantity } from '@/lib/pricing'
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
  active,
  id,
}: {
  step: number
  title: string
  hint?: string
  done?: boolean
  /**
   * ⚠️ `done` İLE AYNI ŞEY DEĞİLDİR. Bir adım hem doldurulmuş (`done`) hem de
   * kullanıcının BULUNDUĞU adım olabilir — miktar seçerken tam olarak bu olur.
   * İkisini ayırmadan "tamamlananı soluklaştır" kuralı, aktif adımı da
   * soluklaştırıyor ve "neredeyim?" sorusunu cevapsız bırakıyordu.
   */
  active?: boolean
  /** section'ın aria-labelledby'ı bu id'ye bağlanır */
  id?: string
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {/**
       * ⚠️ ÜÇ DURUM, ÜÇ AĞIRLIK. Tamamlanan adım GERİ ÇEKİLİR (nötr gri),
       * aktif adım öne çıkar (marka rengi + halka). Hepsini aynı renkte
       * göstermek "neredeyim?" sorusunu cevapsız bırakıyordu.
       */}
      <span
        className={cn(
          'tabular flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
          'transition-all duration-[--duration-base] ease-[--ease-out-soft]',
          /* ⚠️ Aktif rozet SİYAH ZEMİN + ALTIN RAKAM. Dolu altın bir daire
             üstünde iki basamak okunmuyordu (altın/beyaz ~2:1); siyah plaka
             hem kontrastı 9:1'e çıkarıyor hem logonun dilini tekrar ediyor. */
          active
            ? 'bg-ink-975 text-gold-400 ring-4 ring-gold-500/20'
            : done
              ? 'bg-ink-100 text-ink-500'
              : 'border border-ink-200 bg-white text-ink-500',
        )}
        aria-hidden
      >
        {done && !active ? <CheckIcon /> : String(step).padStart(2, '0')}
      </span>
      <h2
        id={id}
        className={cn(
          'text-h3 transition-colors duration-[--duration-base]',
          active ? 'text-ink-950' : done ? 'text-ink-600' : 'text-ink-700',
        )}
      >
        {title}
      </h2>
      {/* Ekran okuyucu adım numarasını da duymalı */}
      <span className="sr-only">{`Adım ${step}${done ? ' — tamamlandı' : ''}`}</span>
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
        // ⚠️ EN DÜŞÜK BİRİM FİYAT DEĞİL, EN KÜÇÜK SİPARİŞİN TOPLAMI gösterilir.
        // "0,25 ₺ / takipçi'den başlar" yazmak yanıltıcıydı: o birim fiyata
        // ancak 1.000.000 takipçi alan biri ulaşıyor, minimum sipariş ise
        // 500 takipçi / 324,90 ₺.
        const entry = entryPriceOf(s.variants.flatMap((v) => v.tiers))
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
            {entry && (
              <span className="mt-auto pt-2 text-caption text-ink-500">
                {entry.kind === 'package'
                  ? `${formatMinor(entry.minOrderMinor)}'den başlar`
                  : `${withUnit(entry.minOrderQuantity, s.unitLabel)} · ${formatMinor(entry.minOrderMinor)}'den başlar`}
              </span>
            )}
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
        const entry = entryPriceOf(v.tiers)
        const isPackage = entry?.kind === 'package'
        const deltaPct =
          !isPackage && baselineUnitPrice > 0 && entry
            ? Math.round(((entry.amountMinor - baselineUnitPrice) / baselineUnitPrice) * 100)
            : 0

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
            {v.description ? (
              <span className="text-caption leading-snug text-ink-600">{v.description}</span>
            ) : v.tagline ? (
              <span className="text-caption leading-snug text-ink-600">{v.tagline}</span>
            ) : null}
            {v.packageItems.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-caption text-ink-600">
                {v.packageItems.map((item) => (
                  <li key={item} className="flex items-start gap-1.5">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-400" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
            {isPackage && entry && (
              <span className="tabular mt-1 text-small font-semibold text-ink-900">
                {formatMinor(entry.amountMinor)}
              </span>
            )}
            {/* ⚠️ Garanti rozeti HARDCODE DEĞİL: `refillDays` doluysa gösterilir,
                null ise HİÇ gösterilmez. */}
            {v.refillDays != null && v.refillDays > 0 && (
              <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-success-100 px-2.5 py-1 text-caption font-medium text-success-700">
                <ShieldIcon />
                {v.refillDays} Gün Telafi Garantisi
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
  unitPriceMinor,
  totalMinor,
  unitLabel,
}: {
  variant: CatalogVariant
  value: number
  onChange: (n: number) => void
  nextTierHint?: { minQuantity: number; unitPriceMinor: number } | null
  /**
   * Seçili miktardaki GÜNCEL birim fiyat (kuruş).
   * ⚠️ Sunucunun otoritesi değildir — yalnızca gösterim. Sipariş anında
   *    tutar `orders/create.ts` içinde YENİDEN hesaplanır ve uyuşmazsa
   *    `PriceChangedError` ile reddedilir.
   */
  unitPriceMinor?: number | null
  /** Seçili miktardaki toplam (kuruş, KDV dahil). Yalnızca gösterim. */
  totalMinor?: number | null
  /** SADECE gösterim — fiyat hesabına girmez */
  unitLabel: string
}) {
  const id = useId()
  const presets = variant.presetQuantities.filter(
    (p) => p >= variant.minQuantity && p <= variant.maxQuantity,
  )

  /**
   * ⚠️ HAZIR MİKTAR KİLİDİ (Faz 5)
   *
   * Gerçek katalogda fiyat, miktarın fonksiyonu değil; miktar–fiyat
   * EŞLEŞMESİDİR. 500 → 324,90 ₺ tanımlıysa 501 için fiyat YOKTUR. Bu yüzden
   * bu varyantlarda slider ve serbest sayı girişi HİÇ RENDER EDİLMEZ —
   * kullanıcı 7.342 yazabileceği bir alan görmez. (Sunucu da aynı kuralı
   * bağımsız olarak uygular: `presetOnly` → QUANTITY_NOT_ALLOWED.)
   */
  if (variant.presetOnly) {
    // Tek seçenekli sabit paket: seçilecek bir şey yok, paket anlatılır.
    if (presets.length <= 1) {
      const only = presets[0] ?? variant.minQuantity
      const priceMinor = listPriceAtQuantity(variant.tiers, only)
      return (
        <div
          data-testid="package-card"
          className="flex flex-col gap-3 rounded-[--radius-card] border border-ink-200 bg-white p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-body font-semibold text-ink-900">{variant.customerLabel}</span>
            {priceMinor != null && (
              <span className="tabular text-body font-semibold text-ink-900" data-testid="package-price">
                {formatMinor(priceMinor)}
              </span>
            )}
          </div>
          {variant.description && (
            <p className="text-small leading-snug text-ink-600">{variant.description}</p>
          )}
          {variant.packageItems.length > 0 && (
            <ul className="flex flex-col gap-1 text-small text-ink-700">
              {variant.packageItems.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-caption text-ink-500">{withUnit(only, unitLabel)}</p>
        </div>
      )
    }

    /**
     * "En avantajlı" rozeti: paket başına DÜŞEN birim maliyeti en düşük olan
     * paket. ⚠️ Bu bir pazarlama iddiası değil, gerçek fiyat listesinden
     * TÜRETİLEN bir karşılaştırma; müşteriye birim fiyat olarak GÖSTERİLMEZ.
     */
    const bestValue = presets.reduce<{ quantity: number; ratio: number } | null>((best, p) => {
      const price = listPriceAtQuantity(variant.tiers, p)
      if (price == null || p <= 0) return best
      const ratio = price / p
      return best === null || ratio < best.ratio ? { quantity: p, ratio } : best
    }, null)

    return (
      <div className="flex flex-col gap-3">
        {variant.description && (
          <p className="text-small leading-snug text-ink-600">{variant.description}</p>
        )}
        <div
          role="radiogroup"
          aria-label="Miktar"
          data-testid="preset-quantities"
          className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {presets.map((p) => {
            const priceMinor = listPriceAtQuantity(variant.tiers, p)
            const selected = value === p
            const isBest = presets.length > 2 && bestValue?.quantity === p
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`preset-${p}`}
                onClick={() => onChange(p)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-[--radius-control] border px-4 py-3 text-left transition-colors duration-[--duration-fast]',
                  selected
                    ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                    : 'border-ink-200 bg-white hover:bg-ink-50',
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="tabular text-small font-semibold text-ink-900">
                    {withUnit(p, unitLabel)}
                  </span>
                  {isBest && (
                    <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-caption font-medium text-brand-700">
                      En avantajlı
                    </span>
                  )}
                </span>
                {priceMinor != null && (
                  <span className="tabular text-small text-ink-700">{formatMinor(priceMinor)}</span>
                )}
                <span className="text-caption text-ink-500">Paket fiyatı · KDV dahil</span>
              </button>
            )
          })}
        </div>
        <p className="text-caption text-ink-500">
          Bu hizmette yalnızca hazır paketlerden biri seçilebilir.
        </p>
      </div>
    )
  }

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

  /** Track üzerindeki dolgu yüzdesi — thumb'ın nerede olduğu görsel olarak nettir. */
  const pct = useLog
    ? (toSlider(value) / SLIDER_STEPS) * 100
    : ((value - variant.minQuantity) / (variant.maxQuantity - variant.minQuantity)) * 100

  /**
   * ⭐ NATIVE `<input type="range">`.
   *
   * ⚠️ SAHTE SLIDER YAPILMAZ. `div` + pointer olaylarıyla kurulan "custom
   * slider"lar sürükleme, dokunma, klavye (ok tuşları, Home/End), ekran
   * okuyucu ve `prefers-reduced-motion` davranışlarını yeniden yazmayı
   * gerektirir ve genelde eksik yazılır. Native input bunların hepsini
   * HAZIR getirir; biz yalnızca GÖRÜNÜMÜNÜ değiştiriyoruz.
   *
   * Thumb ve track `::-webkit-slider-thumb` / `::-moz-range-thumb` ile
   * biçimlendirilir — davranış native kalır.
   */
  const RANGE_CLASS = cn(
    'h-2.5 w-full cursor-pointer appearance-none rounded-full bg-transparent',
    'focus-visible:outline-none',
    // — WebKit / Blink —
    '[&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full',
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-6',
    '[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:rounded-full',
    '[&::-webkit-slider-thumb]:transition-transform',
    'hover:[&::-webkit-slider-thumb]:scale-110 active:[&::-webkit-slider-thumb]:scale-95',
    'focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-gold-500/45',
    // — Firefox —
    '[&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent',
    '[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full',
    /* ⚠️ Tutamağın RENGİ burada değil `globals.css` içinde — oradaki blok
       Tailwind utility'lerinden sonra geldiği için sınıfları eziyor. */
  )

  return (
    // ⚠️ `min-w-0` — flex çocukları varsayılan olarak `min-width:auto` alır ve
    //    içeriğinden daralamaz. Büyük rakam + sayı kutusu dar ekranda kabı
    //    genişletip yatay kaydırma üretiyordu.
    <div className="flex w-full min-w-0 flex-col gap-5">
      {/* ============ 1 · SEÇİLEN MİKTAR — kartın en net elemanı ============ */}
      <div className="flex w-full min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex items-baseline gap-2.5">
          <span
            className="tabular text-metric text-ink-950"
            data-testid="quantity-display"
          >
            {formatQuantity(value)}
          </span>
          <span className="text-body font-medium text-ink-500">{unitOf(unitLabel)}</span>
        </div>

        {/* Serbest sayı girişi — slider'a alternatif, ikisi aynı state'i sürer */}
        <div className="relative w-32 shrink-0 sm:w-36">
          <Input
            type="number"
            inputMode="numeric"
            value={value}
            min={variant.minQuantity}
            max={variant.maxQuantity}
            step={variant.quantityStep || 1}
            onChange={(e) => onChange(snap(Number(e.target.value) || variant.minQuantity))}
            className="tabular h-11 pr-12 text-right"
            aria-label={`Miktar (${unitOf(unitLabel)})`}
          />
          <span
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-ink-500"
            aria-hidden
          >
            adet
          </span>
        </div>
      </div>

      {/* ==================== 2 · SLIDER ==================== */}
      <div className="w-full min-w-0 pt-1">
        <div className="relative w-full min-w-0">
          {/* Track: dolgu + kalan. `pointer-events-none` — tıklama input'a gider. */}
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-ink-150 shadow-[inset_0_1px_2px_rgb(16_24_40/0.08)]"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400 transition-[width] duration-[--duration-fast] ease-[--ease-out-soft]"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
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
            className={cn(RANGE_CLASS, 'relative')}
            data-testid="quantity-slider"
          />
        </div>

        {/* 3 · Uçlar */}
        <div className="tabular mt-2 flex justify-between text-caption text-ink-400">
          <span>{formatQuantity(variant.minQuantity)}</span>
          <span>{formatQuantity(variant.maxQuantity)}</span>
        </div>
      </div>

      {/* ==================== 4 · FİYAT ==================== */}
      {(typeof unitPriceMinor === 'number' || typeof totalMinor === 'number') && (
        <div
          className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 rounded-[--radius-card] border border-ink-200 bg-white px-4 py-3.5 shadow-[--shadow-card]"
          data-testid="quantity-price"
        >
          {typeof unitPriceMinor === 'number' && unitPriceMinor > 0 && (
            <div>
              <p className="text-caption uppercase tracking-wide text-ink-500">Birim fiyat</p>
              {/**
                * ⚠️ 2 ONDALIK — `0,6498 ₺` göstermek teknik olarak daha doğru
                * ama ucuz görünüyor ve kimse kuruşun onda birini okumuyor.
                * BİRİM FİYAT BİR ORANDIR; otorite yanındaki TOPLAM'dır ve o
                * kuruşu kuruşuna doğrudur (çapa tavanı sayesinde katalog
                * fiyatının kendisi). Oranı yuvarlamak yaygın ve dürüst.
                */}
              <p className="tabular mt-0.5 text-body font-semibold text-ink-900">
                {perUnit(formatUnitPriceMinor(Math.round(unitPriceMinor)), unitLabel)}
              </p>
            </div>
          )}
          {typeof totalMinor === 'number' && (
            <div className="text-right">
              <p className="text-caption uppercase tracking-wide text-ink-500">Toplam</p>
              <p className="tabular mt-0.5 text-h2 leading-none text-ink-950">
                {formatMinor(totalMinor)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============ 5 · SONRAKİ KADEME AVANTAJI ============ */}
      {/* ⚠️ Metin SABİT DEĞİL — sayılar `findNextTier()` çıktısından gelir. */}
      {nextTierHint && nextTierHint.minQuantity > value && (
        <div className="flex items-start gap-2.5 rounded-[--radius-control] bg-brand-50 px-3.5 py-3">
          <span className="mt-0.5 shrink-0 text-brand-600" aria-hidden>
            <TrendIcon />
          </span>
          <p className="text-small text-brand-900" data-testid="next-tier-hint">
            <strong className="font-semibold">
              {formatQuantity(nextTierHint.minQuantity)} {unitOf(unitLabel)}
            </strong>{' '}
            seçtiğinizde birim fiyat{' '}
            <strong className="font-semibold">
              {perUnit(formatUnitPriceMinor(nextTierHint.unitPriceMinor), unitLabel)}
            </strong>{' '}
            olur.
          </p>
        </div>
      )}

      {/* ============ 6 · HIZLI SEÇİM (ana yöntem DEĞİL) ============ */}
      {presets.length > 0 && (
        <div>
          <p className="mb-2 text-caption text-ink-500">Hızlı seçim</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onChange(snap(p))}
                className={cn(
                  'tabular h-8 rounded-full border px-3 text-caption font-medium transition-colors duration-[--duration-fast]',
                  value === p
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50',
                )}
              >
                {formatQuantity(p)}
              </button>
            ))}
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

function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6l-7-3Z" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
