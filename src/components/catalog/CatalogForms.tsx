'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  minorToLira,
  parseLiraToMinor,
  parseQuantityList,
  useAdminMutation,
  type AdminMutation,
} from './admin-client'

/**
 * ⭐ KATALOG YÖNETİM FORMLARI (Faz 8)
 *
 * API'ler Faz 1'den beri vardı; eksik olan arayüzdü. Bu dosya platform,
 * hizmet, varyant ve fiyat kaydı için oluştur/düzenle formlarını içerir.
 *
 * ⚠️ FİYAT GİRİŞİ: admin TL yazar ("1.349,90"), sunucuya TAM SAYI KURUŞ
 * gider (134990). Dönüşüm `parseLiraToMinor` ile metin üzerinden yapılır;
 * kayan noktalı aritmetik KULLANILMAZ.
 *
 * ⚠️ SİLME: bu formlar silme düğmesi göstermez. Katalog kayıtları geçmiş
 * siparişlere bağlıdır ve veritabanı `Restrict` kuralıyla korunur — doğru
 * işlem PASİFLEŞTİRMEDİR. Silinebilir olan tek şey hiç kullanılmamış bir
 * kayıttır ve o da mevcut DELETE ucundan, kural ihlalinde 409 ile reddedilir.
 */

// ---------------------------------------------------------------------------
// Ortak parçalar
// ---------------------------------------------------------------------------

