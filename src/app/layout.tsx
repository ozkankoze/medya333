import type { Metadata, Viewport } from 'next'
import { appBaseUrl } from '@/server/base-url'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
// Tipografi: Inter Variable, TAMAMEN self-host (npm paketi).
// next/font/google yerine bu tercih edildi: derleme Google'a bağımlı olmaz
// (kapalı CI ağlarında build kırılmaz) ve kullanıcı tarayıcısı hiçbir zaman
// Google'a istek atmaz — KVKK açısından da temiz.
import '@fontsource-variable/inter'
import './globals.css'

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
  description:
    'Instagram, YouTube, Facebook ve TikTok hesaplarınız için gerçek kullanıcılarla yürütülen ' +
    'profesyonel tanıtım hizmetleri. Hazır paketler, KDV dahil net fiyatlar ve adım adım sipariş takibi.',
  applicationName: 'Medya 333',
  keywords: [
    'sosyal medya tanıtım',
    'instagram takipçi',
    'youtube abone',
    'sosyal medya büyütme',
    'medya 333',
  ],
  authors: [{ name: 'Medya 333' }],
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'Medya 333',
    /**
     * ⚠️ `metadataBase` ile birleşir → `https://www.medya333.com/`.
     * ⚠️ `images` BİLİNÇLİ OLARAK YOK: gerçek bir OG görseli üretilmedi.
     * Var olmayan bir dosyaya işaret eden `og:image`, paylaşımlarda kırık
     * önizleme üretir — hiç vermemek daha iyidir.
     */
    url: '/',
    title: 'Medya 333 | Sosyal Medya Hizmetleri',
    description:
      'Gerçek kullanıcılarla yürütülen sosyal medya tanıtım hizmetleri. ' +
      'Hazır paketler, KDV dahil net fiyatlar, uçtan uca sipariş takibi.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Medya 333 | Sosyal Medya Hizmetleri',
    description: 'Gerçek kullanıcılarla yürütülen sosyal medya tanıtım hizmetleri.',
  },
  robots: { index: true, follow: true },
  /**
   * ⚠️ Canonical `metadataBase` ile birleşir → `https://www.medya333.com/`.
   * Sihirbaz derin bağlantıları (`/?p=…&s=…`) ana sayfanın sorgu parametreli
   * varyantlarıdır; canonical hepsini tek adrese toplar ve yinelenen içerik
   * oluşmaz.
   */
  alternates: { canonical: '/' },
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
      </body>
    </html>
  )
}
