import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ROLE_LEVEL } from '@/lib/enums'
import { entryPriceOf } from '@/lib/pricing'
import { formatMinor, formatQuantity } from '@/lib/money'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth'
import { db } from '@/server/db'
import { CatalogToggle } from '@/components/catalog/CatalogToggle'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Katalog',
  robots: { index: false, follow: false },
}

/**
 * /yonetim/katalog — KATALOG YÖNETİMİ
 *
 * Platform → Hizmet → Varyant → Fiyat zinciri tek ekranda.
 * ⚠️ Tüm sayılar ve fiyatlar gerçek veritabanından okunur; hiçbir değer
 * arayüzde sabitlenmemiştir.
 */
export default async function CatalogAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ active?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/giris?next=/yonetim/katalog')

  const sp = await searchParams
  /**
   * ⚠️ Varsayılan görünüm PASİFLERİ DE İÇERİR.
   * Pasifleştirilen bir kaydı listeden gizlemek, onu geri açmayı imkânsız
   * kılardı — admin ekranı katalogun tamamını göstermelidir.
   */
  const showAll = sp.active !== '1'
  const canWrite = ROLE_LEVEL[user.role] >= ROLE_LEVEL.ADMIN

  const platforms = await db.platform.findMany({
    where: showAll ? {} : { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      services: {
        where: showAll ? {} : { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          variants: {
            where: showAll ? {} : { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
            include: { pricingRules: { where: { isActive: true } } },
          },
        },
      },
    },
  })

  const activeCounts = {
    platforms: await db.platform.count({ where: { isActive: true } }),
    services: await db.service.count({ where: { isActive: true } }),
    variants: await db.serviceVariant.count({ where: { isActive: true } }),
    rules: await db.pricingRule.count({ where: { isActive: true } }),
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-h3 text-ink-900">Katalog</h2>
          <p className="mt-1 text-small text-ink-600" data-testid="catalog-counts">
            {activeCounts.platforms} platform · {activeCounts.services} hizmet ·{' '}
            {activeCounts.variants} varyant · {activeCounts.rules} fiyat noktası
          </p>
        </div>
        <Link
          href={showAll ? '/yonetim/katalog?active=1' : '/yonetim/katalog'}
          className="rounded-[--radius-control] border border-ink-200 px-3 py-2 text-small text-ink-700 hover:bg-ink-50"
        >
          {showAll ? 'Yalnızca aktifleri göster' : 'Pasifleri de göster'}
        </Link>
      </div>

      {platforms.map((platform) => (
        <section
          key={platform.id}
          className="rounded-[--radius-card] border border-ink-200 bg-white"
          data-testid={`platform-${platform.slug}`}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <h3 className="text-body font-semibold text-ink-900">{platform.name}</h3>
              <span className="text-caption text-ink-500">/{platform.slug}</span>
              <ActiveTag active={platform.isActive} />
            </div>
            <span className="text-caption text-ink-500">adapter: {platform.adapterKey}</span>
          </header>

          {platform.services.length === 0 ? (
            <p className="px-5 py-6 text-small text-ink-500">Bu platformda hizmet yok.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {platform.services.map((service) => (
                <div key={service.id} className="px-5 py-4" data-testid={`service-${service.slug}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-small font-semibold text-ink-900">{service.name}</span>
                      <span className="text-caption text-ink-500">/{service.slug}</span>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-caption text-ink-600">
                        {service.targetType}
                      </span>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-caption text-ink-600">
                        birim: {service.unitLabel}
                      </span>
                      <ActiveTag active={service.isActive} />
                    </div>
                    {canWrite && (
                      <CatalogToggle
                        kind="services"
                        id={service.id}
                        isActive={service.isActive}
                        label={service.name}
                      />
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {service.variants.map((variant) => {
                      const entry = entryPriceOf(
                        variant.pricingRules.map((r) => ({
                          id: r.id,
                          mode: r.mode,
                          minQuantity: r.minQuantity,
                          maxQuantity: r.maxQuantity,
                          unitPriceMinor: r.unitPriceMinor,
                          packagePriceMinor: r.packagePriceMinor,
                          setupFeeMinor: r.setupFeeMinor,
                          priority: r.priority,
                        })),
                      )
                      return (
                        <Link
                          key={variant.id}
                          href={`/yonetim/katalog/${variant.id}`}
                          data-testid={`variant-${service.slug}-${variant.slug}`}
                          className="flex flex-col gap-1 rounded-[--radius-control] border border-ink-200 p-3 hover:bg-ink-50"
                        >
                          <span className="flex items-center gap-2 text-small font-medium text-ink-900">
                            {variant.customerLabel}
                            <ActiveTag active={variant.isActive} />
                          </span>
                          <span className="text-caption text-ink-500">
                            {variant.internalName}
                          </span>
                          <span className="tabular text-caption text-ink-600">
                            {variant.pricingRules.length} fiyat noktası
                            {entry ? ` · ${formatMinor(entry.amountMinor)}'den başlar` : ''}
                          </span>
                          {variant.presetOnly && (
                            <span className="text-caption text-ink-500">
                              hazır miktar:{' '}
                              {variant.presetQuantities
                                .slice(0, 4)
                                .map((q) => formatQuantity(q))
                                .join(' · ')}
                              {variant.presetQuantities.length > 4 ? ' …' : ''}
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function ActiveTag({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-caption font-medium',
        active ? 'bg-success-100 text-success-700' : 'bg-ink-200 text-ink-600',
      )}
    >
      {active ? 'Aktif' : 'Pasif'}
    </span>
  )
}