function Feedback({ m }: { m: AdminMutation }) {
  if (!m.error && !m.ok) return null
  return (
    <div className="mt-3" role="status" aria-live="polite">
      {m.error && (
        <p className="rounded-[--radius-control] border border-danger-600/30 bg-danger-100 px-3 py-2 text-caption text-danger-700">
          {m.error}
          {Object.entries(m.fieldErrors).map(([field, msgs]) => (
            <span key={field} className="mt-1 block">
              <strong>{field}</strong>: {msgs.join(' ')}
            </span>
          ))}
        </p>
      )}
      {m.ok && !m.error && (
        <p className="rounded-[--radius-control] border border-success-600/30 bg-success-100 px-3 py-2 text-caption text-success-700">
          Kaydedildi.
        </p>
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-ink-600">
        {label}
        {hint && <span className="ml-1 text-ink-400">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Check({
  name,
  label,
  defaultChecked,
  onChange,
  hint,
}: {
  name: string
  label: string
  defaultChecked?: boolean
  onChange?: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 text-small text-ink-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 size-4"
      />
      <span>
        {label}
        {hint && <span className="block text-caption text-ink-500">{hint}</span>}
      </span>
    </label>
  )
}

/** Katlanabilir panel — form açıkken sayfayı doldurmasın diye. */
function Panel({
  title,
  description,
  testId,
  children,
  open,
}: {
  title: string
  description?: string
  testId: string
  children: ReactNode
  open?: boolean
}) {
  return (
    <details
      className="rounded-[--radius-card] border border-ink-200 bg-white"
      data-testid={testId}
      open={open}
    >
      <summary className="cursor-pointer list-none px-5 py-3 text-small font-semibold text-ink-900">
        {title}
        {description && (
          <span className="ml-2 font-normal text-caption text-ink-500">{description}</span>
        )}
      </summary>
      <div className="border-t border-ink-100 px-5 py-4">{children}</div>
    </details>
  )
}

const inputCls =
  'h-10 w-full rounded-[--radius-control] border border-ink-200 px-3 text-small'

// ---------------------------------------------------------------------------
// PLATFORM — aktiflik + sıralama
// ---------------------------------------------------------------------------

export function PlatformControls({
  id,
  slug,
  isActive,
  sortOrder,
  canWrite,
}: {
  id: string
  slug: string
  isActive: boolean
  sortOrder: number
  canWrite: boolean
}) {
  const m = useAdminMutation()
  const [order, setOrder] = useState(String(sortOrder))

  if (!canWrite) return null

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`platform-controls-${slug}`}>
      <label className="flex items-center gap-1.5 text-caption text-ink-600">
        Sıra
        <Input
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          inputMode="numeric"
          className="tabular h-9 w-16 text-right"
          aria-label={`${slug} sıralaması`}
          data-testid={`platform-sort-${slug}`}
        />
      </label>
      <Button
        size="sm"
        variant="secondary"
        disabled={m.busy}
        data-testid={`platform-sort-save-${slug}`}
        onClick={() => {
          const n = Number(order)
          if (!Number.isInteger(n) || n < 0) return
          void m.send(`/api/v1/admin/platforms/${id}`, 'PATCH', { sortOrder: n })
        }}
      >
        Sırayı kaydet
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={m.busy}
        data-testid={`platform-toggle-${slug}`}
        onClick={() => void m.send(`/api/v1/admin/platforms/${id}`, 'PATCH', { isActive: !isActive })}
      >
        {isActive ? 'Pasifleştir' : 'Aktifleştir'}
      </Button>
      {m.error && <span className="text-caption text-danger-700">{m.error}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// HİZMET
// ---------------------------------------------------------------------------

export interface ServiceDraft {
  id?: string
  platformId: string
  name: string
  slug: string
  shortDescription: string | null
  targetType: string
  measurementMode: string
  unitLabel: string
  inputLabel: string
  inputPlaceholder: string
  inputHelpText: string | null
  inputExample: string
  sortOrder: number
}

export function ServiceForm({
  draft,
  targetTypes,
  onDone,
}: {
  draft: ServiceDraft
  /** ⚠️ Platform adapter'ının GERÇEKTEN desteklediği hedef tipleri */
  targetTypes: string[]
  onDone?: () => void
}) {
  const m = useAdminMutation()
  const editing = Boolean(draft.id)

  async function submit(form: FormData) {
    const body: Record<string, unknown> = {
      platformId: draft.platformId,
      name: String(form.get('name') ?? '').trim(),
      slug: String(form.get('slug') ?? '').trim(),
      shortDescription: String(form.get('shortDescription') ?? '').trim() || null,
      targetType: String(form.get('targetType') ?? ''),
      measurementMode: String(form.get('measurementMode') ?? 'METRIC'),
      unitLabel: String(form.get('unitLabel') ?? 'adet').trim(),
      inputLabel: String(form.get('inputLabel') ?? '').trim(),
      inputPlaceholder: String(form.get('inputPlaceholder') ?? '').trim(),
      inputHelpText: String(form.get('inputHelpText') ?? '').trim() || null,
      inputExample: String(form.get('inputExample') ?? '').trim(),
      sortOrder: Number(form.get('sortOrder') ?? 0),
      isActive: form.get('isActive') === 'on',
    }
    const ok = await m.send(
      editing ? `/api/v1/admin/services/${draft.id}` : '/api/v1/admin/services',
      editing ? 'PATCH' : 'POST',
      body,
    )
    if (ok) onDone?.()
  }

  return (
    <form action={submit} className="flex flex-col gap-3" data-testid="service-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ad">
          <input name="name" defaultValue={draft.name} required className={inputCls} />
        </Field>
        <Field label="Slug" hint="adres için, küçük harf">
          <input
            name="slug"
            defaultValue={draft.slug}
            required
            pattern="[a-z0-9-]+"
            className={inputCls}
          />
        </Field>
        <Field label="Hedef tipi" hint="platformun desteklediği">
          <select name="targetType" defaultValue={draft.targetType} className={inputCls}>
            {targetTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ölçüm" hint="METRIC: sayılabilir">
          <select name="measurementMode" defaultValue={draft.measurementMode} className={inputCls}>
            <option value="METRIC">METRIC — sayılabilir (takipçi, beğeni)</option>
            <option value="MANUAL_COUNT">MANUAL_COUNT — sayılamaz (yorum, tanıtım)</option>
          </select>
        </Field>
        <Field label="Birim" hint="takipçi, izlenme, ay…">
          <input name="unitLabel" defaultValue={draft.unitLabel} required className={inputCls} />
        </Field>
        <Field label="Sıra">
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={draft.sortOrder}
            className={inputCls}
          />
        </Field>
        <Field label="Girdi etiketi" hint="müşteriye görünür">
          <input name="inputLabel" defaultValue={draft.inputLabel} required className={inputCls} />
        </Field>
        <Field label="Girdi ipucu">
          <input
            name="inputPlaceholder"
            defaultValue={draft.inputPlaceholder}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Örnek girdi">
          <input
            name="inputExample"
            defaultValue={draft.inputExample}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Yardım metni" hint="opsiyonel">
          <input
            name="inputHelpText"
            defaultValue={draft.inputHelpText ?? ''}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Kısa açıklama" hint="müşteriye görünür, opsiyonel">
        <input
          name="shortDescription"
          defaultValue={draft.shortDescription ?? ''}
          className={inputCls}
        />
      </Field>

      <Check name="isActive" label="Aktif" defaultChecked hint="Pasif hizmet katalogda görünmez." />

      <div>
        <Button type="submit" size="sm" disabled={m.busy} data-testid="service-form-submit">
          {m.busy ? 'Kaydediliyor…' : editing ? 'Hizmeti güncelle' : 'Hizmet oluştur'}
        </Button>
      </div>
      <Feedback m={m} />
    </form>
  )
}

export function NewServicePanel({
  platformId,
  platformSlug,
  targetTypes,
}: {
  platformId: string
  platformSlug: string
  targetTypes: string[]
}) {
  return (
    <Panel title="+ Yeni hizmet" testId={`new-service-${platformSlug}`}>
      <ServiceForm
        targetTypes={targetTypes}
        draft={{
          platformId,
          name: '',
          slug: '',
          shortDescription: null,
          targetType: targetTypes[0] ?? 'PROFILE',
          measurementMode: 'METRIC',
          unitLabel: 'adet',
          inputLabel: 'Kullanıcı adı',
          inputPlaceholder: '@kullaniciadi',
          inputHelpText: null,
          inputExample: '@medya333',
          sortOrder: 0,
        }}
      />
    </Panel>
  )
}

export function EditServicePanel({
  draft,
  targetTypes,
}: {
  draft: ServiceDraft
  targetTypes: string[]
}) {
  return (
    <Panel title="Hizmeti düzenle" testId={`edit-service-${draft.slug}`}>
      <ServiceForm draft={draft} targetTypes={targetTypes} />
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// VARYANT
// ---------------------------------------------------------------------------

export interface VariantDraft {
  id?: string
  serviceId: string
  slug: string
  internalName: string
  customerLabel: string
  tagline: string | null
  description: string | null
  badge: string | null
  isDefault: boolean
  isVisible: boolean
  isActive: boolean
  packageItems: string[]
  minQuantity: number
  maxQuantity: number
  quantityStep: number
  presetQuantities: number[]
  presetOnly: boolean
  refillDays: number | null
  sortOrder: number
}

export function VariantForm({ draft, onDone }: { draft: VariantDraft; onDone?: () => void }) {
  const m = useAdminMutation()
  const [presetOnly, setPresetOnly] = useState(draft.presetOnly)
  const [localError, setLocalError] = useState<string | null>(null)
  const editing = Boolean(draft.id)

  async function submit(form: FormData) {
    setLocalError(null)

    const presets = parseQuantityList(String(form.get('presetQuantities') ?? ''))
    if (presets === null) {
      setLocalError('Hazır miktarlar yalnızca pozitif tam sayı olabilir (örn: 100, 500, 1000).')
      return
    }
    /**
     * ⚠️ İSTEMCİ TARAFI KONTROL YALNIZCA HIZLI GERİ BİLDİRİM İÇİNDİR.
     * Aynı kural sunucuda `adminVariantSchema.refine` ile de uygulanır;
     * burası atlansa bile sunucu reddeder.
     */
    if (presetOnly && presets.length === 0) {
      setLocalError('Hazır miktar kilidi açıkken en az bir miktar tanımlanmalıdır.')
      return
    }

    const packageItems = String(form.get('packageItems') ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    const refillRaw = String(form.get('refillDays') ?? '').trim()

    const body: Record<string, unknown> = {
      serviceId: draft.serviceId,
      slug: String(form.get('slug') ?? '').trim(),
      internalName: String(form.get('internalName') ?? '').trim(),
      customerLabel: String(form.get('customerLabel') ?? '').trim(),
      tagline: String(form.get('tagline') ?? '').trim() || null,
      description: String(form.get('description') ?? '').trim() || null,
      badge: String(form.get('badge') ?? '').trim() || null,
      isDefault: form.get('isDefault') === 'on',
      isVisible: form.get('isVisible') === 'on',
      isActive: form.get('isActive') === 'on',
      packageItems,
      minQuantity: Number(form.get('minQuantity') ?? 1),
      maxQuantity: Number(form.get('maxQuantity') ?? 1),
      quantityStep: Number(form.get('quantityStep') ?? 1),
      presetQuantities: presets,
      presetOnly,
      /**
       * ⚠️ GARANTİ SÜRESİ TAHMİN EDİLMEZ. Boş bırakılırsa `null` gider ve
       * müşteri yüzeyinde garanti rozeti HİÇ GÖSTERİLMEZ. "Herhâlde 30 gündür"
       * gibi bir varsayılan konmaz.
       */
      refillDays: refillRaw === '' ? null : Number(refillRaw),
      sortOrder: Number(form.get('sortOrder') ?? 0),
    }

    const ok = await m.send(
      editing ? `/api/v1/admin/variants/${draft.id}` : '/api/v1/admin/variants',
      editing ? 'PATCH' : 'POST',
      body,
    )
    if (ok) onDone?.()
  }

  return (
    <form action={submit} className="flex flex-col gap-3" data-testid="variant-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Müşteri etiketi" hint="katalogda görünen ad">
          <input
            name="customerLabel"
            defaultValue={draft.customerLabel}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Slug" hint="küçük harf">
          <input
            name="slug"
            defaultValue={draft.slug}
            required
            pattern="[a-z0-9-]+"
            className={inputCls}
          />
        </Field>
        <Field label="İç ad" hint="yalnızca panelde">
          <input
            name="internalName"
            defaultValue={draft.internalName}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Rozet" hint="opsiyonel — örn. Popüler">
          <input name="badge" defaultValue={draft.badge ?? ''} className={inputCls} />
        </Field>
        <Field label="Min. miktar">
          <input
            name="minQuantity"
            type="number"
            min={1}
            defaultValue={draft.minQuantity}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Maks. miktar">
          <input
            name="maxQuantity"
            type="number"
            min={1}
            defaultValue={draft.maxQuantity}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Adım">
          <input
            name="quantityStep"
            type="number"
            min={1}
            defaultValue={draft.quantityStep}
            className={inputCls}
          />
        </Field>
        <Field label="Sıra">
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={draft.sortOrder}
            className={inputCls}
          />
        </Field>
        <Field label="Garanti (gün)" hint="boş = garanti YOK">
          <input
            name="refillDays"
            type="number"
            min={0}
            max={365}
            defaultValue={draft.refillDays ?? ''}
            placeholder="örn. 365"
            data-testid="variant-refill-days"
            className={inputCls}
          />
        </Field>
        <Field label="Üst başlık" hint="opsiyonel">
          <input name="tagline" defaultValue={draft.tagline ?? ''} className={inputCls} />
        </Field>
      </div>

      <Field label="Açıklama" hint="müşteriye görünür, opsiyonel">
        <textarea
          name="description"
          defaultValue={draft.description ?? ''}
          rows={2}
          className="w-full rounded-[--radius-control] border border-ink-200 px-3 py-2 text-small"
        />
      </Field>

      <Field label="Paket içeriği" hint="her satır bir madde">
        <textarea
          name="packageItems"
          defaultValue={draft.packageItems.join('\n')}
          rows={3}
          data-testid="variant-package-items"
          className="w-full rounded-[--radius-control] border border-ink-200 px-3 py-2 text-small"
        />
      </Field>

      <Field label="Hazır miktarlar" hint="virgülle ayır: 100, 500, 1000">
        <input
          name="presetQuantities"
          defaultValue={draft.presetQuantities.join(', ')}
          data-testid="variant-presets-input"
          className={inputCls}
        />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <Check
          name="presetOnly"
          label="Yalnızca hazır miktarlar seçilebilsin"
          defaultChecked={draft.presetOnly}
          onChange={setPresetOnly}
          hint="Açıkken müşteri serbest miktar giremez; sunucu da listede olmayan miktarı reddeder."
        />
        <Check
          name="isDefault"
          label="Varsayılan paket"
          defaultChecked={draft.isDefault}
          hint="Hizmet açıldığında önceden seçili gelir."
        />
        <Check name="isVisible" label="Katalogda görünür" defaultChecked={draft.isVisible} />
        <Check name="isActive" label="Aktif" defaultChecked={draft.isActive} />
      </div>

      <div>
        <Button type="submit" size="sm" disabled={m.busy} data-testid="variant-form-submit">
          {m.busy ? 'Kaydediliyor…' : editing ? 'Varyantı güncelle' : 'Varyant oluştur'}
        </Button>
      </div>

      {localError && (
        <p
          role="alert"
          className="rounded-[--radius-control] border border-danger-600/30 bg-danger-100 px-3 py-2 text-caption text-danger-700"
        >
          {localError}
        </p>
      )}
      <Feedback m={m} />
    </form>
  )
}

const emptyVariant = (serviceId: string): VariantDraft => ({
  serviceId,
  slug: '',
  internalName: '',
  customerLabel: '',
  tagline: null,
  description: null,
  badge: null,
  isDefault: false,
  isVisible: true,
  isActive: true,
  packageItems: [],
  minQuantity: 100,
  maxQuantity: 10000,
  quantityStep: 1,
  presetQuantities: [],
  presetOnly: false,
  refillDays: null,
  sortOrder: 0,
})

export function NewVariantPanel({
  serviceId,
  serviceSlug,
}: {
  serviceId: string
  serviceSlug: string
}) {
  return (
    <Panel title="+ Yeni varyant" testId={`new-variant-${serviceSlug}`}>
      <VariantForm draft={emptyVariant(serviceId)} />
    </Panel>
  )
}

export function EditVariantPanel({ draft }: { draft: VariantDraft }) {
  return (
    <Panel title="Varyantı düzenle" testId="edit-variant">
      <VariantForm draft={draft} />
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// FİYAT KADEMESİ
// ---------------------------------------------------------------------------

export function NewPricingRulePanel({
  variantId,
  unitLabel,
}: {
  variantId: string
  unitLabel: string
}) {
  const m = useAdminMutation()
  const [mode, setMode] = useState<'FLAT_TIER' | 'GRADUATED' | 'PACKAGE'>('PACKAGE')
  const [localError, setLocalError] = useState<string | null>(null)

  async function submit(form: FormData) {
    setLocalError(null)

    const minQuantity = Number(form.get('minQuantity') ?? 0)
    const maxRaw = String(form.get('maxQuantity') ?? '').trim()
    const priceText = String(form.get('price') ?? '')
    const setupText = String(form.get('setupFee') ?? '0')

    const priceMinor = parseLiraToMinor(priceText)
    if (priceMinor === null || priceMinor <= 0) {
      setLocalError('Fiyat "1349,90" biçiminde ve sıfırdan büyük olmalıdır.')
      return
    }
    const setupMinor = parseLiraToMinor(setupText || '0')
    if (setupMinor === null) {
      setLocalError('Kurulum ücreti "0" veya "49,90" biçiminde olmalıdır.')
      return
    }

    /**
     * ⚠️ SABİT PAKET TEK MİKTARA KİLİTLİDİR: 500 için tanımlı fiyat 501'i
     * kapsayamaz. Bu kural sunucuda da vardır; burada üst sınırı otomatik
     * eşitleyerek admin'in aynı sayıyı iki kez yazmasını önlüyoruz.
     */
    const maxQuantity =
      mode === 'PACKAGE' ? minQuantity : maxRaw === '' ? null : Number(maxRaw)

    const body: Record<string, unknown> = {
      serviceVariantId: variantId,
      mode,
      minQuantity,
      maxQuantity,
      // PACKAGE modunda birim fiyat YOKTUR; sabit toplam ayrı alandadır.
      unitPriceMinor: mode === 'PACKAGE' ? 0 : priceMinor,
      packagePriceMinor: mode === 'PACKAGE' ? priceMinor : null,
      setupFeeMinor: setupMinor,
      isActive: true,
    }

    await m.send('/api/v1/admin/pricing-rules', 'POST', body)
  }

  return (
    <Panel
      title="+ Yeni fiyat kademesi"
      description="Tüm fiyatlar KDV DAHİL"
      testId="new-pricing-rule"
    >
      <form action={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fiyat modeli">
            <select
              name="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className={inputCls}
              data-testid="rule-mode"
            >
              <option value="PACKAGE">Sabit paket — tek miktar, sabit toplam</option>
              <option value="FLAT_TIER">Kademe — tüm miktar tek birim fiyattan</option>
              <option value="GRADUATED">Artan kademe — her kademe kendi fiyatından</option>
            </select>
          </Field>
          <Field
            label={mode === 'PACKAGE' ? 'Paket fiyatı (₺)' : 'Birim fiyat (₺)'}
            hint="KDV dahil"
          >
            <input
              name="price"
              inputMode="decimal"
              placeholder="1349,90"
              required
              data-testid="rule-price"
              className={`${inputCls} tabular text-right`}
            />
          </Field>
          <Field label={`Miktar (${unitLabel})`} hint={mode === 'PACKAGE' ? 'tek değer' : 'alt sınır'}>
            <input
              name="minQuantity"
              type="number"
              min={1}
              required
              data-testid="rule-min"
              className={`${inputCls} tabular`}
            />
          </Field>
          {mode !== 'PACKAGE' && (
            <Field label="Üst sınır" hint="boş = sınırsız">
              <input
                name="maxQuantity"
                type="number"
                min={1}
                data-testid="rule-max"
                className={`${inputCls} tabular`}
              />
            </Field>
          )}
          <Field label="Kurulum ücreti (₺)" hint="yoksa 0">
            <input
              name="setupFee"
              inputMode="decimal"
              defaultValue="0"
              className={`${inputCls} tabular text-right`}
            />
          </Field>
        </div>

        <div>
          <Button type="submit" size="sm" disabled={m.busy} data-testid="rule-submit">
            {m.busy ? 'Kaydediliyor…' : 'Kademeyi ekle'}
          </Button>
        </div>

        {localError && (
          <p
            role="alert"
            className="rounded-[--radius-control] border border-danger-600/30 bg-danger-100 px-3 py-2 text-caption text-danger-700"
          >
            {localError}
          </p>
        )}
        <Feedback m={m} />
      </form>
    </Panel>
  )
}

/** Fiyat kademesini pasifleştirir/aktifleştirir. Silme YOK — geçmiş korunur. */
export function PricingRuleToggle({
  id,
  isActive,
  minQuantity,
}: {
  id: string
  isActive: boolean
  minQuantity: number
}) {
  const m = useAdminMutation()
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={m.busy}
      data-testid={`rule-toggle-${minQuantity}`}
      onClick={() =>
        void m.send(`/api/v1/admin/pricing-rules/${id}`, 'PATCH', { isActive: !isActive })
      }
      title={
        isActive
          ? 'Pasifleştir — kademe silinmez, yalnızca yeni siparişlerde kullanılmaz.'
          : 'Aktifleştir'
      }
    >
      {m.busy ? '…' : isActive ? 'Pasifleştir' : 'Aktifleştir'}
    </Button>
  )
}

export { minorToLira }
