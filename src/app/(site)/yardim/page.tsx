import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { getCatalog } from '@/server/catalog'

export const metadata: Metadata = {
  title: 'Yardım',
  description:
    'Medya 333 sipariş, ödeme, teslimat ve garanti süreçleri hakkında sık sorulan sorular.',
  alternates: { canonical: '/yardim' },
}

/**
 * /yardim — SIK SORULAN SORULAR
 *
 * ⚠️ Katalog bilgisi (platform sayısı, garanti süresi) SABİTLENMEZ; canlı
 * snapshot'tan okunur. Katalog değiştiğinde bu sayfa da doğru kalır.
 */
export default async function HelpPage() {
  const catalog = await getCatalog()

  const platformNames = catalog.platforms.map((p) => p.name)
  const guaranteeDays = new Set(
    catalog.platforms
      .flatMap((p) => p.services)
      .flatMap((s) => s.variants)
      .map((v) => v.refillDays)
      .filter((d): d is number => typeof d === 'number' && d > 0),
  )

  const faqs: Array<{ q: string; a: React.ReactNode }> = [
    {
      q: 'Hizmetler nasıl gerçekleştiriliyor?',
      a: (
        <>
          Tüm hizmetler <strong>gerçek kişiler</strong> tarafından manuel olarak yürütülür. Bot,
          sahte hesap veya otomatik etkileşim sistemi kullanılmaz. Sistemimiz sosyal medya
          hesabınıza hiçbir otomatik işlem göndermez; yalnızca siparişinizi, ödemenizi ve yapılan
          işin kaydını yönetir.
        </>
      ),
    },
    {
      q: 'Hangi platformlara hizmet veriyorsunuz?',
      a:
        platformNames.length > 0
          ? `Şu anda ${platformNames.join(', ')} hesapları için hizmet veriyoruz. Aktif hizmetlerin tamamını ana sayfadaki Hizmetler bölümünde görebilirsiniz.`
          : 'Aktif hizmet listesi ana sayfadaki Hizmetler bölümünde yer alır.',
    },
    {
      /**
       * ⚠️ BU CEVAP BİR KEZ YANLIŞA DÖNDÜ. Önceki hâli "ara miktar
       * seçilemez, hazır paketlerden birini seçin" diyordu; serbest miktar
       * slider'ı geldikten sonra ürünü YANLIŞ anlatıyordu. Katalogda hem
       * serbest hem hazır-miktarlı varyantlar bulunabildiği için cevap
       * artık ikisini de dürüstçe kapsıyor.
       */
      q: 'İstediğim miktarı serbestçe seçebilir miyim?',
      a: (
        <>
          Çoğu hizmette <strong>evet</strong>: sipariş adımındaki çubuğu sürükleyerek miktarı
          alt ve üst sınır arasında serbestçe belirleyebilirsiniz, tutar anında hesaplanır. Birim
          fiyat miktar arttıkça kademeli olarak düşer. Bazı hizmetler ise yalnızca{' '}
          <strong>hazır paketler</strong> hâlinde sunulur; orada size en yakın paketi seçmeniz
          yeterlidir. Hangi hizmetin hangi şekilde çalıştığını{' '}
          <Link href="/hizmetler" className="text-brand-600 underline underline-offset-2">
            hizmet sayfalarındaki fiyat tablosunda
          </Link>{' '}
          görebilirsiniz.
        </>
      ),
    },
    {
      q: 'Hesap açmadan sipariş verebilir miyim?',
      a: (
        <>
          Evet. Sipariş için hesap açmanız gerekmez. Siparişinizi{' '}
          <Link href="/siparis-takip" className="text-brand-600 underline underline-offset-2">
            sipariş numarası ve e-postanızla
          </Link>{' '}
          takip edebilirsiniz. Daha sonra hesap açarsanız misafir siparişlerinizi hesabınıza
          bağlayabilirsiniz.
        </>
      ),
    },
    {
      q: 'Ödeme nasıl alınıyor?',
      a: (
        <>
          Ödeme, lisanslı ödeme kuruluşunun 3D Secure sayfası üzerinden alınır.{' '}
          <strong>Kart bilgileriniz bizim sunucumuza hiçbir zaman ulaşmaz</strong> ve tarafımızda
          saklanmaz. Siparişiniz yalnızca ödeme doğrulandıktan sonra işleme alınır.
        </>
      ),
    },
    {
      q: 'Fiyatlara KDV dahil mi?',
      a: 'Evet. Sitede gördüğünüz bütün tutarlar KDV dahildir; ödeme adımında üzerine ekleme yapılmaz.',
    },
    {
      q: 'Siparişim ne zaman başlar?',
      a: (
        <>
          Ödemeniz doğrulandığında siparişiniz otomatik olarak onaylanır ve işlem sırasına alınır.
          İşi bir ekip arkadaşımız <strong>elle</strong> başlatır; bu yüzden başlangıç anında
          küçük bir bekleme olabilir. Her adımı sipariş sayfanızdan izleyebilirsiniz.
        </>
      ),
    },
    {
      q: 'Telafi garantisi nasıl işliyor?',
      a:
        guaranteeDays.size > 0 ? (
          <>
            Garanti kapsamındaki hizmetlerde, işlem tamamlandıktan sonra{' '}
            <strong>{[...guaranteeDays].sort((a, b) => b - a).join(' / ')} gün</strong> boyunca
            yaşanan düşüşler telafi edilir. Garanti süresi hizmet kartında ve sipariş sayfanızda
            yazar; garantisi olmayan hizmetlerde bu rozet gösterilmez. Telafi talepleriniz ekibimiz
            tarafından elle incelenir.
          </>
        ) : (
          'Garanti kapsamındaki hizmetlerde süre, hizmet kartında ve sipariş sayfanızda açıkça belirtilir.'
        ),
    },
    {
      q: 'Siparişimi iptal edebilir miyim?',
      a: (
        <>
          İptal ve iade koşulları için{' '}
          <Link href="/iptal-iade" className="text-brand-600 underline underline-offset-2">
            İptal ve İade
          </Link>{' '}
          sayfamıza bakabilirsiniz. İşlem başlamadan önce yapılan taleplerde iade süreci daha
          hızlı ilerler.
        </>
      ),
    },
    {
      q: 'Hesabımın şifresini vermem gerekir mi?',
      a: (
        <>
          <strong>Hayır.</strong> Hiçbir hizmet için şifrenizi istemeyiz. Yalnızca herkese açık
          profil veya gönderi bağlantınız yeterlidir. Şifrenizi isteyen bir mesaj alırsanız bu
          bizden gelmemiştir.
        </>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-h1 text-ink-900">Yardım</h1>
      <p className="mt-3 max-w-xl text-body leading-relaxed text-ink-600">
        Sipariş, ödeme, teslimat ve garanti süreçleriyle ilgili en sık sorulan sorular.
      </p>

      <dl className="mt-10 divide-y divide-ink-200 rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
        {faqs.map((f) => (
          <div key={f.q} className="p-6">
            <dt className="text-body font-semibold text-ink-900">{f.q}</dt>
            <dd className="mt-2 text-small leading-relaxed text-ink-600">{f.a}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 rounded-[--radius-card] border border-ink-200 bg-white p-6 text-center shadow-[--shadow-card]">
        <p className="text-body text-ink-900">Aradığınız cevabı bulamadınız mı?</p>
        <p className="mt-1 text-small text-ink-600">
          Sipariş numaranızla birlikte bize yazın, aynı gün dönüş yapalım.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <a href="mailto:destek@medya333.com" className={buttonVariants({ size: 'lg' })}>
            destek@medya333.com
          </a>
          <Link
            href="/siparis-takip"
            className={buttonVariants({ variant: 'secondary', size: 'lg' })}
          >
            Sipariş Takip
          </Link>
        </div>
      </div>
    </div>
  )
}
