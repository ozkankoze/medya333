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
 *   • `id` alanı, gerçek marka varlıkları geldiğinde kimliğin değişmemesi
 *     için sabitlenmiştir.
 *
 * ⭐ İKONLAR ARTIK GERÇEK. Bu not önceden "PNG ikon YOK, sahte bir 512×512
 * üretmek olmayan bir marka varlığını varmış gibi göstermek olurdu" diyordu
 * ve o gerekçe doğruydu. İkonlar artık markanın KENDİ asset'inden
 * (`public/brand/medya333-mark.png`) türetiliyor — uydurma değil, mevcut
 * logonun ölçeklenmiş hâli.
 *
 * ⚠️ SEKME İKONUNDA YALNIZCA "333" VAR. Tam marka (333 + MEDYA) 16 pikselde
 * okunmaz bir bulamaca dönüşüyor; kurulum ikonunda (512) tam marka kullanılır.
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
    /**
     * ⚠️ YALNIZCA GERÇEKTEN SERVİS EDİLEN DOSYALAR LİSTELENİR.
     * Manifest'te olmayan bir ikona işaret etmek, yükleme sırasında sessizce
     * başarısız olur ve kurulu uygulamada boş ikon bırakır.
     */
    icons: [
      {
        // `src/app/icon.png` — sekme ikonu boyutları.
        src: '/icon.png',
        type: 'image/png',
        sizes: '96x96',
        purpose: 'any',
      },
      {
        // `src/app/apple-icon.png` → iOS ana ekran ikonu.
        src: '/apple-icon.png',
        type: 'image/png',
        sizes: '180x180',
        purpose: 'any',
      },
      {
        // Android kurulum ekranı 512'yi ister; küçük ikonu büyütmek bulanık
        // bir kurulum ikonu bırakır.
        src: '/icon-512.png',
        type: 'image/png',
        sizes: '512x512',
        purpose: 'any',
      },
    ],
  }
}
