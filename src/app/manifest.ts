import type { MetadataRoute } from 'next'
import { appBaseUrl } from '@/server/base-url'

/**
 * ⚠️ DERLEME ZAMANINDA ÜRETİLMEZ.
 *
 * Varsayılan davranışta Next bu rotayı statik olarak ön-üretir ve
 * `appBaseUrl()` DERLEME makinesindeki değeri okur. Aynı imaj staging'de
 * çalıştığında manifest hâlâ canlı adresi gösterirdi — Faz 9'da `metadataBase`
 * ile aynı hata yakalanmıştı. `sitemap.ts` ve `robots.ts` de aynı sebeple
 * force-dynamic'tir.
 */
export const dynamic = 'force-dynamic'

/**
 * ⭐ WEB APP MANIFEST (Faz 10)
 *
 * Mobilde "ana ekrana ekle" yapıldığında uygulamanın adı, ikonu ve açılış
 * adresi buradan okunur. Manifest olmadan kısayol, sayfa başlığı ve rastgele
 * bir ekran görüntüsüyle oluşur.
 *
 * ⚠️ OLMAYAN VARLIK ÜRETİLMEDİ.
 *   • `screenshots` alanı YOK — ekran görüntüsü varlığımız yok.
 *   • PNG ikon YOK — elimizde yalnızca `src/app/icon.svg` var ve o da
 *     mevcut logonun birebir SVG karşılığı. Sahte bir 512×512 PNG üretmek,
 *     olmayan bir marka varlığını varmış gibi göstermek olurdu.
 *   • `id` alanı, gerçek marka varlıkları geldiğinde kimliğin değişmemesi
 *     için sabitlenmiştir.
 *
 * ⚠️ `start_url` MUTLAK ADRESTİR ve çalışma zamanında `appBaseUrl()`den
 * okunur — derlemeye gömülü bir alan adı staging ile canlıyı karıştırırdı
 * (Faz 9'da aynı hata `metadataBase`de yakalanmıştı).
 *
 * ⚠️ `display: 'standalone'` seçilmedi: uygulama bir ödeme akışı içerir ve
 * 3D Secure sayfaları sağlayıcı alan adında açılır. Tarayıcı çubuğunun
 * gizlendiği bir kabukta müşteri hangi alan adında olduğunu göremez —
 * ödeme ekranında adres çubuğu bir güvenlik özelliğidir.
 */
export default function manifest(): MetadataRoute.Manifest {
  const base = appBaseUrl()

  return {
    id: '/',
    name: 'Medya 333 — Sosyal Medya Tanıtım Hizmetleri',
    short_name: 'Medya 333',
    description:
      'Gerçek kullanıcılarla sosyal medya hesabınızı büyütmek için profesyonel tanıtım hizmetleri.',
    start_url: `${base}/`,
    scope: `${base}/`,
    // Adres çubuğu görünür kalır — bkz. yukarıdaki not.
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'tr-TR',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      {
        // Next.js `src/app/icon.svg` dosyasını bu yolda servis eder.
        src: '/icon.svg',
        type: 'image/svg+xml',
        // "any" — SVG her boyutta ölçeklenir; sahte boyut listesi yazılmaz.
        sizes: 'any',
        purpose: 'any',
      },
    ],
  }
}
