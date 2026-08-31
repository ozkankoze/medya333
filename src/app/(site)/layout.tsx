import type { Metadata, Viewport } from 'next'
import { appBaseUrl } from '@/server/base-url'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { SupportFab } from '@/components/layout/SupportFab'
import { GoogleAdsTag } from '@/components/analytics/GoogleAdsTag'
// Tipografi: Inter Variable, TAMAMEN self-host (npm paketi).
// next/font/google yerine bu tercih edildi: derleme Google'a bağımlı olmaz
// (kapalı CI ağlarında build kırılmaz) ve kullanıcı tarayıcısı hiçbir zaman
// Google'a istek atmaz — KVKK açısından da temiz.
import '@fontsource-variable/inter'
import '../globals.css'

/**
 * ⚠️ SEO metni KATALOGU TEKRARLAMAZ.
 * Platform ve hizmet listesi katalogdan gelir; burada sabitlenirse katalog
 * değiştiğinde meta açıklaması sessizce yanlışa döner. Bu yüzden açıklama
 * hizmet SAYMAZ, ne yaptığımızı anlatır.
 *
 * ⚠️ `generateMetadata` — SABİT `metadata` DEĞİL (Faz 9).
 * Önceden `metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')`
 * yazıyordu. İki ayrı sorunu vardı:
 *   1. `NEXT_PUBLIC_` değişkeni DERLEME sırasında gömülür — imaj bir kez
 *      derlenip farklı ortamlara konursa canonical/OG adresleri yanlış olur.
 *   2. Değişken derleme sırasında tanımsızsa **canlıda canonical ve OG
 *      adresleri `http://localhost:3000` olur**. Arama motoruna ve sosyal
 *      medya kazıyıcısına verilen adres localhost'tur; hiçbir hata alınmaz,
 *      hiçbir test kırılmaz — sadece sessizce yanlış olur.
 * `appBaseUrl()` çalışma zamanında `APP_BASE_URL`i okur.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
  metadataBase: new URL(appBaseUrl()),
  title: {
    default: 'Medya 333 | Sosyal Medya Hizmetleri',
    template: '%s · Medya 333',
  },
  /**
   * ⚠️ ~155 KARAKTER. Önceki hâli 188 karakterdi ve Google arama sonucunda
   * son cümleyi kesiyordu — yani kesilen yer "adım adım sipariş takibi"
   * gibi tıklamaya ikna eden kısımdı. Sınır 160 civarıdır; altında kalmak
   * cümlenin tamamının görünmesini garanti eder.
   */
  description:
    'Instagram, TikTok, YouTube ve Facebook için gerçek kullanıcılarla yürütülen '
    + 'tanıtım hizmetleri. KDV dahil net fiyat, adım adım sipariş takibi.',
  applicationName: 'Medya 333',
  /**
   * ⚠️ `keywords` KALDIRILDI — geri EKLENMEMELİ.
   * Google meta keywords etiketini 2009'dan beri sıralamada kullanmıyor ve
   * bunu açıkça duyurdu. Bing de kullanmıyor. Etiketin tek gerçek etkisi,
   * hangi kelimeleri hedeflediğinizi rakiplerinize bedava söylemesidir.
   */
  authors: [{ name: 'Medya 333' }],
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'Medya 333',
    /**
     * ⚠️ `metadataBase` ile birleşir → `https://www.medya333.com/`.
     *
     * ⭐ GÖRSEL ARTIK GERÇEK. Önceki not "gerçek bir OG görseli üretilmedi,
     * var olmayan dosyaya işaret etmektense hiç vermemek daha iyidir"
     * diyordu ve o gerekçe doğruydu. `public/og.png` markanın kendi
     * asset'inden üretildi (koyu zemin + altın logo + alt hairline);
     * artık dosya var, dolayısıyla bildirmemek için sebep kalmadı.
     *
     * ⚠️ ÖLÇÜ BİLDİRİLİR. WhatsApp ve X, boyutu bilmeden önizlemeyi küçük
     * kart olarak çizebiliyor; `summary_large_image` için 1200×630 şart.
     */
    url: '/',
    title: 'Medya 333 | Sosyal Medya Hizmetleri',
    description:
      'Gerçek kullanıcılarla yürütülen sosyal medya tanıtım hizmetleri. ' +
      'Hazır paketler, KDV dahil net fiyatlar, uçtan uca sipariş takibi.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Medya 333 — sosyal medya tanıtım hizmetleri',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Medya 333 | Sosyal Medya Hizmetleri',
    description: 'Gerçek kullanıcılarla yürütülen sosyal medya tanıtım hizmetleri.',
    // ⚠️ `summary_large_image` GÖRSELSİZ ÇALIŞMAZ: X kartı görsel yoksa
    //    sessizce düz bağlantıya düşer. Kart tipi ile görsel birlikte durur.
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
  /**
   * ⚠️ Canonical `metadataBase` ile birleşir → `https://www.medya333.com/`.
   * Sihirbaz derin bağlantıları (`/?p=…&s=…`) ana sayfanın sorgu parametreli
   * varyantlarıdır; canonical hepsini tek adrese toplar ve yinelenen içerik
   * oluşmaz.
   */
  alternates: { canonical: '/' },
  /**
   * ⚠️ Manifest çalışma zamanında üretilir (`src/app/manifest.ts`) —
   * `start_url` derlemeye gömülmesin diye. Bağlantı burada verilir.
   */
  manifest: '/manifest.webmanifest',
  }
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr-TR">
      {/* ⚠️ Google Ads etiketi TÜM SAYFALARDA, TEK KEZ. Kök düzende
          durduğu için her rota otomatik kapsanır; ayrıca eklenmemelidir
          (bkz. GoogleAdsTag → dönüşüm çiftlenmesi notu). */}
      <GoogleAdsTag />
      <body className="flex min-h-dvh flex-col antialiased">
        {/* Klavye kullanıcısı menüyü atlayıp içeriğe geçebilmeli */}
        <a
          href="#icerik"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[--radius-control] focus:bg-white focus:px-4 focus:py-2 focus:text-small focus:shadow-[--shadow-lifted]"
        >
          İçeriğe geç
        </a>

        <SiteHeader />

        <main id="icerik" className="flex-1">
          {children}
        </main>

        <SiteFooter />

        {/* Sağ altta sabit WhatsApp destek düğmesi. Numara tanımlı değilse
            hiç render edilmez; üçüncü taraf sohbet scripti YÜKLENMEZ. */}
        <SupportFab />
      </body>
    </html>
  )
}
