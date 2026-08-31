import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ROLE_LEVEL } from '@/lib/enums'
import { formatMinor, formatQuantity } from '@/lib/money'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth'
import { validatePricingTable } from '@/server/catalog/admin'
import { db } from '@/server/db'
import { CatalogToggle } from '@/components/catalog/CatalogToggle'
import {
  EditVariantPanel,
  NewPricingRulePanel,
} from '@/components/catalog/CatalogForms'
import { PricingEditor } from '@/components/catalog/PricingEditor'
import { PriceSimulator } from '@/components/catalog/PriceSimulator'
import { ValidationReport } from '@/components/catalog/ValidationReport'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Varyant',
  robots: { index: false, follow: false },
}

/**
 * /admin/katalog/[id] — VARYANT VE FİYAT DÜZENLEME
 *
 * ⚠️ Fiyat yazma işlemleri `/api/v1/admin/pricing-rules` üzerinden gider:
 * auth → rol → rate limit → gövde sınırı → Zod → iş kuralı → AuditLog zinciri
 * orada uygulanır. Bu sayfa yalnızca arayüzdür.
 */
export default async function VariantAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/giris?next=/admin/katalog')

  const { id } = await params
  const variant = await db.serviceVariant.findUnique({
    where: { id },
    include: {
      service: { include: { platform: true } },
      pricingRules: { orderBy: [{ minQuantity: 'asc' }] },
    },
  })
  if (!variant) notFound()

  const report = await validatePricingTable(variant.id)
  const canWrite = ROLE_LEVEL[user.role] >= ROLE_LEVEL.ADMIN

  const audits = await db.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'ServiceVariant', entityId: variant.id },
        {
          entityType: 'PricingRule',
          entityId: { in: variant.pricingRules.map((r) => r.id) },
        },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: { actor: { select: { email: true, name: true } } },
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/katalog" className="text-caption text-brand-600 hover:underline">
            ← Katalog
          </Link>
          <h2 className="mt-1 text-h3 text-ink-900" data-testid="variant-title">
            {variant.service.platform.name} · {variant.service.name} · {variant.customerLabel}
          </h2>
          <p className="mt-1 text-small text-ink-500">{variant.internalName}</p>
        </div>
        {canWrite && (
          <CatalogToggle
            kind="variants"
            id={variant.id}
            isActive={variant.isActive}
            label={variant.customerLabel}
          />
        )}
      </div>

      {/* ---------------------------- Özet ---------------------------------- */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Durum" value={variant.isActive ? 'Aktif' : 'Pasif'} />
        <Stat label="Birim" value={variant.service.unitLabel} />
        <Stat label="Hedef tipi" value={variant.service.targetType} />
        <Stat
          label="Miktar modeli"
          value={variant.presetOnly ? 'Hazır miktar' : 'Serbest miktar'}
        />
        <Stat
          label="Garanti"
          value={
            /* ⚠️ Tanımlı değilse "yok" yazılır — varsayılan gün UYDURULMAZ. */
            variant.refillDays && variant.refillDays > 0
              ? `${variant.refillDays} gün telafi`
              : 'Tanımlı değil'
          }
        />
        <Stat label="Fiyat noktası" value={String(variant.pricingRules.length)} />
        <Stat
          label="Oluşturma"
          value={variant.createdAt.toLocaleDateString('tr-TR')}
        />
        <Stat
          label="Son güncelleme"
          value={variant.updatedAt.toLocaleDateString('tr-TR')}
        />
      </dl>

      {variant.presetOnly && (
        <div className="rounded-[--radius-card] border border-ink-200 bg-white p-4">
          <p className="text-small font-medium text-ink-900">Seçilebilir miktarlar</p>
          <p className="mt-1 text-caption text-ink-500">
            ⚠️ Bu varyantta yalnızca aşağıdaki miktarlar sipariş edilebilir. Listede olmayan bir
            miktar hem arayüzde seçilemez hem de sunucuda reddedilir.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="variant-presets">
            {variant.presetQuantities.map((q) => (
              <span
                key={q}
                className="tabular rounded-full bg-ink-100 px-2.5 py-1 text-caption text-ink-700"
              >
                {formatQuantity(q)}
              </span>
            ))}
          </div>
        </div>
      )}

      {variant.packageItems.length > 0 && (
        <div className="rounded-[--radius-card] border border-ink-200 bg-white p-4">
          <p className="text-small font-medium text-ink-900">Paket içeriği (müşteriye görünür)</p>
          <ul className="mt-2 flex flex-col gap-1 text-small text-ink-700">
            {variant.packageItems.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------ Doğrulama raporu -------------------------- */}
      <ValidationReport report={report} />

      {/* --------------------------- Fiyatlar ------------------------------- */}
      <PricingEditor
        variantId={variant.id}
        canWrite={canWrite}
        unitLabel={variant.service.unitLabel}
        rules={variant.pricingRules.map((r) => ({
          id: r.id,
          mode: r.mode,
          minQuantity: r.minQuantity,
          maxQuantity: r.maxQuantity,
          unitPriceMinor: r.unitPriceMinor,
          packagePriceMinor: r.packagePriceMinor,
          setupFeeMinor: r.setupFeeMinor,
          isActive: r.isActive,
        }))}
      />

      {canWrite && <NewPricingRulePanel variantId={variant.id} unitLabel={variant.service.unitLabel} />}

      {canWrite && (
        <EditVariantPanel
          draft={{
            id: variant.id,
            serviceId: variant.serviceId,
            slug: variant.slug,
            internalName: variant.internalName,
            customerLabel: variant.customerLabel,
            tagline: variant.tagline,
            description: variant.description,
            badge: variant.badge,
            isDefault: variant.isDefault,
            isVisible: variant.isVisible,
            isActive: variant.isActive,
            packageItems: variant.packageItems,
            minQuantity: variant.minQuantity,
            maxQuantity: variant.maxQuantity,
            quantityStep: variant.quantityStep,
            presetQuantities: variant.presetQuantities,
            presetOnly: variant.presetOnly,
            refillDays: variant.refillDays,
            sortOrder: variant.sortOrder,
          }}
        />
      )}

      {/* -------------------------- Simülatör ------------------------------- */}
      <PriceSimulator
        variantId={variant.id}
        suggested={
          variant.presetQuantities.length > 0
            ? variant.presetQuantities.slice(0, 10)
            : [variant.minQuantity, variant.maxQuantity]
        }
      />

      {/* --------------------------- Denetim -------------------------------- */}
      <section className="rounded-[--radius-card] border border-ink-200 bg-white">
        <header className="border-b border-ink-200 px-5 py-3">
          <h3 className="text-small font-semibold text-ink-900">Fiyat değişiklik geçmişi</h3>
          <p className="mt-0.5 text-caption text-ink-500">
            Kim değiştirdi · ne zaman · eski değer → yeni değer
          </p>
        </header>
        {audits.length === 0 ? (
          <p className="px-5 py-5 text-small text-ink-500">Bu varyantta değişiklik kaydı yok.</p>
        ) : (
          <ul className="divide-y divide-ink-100" data-testid="catalog-audit">
            {audits.map((a) => (
              <li key={a.id} className="px-5 py-3 text-caption text-ink-700">
                <span className="font-medium text-ink-900">{a.action}</span> ·{' '}
                {a.actor?.email ?? 'sistem'} ·{' '}
                {new Date(a.createdAt).toLocaleString('tr-TR')}
                <AuditDiff before={a.before} after={a.after} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-3">
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-small font-medium text-ink-900">{value}</dd>
    </div>
  )
}

/** Fiyat alanlarındaki eski → yeni farkı okunur biçimde gösterir. */
function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const keys = ['unitPriceMinor', 'packagePriceMinor', 'setupFeeMinor'] as const
  const b = (before ?? {}) as Record<string, unknown>
  const a = (after ?? {}) as Record<string, unknown>
  const rows = keys
    .filter((k) => b[k] !== a[k] && (typeof b[k] === 'number' || typeof a[k] === 'number'))
    .map((k) => ({
      key: k,
      from: typeof b[k] === 'number' ? formatMinor(b[k] as number) : '—',
      to: typeof a[k] === 'number' ? formatMinor(a[k] as number) : '—',
    }))

  if (rows.length === 0) return null
  return (
    <span className="ml-1 text-ink-600">
      {rows.map((r) => (
        <span key={r.key} className="tabular">
          {' '}
          · {r.key}: {r.from} → {r.to}
        </span>
      ))}
    </span>
  )
}
