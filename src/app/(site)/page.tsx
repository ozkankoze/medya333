import { Suspense } from 'react'
import Link from 'next/link'
import { ServiceExplorer } from '@/components/home/ServiceExplorer'
import { JsonLd } from '@/components/seo/JsonLd'
import { buttonVariants } from '@/components/ui/button'
import { OrderWizard } from '@/components/wizard/OrderWizard'
import { supportWhatsappNumber } from '@/lib/support'
import { getSessionUser } from '@/server/auth'
import { appBaseUrl } from '@/server/base-url'
import { getCatalog } from '@/server/catalog'

/**
 * ANA SAYFA = KEŞİF + SİPARİŞ SİHİRBAZI
 *
 * Sihirbaz bu sayfanın İÇİNDE yaşar. Kullanıcı sipariş tamamlanana kadar
 * `/` adresinden ayrılmaz — ayrı bir /siparis route'u YOKTUR.
 *
 * Katalog sunucuda TEK SEFERDE okunur; hem keşif bölümü hem sihirbaz aynı
 * snapshot'ı kullanır. Kart başına ayrı API isteği YOKTUR.
 */
export default async function HomePage() {
  const [catalog, user] = await Promise.all([getCatalog(), getSessionUser()])

  const platformCount = catalog.platforms.length
  const serviceCount = catalog.platforms.reduce((n, p) => n + p.services.length, 0)

  /**
   * ⚠️ Platform adları METİNDE DE sabitlenmez. Katalogda bir platform
   * aktifleşir/pasifleşirse hero cümlesi kendiliğinden doğru kalır.
   */
  const names = catalog.platforms.map((p) => p.name)
  const platformSentence =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} ve ${names.at(-1)}` : (names[0] ?? '')

  const base = appBaseUrl()
  const supportPhone = supportWhatsappNumber()

  return (
    <>
      {/**
       * ⭐ ANA SAYFA YAPISAL VERİSİ
       *
       * Hizmet sayfalarına `Product`/`FAQPage` eklenmişti ama ANA SAYFADA
       * hiç yapısal veri yoktu — oysa marka sorgularında ("medya 333")
       * Google'ın karşısına çıkan sayfa burasıdır.
       *
       * ⚠️ SAHTE ALAN UYDURULMADI. `aggregateRating`, `review`, kuruluş
       * tarihi, çalışan sayısı gibi doğrulayamadığımız hiçbir şey
       * yazılmadı. Uydurma puan işaretlemek Google'ın yapısal veri
       * politikasının açık ihlalidir ve manuel işlem sebebidir.
       *
       * ⚠️ `SearchAction` DA YOK: sitede genel bir arama sayfası yok.
       * Olmayan bir uca işaret eden sitelinks arama kutusu bildirimi,
       * çalışmayan bir özelliği vaat etmek olurdu.
       */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Organization',
              '@id': `${base}/#kurulus`,
              name: 'Medya 333',
              url: `${base}/`,
              /**
               * ⚠️ `logo` PAYLAŞIM AFİŞİ DEĞİL, LOGONUN KENDİSİ olmalı.
               * Buraya önce 1200×630'luk `og.png` yazılmıştı; o bir sosyal
               * medya afişidir. Google bu alanı arama sonucunda marka
               * ikonu olarak kullanır ve geniş bir afişi kırparsa logo
               * tanınmaz hâle gelir. `apple-icon.png` kare ve logonun
               * kendisi (koyu zemin üzerine altın marka).
               */
              logo: `${base}/apple-icon.png`,
              image: `${base}/og.png`,
              email: 'destek@medya333.com',
              // Numara tanımlı değilse alan HİÇ basılmaz — boş iletişim
              // noktası bildirmek, olmayan bir kanalı vaat etmektir.
              ...(supportPhone
                ? {
                    contactPoint: [
                      {
                        '@type': 'ContactPoint',
                        contactType: 'customer support',
                        telephone: `+${supportPhone}`,
                        availableLanguage: ['Turkish'],
                      },
                    ],
                  }
                : {}),
            },
            {
              '@type': 'WebSite',
              '@id': `${base}/#site`,
              url: `${base}/`,
              name: 'Medya 333',
              inLanguage: 'tr-TR',
              publisher: { '@id': `${base}/#kurulus` },
            },
          ],
        }}
      />

      {/* ================================ HERO ================================= */}
      {/**
       * ⚠️ HERO KOYU BİR BANT — başlık ve alt bilgiyle aynı yüzey. Sayfa
       * "koyu çerçeve / açık çalışma alanı" ritmine oturur: marka anları
       * (logo, vaat, CTA) koyuda parlar, sipariş sihirbazı ise açık ve
       * sakin zeminde kalır. Ödeme yapılan yer asla koyulaştırılmaz.
       *
       * ⚠️ ALTIN YÜZEY OLARAK KULLANILMAZ. Geniş altın alan logodaki değeri
       * ucuzlatır. Altın burada üç yerde ve toplam birkaç pikseldir:
       * hairline, rozet noktası ve CTA gradyanı.
       */}
      <section className="relative overflow-hidden bg-ink-975">
        {/* Sol üstten gelen çok yumuşak sıcak ışık — logonun stüdyo aydınlatması */}
        <span
          className="pointer-events-none absolute -left-40 -top-52 size-[36rem] rounded-full bg-gold-500/[0.07] blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-5 pt-16 pb-16 sm:pt-24 sm:pb-20">
          <div className="flex flex-col gap-6">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-caption font-medium text-white/75 backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-gold-400" aria-hidden />
              Gerçek kullanıcılar · Bot ve sahte hesap yok
            </span>

            <h1 className="max-w-3xl text-balance text-h1 text-white sm:text-display">
              Sosyal Medyada Fark Yaratın
            </h1>

            <p className="max-w-xl text-pretty text-lg leading-relaxed text-white/65">
              {platformSentence ? `${platformSentence} hesaplarınız için ` : ''}gerçek
              kullanıcılarla yürütülen tanıtım hizmetleri. İhtiyacınız kadar miktar belirleyin,
              KDV dahil net fiyatı anında görün, siparişinizi adım adım takip edin.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="#siparis" className={buttonVariants({ size: 'lg' })}>
                Şimdi Başla
              </Link>
              <Link
                href="#hizmetler"
                className={buttonVariants({ variant: 'onDark', size: 'lg' })}
              >
                Hizmetleri İncele
              </Link>
            </div>

            {/* ⚠️ SAHTE SOSYAL KANIT YOK.
                Bu sayılar KATALOGDAN türetilir — "10.000+ mutlu müşteri" gibi
                doğrulanamayan iddialar bilinçli olarak kullanılmaz. */}
            <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/10 pt-6">
              <Stat value={String(platformCount)} label="Platform" />
              <Stat value={String(serviceCount)} label="Hizmet" />
              <Stat value="KDV dahil" label="Tüm fiyatlar" />
            </dl>
          </div>
        </div>

        {/* Koyu bandı açık gövdeden ayıran altın hairline */}
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-500/50 to-transparent"
          aria-hidden
        />
      </section>

      {/* ============================= HİZMET KEŞFİ ============================ */}
      <section
        id="hizmetler"
        aria-labelledby="hizmetler-baslik"
        className="scroll-mt-20 border-t border-ink-200 bg-white/60"
      >
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="hizmetler-baslik" className="text-h2 text-ink-900">
                Hizmetler
              </h2>
              <p className="mt-2 max-w-xl text-small leading-relaxed text-ink-600">
                {/* ⚠️ Bu cümle önce "ara miktar yoktur" diyordu; serbest miktar
                    slider'ı geldikten sonra ÜRÜNÜ YANLIŞ anlatıyordu. */}
                Platformu açın, hizmeti seçin — sipariş sihirbazı doğru adımdan başlar. Miktarı
                sipariş adımında serbestçe belirlersiniz; birim fiyat miktara göre kademelenir.
              </p>
            </div>
            <Link href="#siparis" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Sipariş oluştur
            </Link>
          </div>

          <div className="mt-8">
            <ServiceExplorer catalog={catalog} />
          </div>
        </div>
      </section>

      {/* =============================== SİPARİŞ =============================== */}
      <section id="siparis" aria-label="Sipariş oluştur" className="scroll-mt-16 pt-14">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-h2 text-ink-900">Siparişinizi oluşturun</h2>
          <p className="mt-2 max-w-xl text-small leading-relaxed text-ink-600">
            Hesap açmanıza gerek yok. Ödeme adımına gelene kadar hiçbir tutar tahsil edilmez.
          </p>
        </div>
        <div className="mt-8">
          {/* Sihirbaz `useSearchParams` kullanır (derin bağlantı ön seçimi);
              Suspense sınırı Next'in statik render kuralını karşılar. */}
          <Suspense fallback={<WizardSkeleton />}>
            <OrderWizard catalog={catalog} sessionEmail={user?.email ?? null} />
          </Suspense>
        </div>
      </section>

      {/* ================================ GÜVEN ================================ */}
      <section aria-labelledby="guven-baslik" className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 id="guven-baslik" className="sr-only">
            Neden Medya 333
          </h2>
          <div className="grid gap-10 sm:grid-cols-3">
            <Trust
              title="Gerçek kullanıcılar"
              body="İşlem yapan hesaplar, gerçek kişilerin oluşturdukları hesaplardır."
            />
            <Trust
              title="Şeffaf fiyatlandırma"
              body="Gördüğünüz fiyat ödediğiniz fiyattır. Tüm tutarlar KDV dahildir; ödeme adımında sürpriz ekleme yapılmaz."
            />
            <Trust
              title="Uçtan uca takip"
              body="Hesap açmadan da sipariş numaranız ve e-postanızla siparişinizin her adımını izleyebilirsiniz."
            />
          </div>
        </div>
      </section>
    </>
  )
}

function WizardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-5" aria-hidden>
      <div className="h-6 w-40 animate-pulse rounded bg-ink-100" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-[--radius-card] bg-ink-100" />
        ))}
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      {/* ⚠️ Koyu hero bandının içinde — renkler ink-* DEĞİL beyaz opaklığı. */}
      <dd className="tabular text-h2 leading-none text-white">{value}</dd>
      <dd className="mt-1 text-caption uppercase tracking-wider text-white/45">{label}</dd>
    </div>
  )
}

function Trust({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-h3 text-ink-900">{title}</h3>
      <p className="mt-2 text-small leading-relaxed text-ink-600">{body}</p>
    </div>
  )
}
