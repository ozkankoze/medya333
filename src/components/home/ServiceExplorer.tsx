import Link from 'next/link'
import { PlatformTile } from '@/components/wizard/PlatformMark'
import { formatMinor } from '@/lib/money'
import { entryPriceOf } from '@/lib/pricing'
import { isIndexable, serviceSlug } from '@/lib/seo/service-pages'
import { unitOf, withUnit } from '@/lib/units'
import type { CatalogSnapshot } from '@/server/catalog/snapshot'

/**
 * HİZMET KEŞFİ — TAMAMEN KATALOGDAN
 *
 * ⚠️ Buradaki hiçbir platform, hizmet adı, açıklama veya fiyat kodda YAZILI
 * DEĞİLDİR. Hepsi `catalog/snapshot`tan gelir; admin yeni bir hizmet
 * aktifleştirdiğinde bu bölüm kendiliğinden günceller.
 *
 * ⚠️ SUNUCU BİLEŞENİ. Sekme/aç-kapa için JS gerekmez: bölümler `<details>`
 * ile açılır, ilk platform açık gelir.
 */
export function ServiceExplorer({ catalog }: { catalog: CatalogSnapshot }) {
  if (catalog.platforms.length === 0) {
    return (
      <div className="rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-10 text-center">
        <p className="text-body text-ink-700">Hizmet listesi şu anda yüklenemedi.</p>
        <p className="mt-1 text-small text-ink-500">
          Sayfayı yenilemeyi deneyin; sorun sürerse destek ekibimize yazabilirsiniz.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {catalog.platforms.map((platform, index) => {
        const serviceCount = platform.services.length
        return (
          <details
            key={platform.id}
            open={index === 0}
            data-testid={`explorer-${platform.slug}`}
            className="group rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]"
          >
            <summary className="flex cursor-pointer list-none items-center gap-4 p-5">
              <PlatformTile
                slug={platform.slug}
                name={platform.name}
                brandColor={platform.brandColor}
                iconUrl={platform.iconUrl}
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-body font-semibold text-ink-900">{platform.name}</h3>
                <p className="mt-0.5 text-small text-ink-600">
                  {/* Gerçek katalog sayısı — sahte istatistik değil */}
                  {serviceCount} hizmet
                </p>
              </div>
              <span
                className="text-ink-400 transition-transform duration-[--duration-fast] group-open:rotate-180"
                aria-hidden
              >
                <ChevronDown />
              </span>
            </summary>

            <ul className="grid gap-2.5 border-t border-ink-100 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {platform.services.map((service) => {
                const entry = entryPriceOf(service.variants.flatMap((v) => v.tiers))
                const guaranteeDays = Math.max(
                  0,
                  ...service.variants.map((v) => v.refillDays ?? 0),
                )
                const landingSlug = serviceSlug(platform.slug, service.slug)
                return (
                  <li key={service.id} className="flex flex-col">
                    <Link
                      href={`/?p=${platform.slug}&s=${service.slug}#siparis`}
                      data-testid={`explorer-service-${platform.slug}-${service.slug}`}
                      className="flex h-full flex-col gap-1 rounded-[--radius-control] border border-ink-200 p-4 transition-colors duration-[--duration-fast] hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-small font-semibold text-ink-900">
                          {service.name}
                        </span>
                        {guaranteeDays > 0 && (
                          <span className="shrink-0 rounded-full bg-success-100 px-2 py-0.5 text-caption font-medium text-success-700">
                            {guaranteeDays} gün garanti
                          </span>
                        )}
                      </span>
                      {/* Uzun açıklamalar kart ızgarasını bozmasın */}
                      {service.shortDescription && (
                        <span className="line-clamp-2 text-caption leading-snug text-ink-600">
                          {service.shortDescription}
                        </span>
                      )}
                      {/* ⚠️ EN KÜÇÜK SİPARİŞİN TOPLAMI — en düşük birim fiyat DEĞİL.
                          Birim fiyat müşterinin asla göremeyeceği bir taban
                          (1.000.000 adetlik kademe) olduğu için yanıltıcıydı. */}
                      {entry && (
                        <span className="tabular mt-auto pt-2 text-caption text-ink-500">
                          {entry.kind === 'package'
                            ? `${formatMinor(entry.minOrderMinor)}'den başlayan fiyatlarla`
                            : `${withUnit(entry.minOrderQuantity, service.unitLabel)} · ${formatMinor(entry.minOrderMinor)}'den başlar`}
                        </span>
                      )}
                      <span className="sr-only">
                        {platform.name} {service.name} hizmetini seç ({unitOf(service.unitLabel)})
                      </span>
                    </Link>
                    {/*
                      ⚠️ KARTIN İÇİNE KONAMAZ. Kartın tamamı zaten bir
                      bağlantıdır; iç içe `<a>` geçersiz HTML'dir ve
                      tarayıcı DOM'u kendi kurtarma kuralıyla bozar. Bu
                      yüzden ayrıntı bağlantısı kartın ALTINDA, kardeş
                      eleman olarak durur.

                      ⚠️ Yalnızca editoryal metni olan hizmetlerde gösterilir
                      (bkz. `lib/seo/service-pages` → isIndexable).
                    */}
                    {isIndexable(landingSlug) && (
                      <Link
                        href={`/hizmetler/${landingSlug}`}
                        className="mt-1.5 px-1 text-caption text-ink-500 underline-offset-2 transition-colors duration-[--duration-fast] hover:text-brand-600 hover:underline"
                      >
                        {service.name} hakkında ayrıntılı bilgi
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </details>
        )
      })}
    </div>
  )
}

function ChevronDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
