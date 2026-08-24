import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/seo/JsonLd'
import { PlatformTile } from '@/components/wizard/PlatformMark'
import { buttonVariants } from '@/components/ui/button'
import { formatMinor, formatQuantity, formatUnitPriceMinor } from '@/lib/money'
import { entryPriceOf, sortTiersForDisplay } from '@/lib/pricing'
import type { PricingTier } from '@/lib/pricing'
import { copyFor, isIndexable, parseServiceSlug } from '@/lib/seo/service-pages'
import { unitOf, withUnit } from '@/lib/units'
import { appBaseUrl } from '@/server/base-url'
import { getCatalog } from '@/server/catalog'
import type { CatalogPlatform, CatalogService, CatalogVariant } from '@/server/catalog'

/**
 * /hizmetler/{platform}-{hizmet} — HİZMET AÇILIŞ SAYFASI
 *
 * ⚠️ İKİ KAYNAKTAN BESLENİR VE İKİSİ KARIŞTIRILMAZ:
 *   • FİYAT, MİKTAR, SÜRE, GARANTİ → yalnızca katalog snapshot'ı. Burada
 *     hiçbir sayı elle yazılmaz; admin fiyatı değiştirdiğinde bu sayfa
 *     kendiliğinden doğrulanır. Elle yazılmış bir fiyat, katalog
 *     değiştiğinde SESSİZCE yalana dönerdi.
 *   • ANLATIM (H1, gövde, SSS) → `lib/seo/service-pages`. Katalogdan
 *     TÜRETİLEMEZ; türetilse zaten şablon olurdu.
 *
 * ⚠️ METNİ OLMAYAN HİZMET `noindex` ALIR. Sayfa yine açılır (sihirbazdan
 * veya hub'dan gelen kullanıcı boş ekranla karşılaşmasın) ama Google'a
 * indekslenmesi söylenmez ve sitemap'e girmez. Bkz. `isIndexable`.
 *
 * ⚠️ SİPARİŞ BURADA ALINMAZ. Sihirbaz tek yerdedir (`/#siparis`); ikinci
 * bir sipariş akışı, fiyat motorunun iki farklı yerde davranması demekti.
 * Bu sayfadaki CTA sihirbazı doğru adımdan açan derin bağlantıdır.
 */

interface PageProps {
  params: Promise<{ slug: string }>
}

/** Katalogdan (platform, hizmet) ikilisini çözer — bulunamazsa null. */
async function resolve(slug: string): Promise<{
  platform: CatalogPlatform
  service: CatalogService
} | null> {
  const catalog = await getCatalog()
  const parsed = parseServiceSlug(slug, catalog.platforms)
  if (!parsed) return null

  const platform = catalog.platforms.find((p) => p.slug === parsed.platformSlug)
  const service = platform?.services.find((s) => s.slug === parsed.serviceSlug)
  if (!platform || !service) return null
  return { platform, service }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const found = await resolve(slug)
  if (!found) return { title: 'Hizmet bulunamadı', robots: { index: false, follow: false } }

  const { platform, service } = found
  const copy = copyFor(slug)
  const indexable = isIndexable(slug)

  return {
    title: copy?.title ?? `${platform.name} ${service.name}`,
    description:
      copy?.description
      ?? service.shortDescription
      ?? `${platform.name} ${service.name} hizmeti — gerçek kişilerin hesaplarıyla, KDV dahil net fiyat.`,
    alternates: { canonical: `/hizmetler/${slug}` },
    /**
     * ⚠️ `follow: true` KALIR. `noindex` sayfanın indekslenmemesini söyler;
     * `nofollow` eklemek buradaki iç bağlantıları da kesip sihirbaza giden
     * yolu kapatırdı. İstenen şey "bu sayfayı listeleme", "buradan hiçbir
     * yere gitme" değil.
     */
    robots: { index: indexable, follow: true },
    openGraph: {
      type: 'website',
      url: `/hizmetler/${slug}`,
      title: copy?.title ?? `${platform.name} ${service.name}`,
      description: copy?.description ?? service.shortDescription ?? undefined,
    },
  }
}

