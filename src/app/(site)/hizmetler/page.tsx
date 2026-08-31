import type { Metadata } from 'next'
import Link from 'next/link'
import { PlatformTile } from '@/components/wizard/PlatformMark'
import { JsonLd } from '@/components/seo/JsonLd'
import { buttonVariants } from '@/components/ui/button'
import { formatMinor } from '@/lib/money'
import { entryPriceOf } from '@/lib/pricing'
import { isIndexable, serviceSlug } from '@/lib/seo/service-pages'
import { withUnit } from '@/lib/units'
import { appBaseUrl } from '@/server/base-url'
import { getCatalog } from '@/server/catalog'

/**
 * /hizmetler — HİZMET AÇILIŞ SAYFALARININ MERKEZİ
 *
 * ⚠️ NEDEN AYRI BİR HUB? Ana sayfadaki keşif bölümü (`/#hizmetler`) sipariş
 * sihirbazına derin bağlantı verir; o bağlantıların canonical'i `/`dir ve
 * öyle kalmalıdır. Arama motorunun tarayabileceği ayrı hizmet sayfalarına
 * bir yerden İÇ BAĞLANTI verilmesi gerekir — yalnızca sitemap'e koymak
 * "yetim sayfa" demektir ve Google iç bağlantısı olmayan sayfayı düşük
 * öncelikli sayar.
 *
 * ⚠️ BU SAYFA KATALOĞU TEKRAR ETMEZ, ONA BAĞLANIR. Buradaki tek özgün
 * içerik giriş paragrafıdır; asıl metin hizmet sayfalarındadır. Hub'ın
 * indekslenmesi bir listenin indekslenmesidir — bu meşrudur, ama hub'a
 * yapay metin şişirmesi yapılmaz.
 */

export const metadata: Metadata = {
  title: 'Hizmetler',
  description:
    'Instagram, TikTok, YouTube, Facebook ve diğer platformlar için sosyal medya tanıtım '
    + 'hizmetlerinin tam listesi. Her hizmetin minimum sipariş tutarı ve KDV dahil net fiyatı.',
  alternates: { canonical: '/hizmetler' },
}

export default async function ServicesHubPage() {
  const catalog = await getCatalog()
  const base = appBaseUrl()

  const serviceCount = catalog.platforms.reduce((n, p) => n + p.services.length, 0)

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${base}/` },
            { '@type': 'ListItem', position: 2, name: 'Hizmetler', item: `${base}/hizmetler` },
          ],
        }}
      />

      <nav aria-label="Sayfa yolu" className="text-caption text-ink-500">
        <Link href="/" className="hover:text-ink-700">
          Ana Sayfa
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-700">Hizmetler</span>
      </nav>

      <h1 className="mt-4 text-h1 text-ink-900">Hizmetler</h1>
      <p className="mt-3 max-w-2xl text-body leading-relaxed text-ink-600">
        {catalog.platforms.length} platformda {serviceCount} hizmet sunuyoruz. Tümü gerçek
        kişilerin hesaplarıyla, elle yürütülür; hiçbir hizmette şifreniz istenmez. Aşağıdaki her
        başlık, o hizmetin nasıl işlediğini, minimum sipariş miktarını ve kademeli fiyat tablosunu
        ayrıntılı anlatan sayfaya götürür.
      </p>

      <div className="mt-10 flex flex-col gap-8">
        {catalog.platforms.map((platform) => (
          <section key={platform.id} aria-labelledby={`platform-${platform.slug}`}>
            <div className="flex items-center gap-3">
              <PlatformTile
                slug={platform.slug}
                name={platform.name}
                brandColor={platform.brandColor}
                iconUrl={platform.iconUrl}
              />
              <h2 id={`platform-${platform.slug}`} className="text-h3 text-ink-900">
                {platform.name}
              </h2>
            </div>

            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {platform.services.map((service) => {
                const slug = serviceSlug(platform.slug, service.slug)
                const entry = entryPriceOf(service.variants.flatMap((v) => v.tiers))
                return (
                  <li key={service.id}>
                    <Link
                      href={`/hizmetler/${slug}`}
                      data-testid={`hub-service-${slug}`}
                      className="flex h-full flex-col gap-1 rounded-[--radius-control] border border-ink-200 bg-white p-4 transition-colors duration-[--duration-fast] hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span className="text-small font-semibold text-ink-900">
                        {platform.name} {service.name}
                      </span>
                      {service.shortDescription && (
                        <span className="line-clamp-2 text-caption leading-snug text-ink-600">
                          {service.shortDescription}
                        </span>
                      )}
                      {entry && (
                        <span className="tabular mt-auto pt-2 text-caption text-ink-500">
                          {entry.kind === 'package'
                            ? `${formatMinor(entry.minOrderMinor)}'den başlayan fiyatlarla`
                            : `${withUnit(entry.minOrderQuantity, service.unitLabel)} · ${formatMinor(entry.minOrderMinor)}`}
                        </span>
                      )}
                      {/*
                        ⚠️ "Detaylı anlatım" rozeti YALNIZCA editoryal metni
                        olan sayfalarda. Metni olmayan hizmetin sayfası açılır
                        ama noindex'tir; kullanıcıya "ayrıntı var" diye söz
                        verip boş sayfa göstermek güveni bozar.
                      */}
                      {isIndexable(slug) && (
                        <span className="text-caption font-medium text-brand-600">
                          Ayrıntılı bilgi →
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-12 rounded-[--radius-card] border border-ink-200 bg-white p-6 text-center shadow-[--shadow-card]">
        <p className="text-body text-ink-900">Hangi hizmetin size uyduğundan emin değil misiniz?</p>
        <p className="mt-1 text-small text-ink-600">
          Sipariş sihirbazında platformu ve hizmeti seçtiğinizde fiyat anında hesaplanır; ödeme
          adımına gelene kadar hiçbir tutar tahsil edilmez.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/#siparis" className={buttonVariants({ size: 'lg' })}>
            Sipariş Oluştur
          </Link>
          <Link href="/yardim" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Sık Sorulan Sorular
          </Link>
        </div>
      </div>
    </div>
  )
}