export default async function ServiceLandingPage({ params }: PageProps) {
  const { slug } = await params
  const found = await resolve(slug)
  if (!found) notFound()

  const { platform, service } = found
  const copy = copyFor(slug)
  const base = appBaseUrl()
  const unit = unitOf(service.unitLabel)
  const heading = copy?.heading ?? `${platform.name} ${service.name}`
  const wizardHref = `/?p=${platform.slug}&s=${service.slug}#siparis`

  const allTiers = service.variants.flatMap((v) => v.tiers)
  const entry = entryPriceOf(allTiers)
  const guaranteeDays = Math.max(0, ...service.variants.map((v) => v.refillDays ?? 0))

  /**
   * ⚠️ HER SATIR KATALOGDAN GELİR VE VERİ YOKSA SATIR HİÇ OLUŞMAZ.
   * "Telafi garantisi: —" ya da "Tahmini başlangıç: bilinmiyor" yazmak,
   * bilgi vermeden yer kaplar ve garanti olmayan bir hizmette garanti
   * varmış izlenimi bırakır.
   */
  const estimatedStart = Math.min(
    ...service.variants
      .map((v) => v.estimatedStartMinutes)
      .filter((m): m is number => typeof m === 'number' && m > 0),
  )
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Hedef bilgisi', value: service.inputLabel },
    { label: 'Örnek', value: service.inputExample },
    ...(guaranteeDays > 0
      ? [{ label: 'Telafi garantisi', value: `${formatQuantity(guaranteeDays)} gün` }]
      : []),
    // ⚠️ Süre tahmini KATALOGDAN; "anında teslim" gibi bir vaat verilmez.
    ...(Number.isFinite(estimatedStart)
      ? [{ label: 'Tahmini başlangıç', value: humanizeMinutes(estimatedStart) }]
      : []),
  ]

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      {/* ------------------------------ Sayfa yolu ----------------------------- */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${base}/` },
            { '@type': 'ListItem', position: 2, name: 'Hizmetler', item: `${base}/hizmetler` },
            {
              '@type': 'ListItem',
              position: 3,
              name: heading,
              item: `${base}/hizmetler/${slug}`,
            },
          ],
        }}
      />

      {/*
        ⚠️ ÜRÜN ŞEMASI YALNIZCA GERÇEK BİR FİYAT VARSA basılır ve fiyat
        SAYFADA GÖSTERİLENİN AYNISIDIR (en küçük siparişin toplamı).
        Google'ın yapısal veri politikası, ekranda olmayan bir fiyatı
        işaretlemeyi ihlal sayar; ayrıca yanlış fiyatlı zengin sonuç
        müşteriyi kapıda yanıltır.
      */}
      {entry && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: `${platform.name} ${service.name}`,
            description: copy?.description ?? service.shortDescription ?? undefined,
            brand: { '@type': 'Brand', name: 'Medya 333' },
            url: `${base}/hizmetler/${slug}`,
            offers: {
              '@type': 'Offer',
              price: (entry.minOrderMinor / 100).toFixed(2),
              priceCurrency: 'TRY',
              availability: 'https://schema.org/InStock',
              url: `${base}/hizmetler/${slug}`,
              /** Ekrandaki ifadenin birebir karşılığı: "en küçük sipariş". */
              description: `${withUnit(entry.minOrderQuantity, service.unitLabel)} minimum sipariş`,
            },
          }}
        />
      )}

      {/*
        ⚠️ SSS ŞEMASI: Google 2023'ten beri FAQ zengin sonucunu yalnızca
        sınırlı sitelerde gösteriyor. Yine de basılıyor çünkü işaretleme
        DOĞRU ve sayfadaki içerikle birebir aynı; ceza riski yok, ileride
        politika değişirse hazır. Zengin sonuç VAADİ verilmiyor.
      */}
      {copy && copy.faq.length > 0 && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: copy.faq.map((f) => ({
              '@type': 'Question',
              name: f.q,
              acceptedAnswer: { '@type': 'Answer', text: f.a },
            })),
          }}
        />
      )}

      <nav aria-label="Sayfa yolu" className="text-caption text-ink-500">
        <Link href="/" className="hover:text-ink-700">
          Ana Sayfa
        </Link>
        <span aria-hidden> / </span>
        <Link href="/hizmetler" className="hover:text-ink-700">
          Hizmetler
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-700">{heading}</span>
      </nav>

      {/* -------------------------------- Başlık ------------------------------- */}
      <div className="mt-4 flex items-center gap-3">
        <PlatformTile
          slug={platform.slug}
          name={platform.name}
          brandColor={platform.brandColor}
          iconUrl={platform.iconUrl}
        />
        <p className="text-small font-medium text-ink-600">{platform.name}</p>
      </div>

      <h1 className="mt-4 text-balance text-h1 text-ink-900">{heading}</h1>

      {entry && (
        <p className="tabular mt-3 text-body text-ink-700">
          Minimum sipariş {withUnit(entry.minOrderQuantity, service.unitLabel)} ·{' '}
          <strong className="text-ink-900">{formatMinor(entry.minOrderMinor)}</strong>{' '}
          <span className="text-ink-500">(KDV dahil)</span>
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={wizardHref} className={buttonVariants({ size: 'lg' })}>
          Sipariş Oluştur
        </Link>
        <Link href="/hizmetler" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          Tüm Hizmetler
        </Link>
      </div>

      {/* ------------------------------ Anlatım -------------------------------- */}
      {copy ? (
        <div className="mt-10 flex flex-col gap-4">
          {copy.body.map((p, i) => (
            <p key={i} className="text-body leading-relaxed text-ink-700">
              {p}
            </p>
          ))}
        </div>
      ) : (
        /**
         * ⚠️ ŞABLON METİN ÜRETİLMEZ. Editoryal metni olmayan hizmette
         * "profesyonel {hizmet} hizmeti sunuyoruz" gibi bir doldurma
         * paragrafı yazmak tam olarak kapı sayfası davranışıdır. Onun
         * yerine katalogdaki gerçek kısa açıklama gösterilir; sayfa
         * zaten `noindex`tir.
         */
        service.shortDescription && (
          <p className="mt-10 text-body leading-relaxed text-ink-700">
            {service.shortDescription}
          </p>
        )
      )}

      {/* ---------------------------- Fiyat tablosu ---------------------------- */}
      <section aria-labelledby="fiyat-baslik" className="mt-12">
        <h2 id="fiyat-baslik" className="text-h2 text-ink-900">
          Fiyatlar
        </h2>
        <p className="mt-2 text-small leading-relaxed text-ink-600">
          Tüm tutarlar KDV dahildir. Birim fiyat miktar arttıkça kademeli olarak düşer; ödeyeceğiniz
          net tutar sipariş adımında miktarı seçtiğiniz anda hesaplanır.
        </p>

        <div className="mt-6 flex flex-col gap-6">
          {service.variants.map((variant) => (
            <VariantPricing key={variant.id} variant={variant} unit={unit} />
          ))}
        </div>
      </section>

      {/* ------------------------------ Bilgi kutusu --------------------------- */}
      <section aria-labelledby="detay-baslik" className="mt-12">
        <h2 id="detay-baslik" className="text-h2 text-ink-900">
          Hizmet detayları
        </h2>
        {/**
         * ⚠️ IZGARA TEK SAYIDA HÜCREYLE BOŞ KUTU BIRAKIYORDU. Kutunun zemini
         * `ink-200` (hücreler arası 1px çizgiyi o veriyor) olduğu için eksik
         * hücre gri bir boşluk gibi görünüyordu — "yüklenemedi" hissi.
         * Bu yüzden bilgiler önce DİZİ olarak toplanır; tek sayıda kalırsa
         * son bilgi iki sütunu birden kaplar.
         */}
        <dl className="mt-6 grid gap-px overflow-hidden rounded-[--radius-card] border border-ink-200 bg-ink-200 sm:grid-cols-2">
          {facts.map((f, i) => (
            <Fact
              key={f.label}
              label={f.label}
              value={f.value}
              wide={facts.length % 2 === 1 && i === facts.length - 1}
            />
          ))}
        </dl>
      </section>

      {/* --------------------------------- SSS --------------------------------- */}
      {copy && copy.faq.length > 0 && (
        <section aria-labelledby="sss-baslik" className="mt-12">
          <h2 id="sss-baslik" className="text-h2 text-ink-900">
            Sık sorulan sorular
          </h2>
          <dl className="mt-6 divide-y divide-ink-200 rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            {copy.faq.map((f) => (
              <div key={f.q} className="p-6">
                <dt className="text-body font-semibold text-ink-900">{f.q}</dt>
                <dd className="mt-2 text-small leading-relaxed text-ink-600">{f.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-small text-ink-600">
            Diğer sorular için{' '}
            <Link href="/yardim" className="text-brand-600 underline underline-offset-2">
              yardım sayfamıza
            </Link>{' '}
            bakabilirsiniz.
          </p>
        </section>
      )}

      {/* --------------------------------- CTA --------------------------------- */}
      <div className="mt-12 rounded-[--radius-card] border border-ink-200 bg-white p-6 text-center shadow-[--shadow-card]">
        <p className="text-body text-ink-900">{heading}</p>
        <p className="mt-1 text-small text-ink-600">
          Hesap açmanıza gerek yok. Miktarı seçin, KDV dahil net tutarı görün, siparişinizi adım
          adım takip edin.
        </p>
        <div className="mt-5">
          <Link href={wizardHref} className={buttonVariants({ size: 'lg' })}>
            Sipariş Oluştur
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function VariantPricing({ variant, unit }: { variant: CatalogVariant; unit: string }) {
  const tiers = sortTiersForDisplay([...variant.tiers])
  const hasPackages = tiers.some((t) => t.mode === 'PACKAGE')

  return (
    <div className="overflow-hidden rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 p-5">
        <div>
          <h3 className="text-body font-semibold text-ink-900">{variant.customerLabel}</h3>
          {variant.tagline && <p className="mt-0.5 text-caption text-ink-600">{variant.tagline}</p>}
        </div>
        <p className="tabular text-caption text-ink-500">
          {formatQuantity(variant.minQuantity)} – {formatQuantity(variant.maxQuantity)} {unit}
        </p>
      </div>

      {/* ⚠️ Geniş tablo kendi içinde kayar — gövde YATAY KAYMAZ. */}
      <div className="overflow-x-auto">
        <table className="w-full text-small">
          <thead>
            <tr className="border-b border-ink-100 text-left text-caption uppercase tracking-wide text-ink-500">
              <th scope="col" className="px-5 py-3 font-medium">
                Miktar
              </th>
              <th scope="col" className="px-5 py-3 text-right font-medium">
                {hasPackages ? 'Tutar' : `Birim fiyat`}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {tiers.map((t) => (
              <tr key={t.id}>
                <td className="tabular px-5 py-3 text-ink-700">{tierRange(t, unit)}</td>
                <td className="tabular px-5 py-3 text-right font-medium text-ink-900">
                  {t.mode === 'PACKAGE'
                    ? formatMinor(t.packagePriceMinor ?? 0)
                    : formatUnitPriceMinor(t.unitPriceMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** "500 – 999 adet" · "1.000.000 adet ve üzeri" */
function tierRange(t: PricingTier, unit: string): string {
  if (t.maxQuantity === null) {
    return `${formatQuantity(t.minQuantity)} ${unit} ve üzeri`
  }
  if (t.maxQuantity === t.minQuantity) {
    return `${formatQuantity(t.minQuantity)} ${unit}`
  }
  return `${formatQuantity(t.minQuantity)} – ${formatQuantity(t.maxQuantity)} ${unit}`
}

function humanizeMinutes(minutes: number): string {
  if (minutes < 60) return `${formatQuantity(minutes)} dakika içinde`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${formatQuantity(hours)} saat içinde`
  return `${formatQuantity(Math.round(hours / 24))} gün içinde`
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`bg-white p-5${wide ? ' sm:col-span-2' : ''}`}>
      <dt className="text-caption uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 text-small text-ink-900">{value}</dd>
    </div>
  )
}
