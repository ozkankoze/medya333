import type { NextConfig } from 'next'
import { buildCsp } from './src/lib/security/csp'

/**
 * GÜVENLİK HEADER'LARI (Mimari §11 · Faz 7 denetimi)
 *
 * ⚠️ CSP KURALLARI ARTIK BURADA DEĞİL: `src/lib/security/csp.ts` içinde SAF bir
 * fonksiyondadır. Sebep o dosyanın başlığında yazılı — politika ortama göre
 * değiştiği için "canlıda ne gönderilecek?" sorusu ancak saf fonksiyon test
 * edilerek cevaplanabilir; yapılandırma dosyasının metnini taramak yetmez.
 */

/**
 * ⚠️ GELİŞTİRME/ÜRETİM AYRIMI BURADA YAPILIR.
 *
 * `next dev` süreci `NODE_ENV=development`, `next build` ve `next start` ise
 * `production` ile çalışır. Yani bu tek satır, `'unsafe-eval'` iznini yalnızca
 * yerel geliştirmeye hapseder; üretim derlemesine ASLA giremez.
 */
const CSP = buildCsp({ dev: process.env.NODE_ENV !== 'production' })

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Çapraz köken izolasyonu — pencere referansı sızıntısını kapatır
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * ⭐ STANDALONE ÇIKTI — YALNIZCA VERCEL DIŞINDA (Faz 10 + Faz 11)
   *
   * DOCKER / VM YOLUNDA (Faz 10):
   *   `next build`, çalışması için GEREKEN dosyaları `.next/standalone`
   *   altına izleyip kopyalar. Üretim imajı yalnızca bunu taşır:
   *     • `node_modules` imaja GİRMEZ → dev bağımlılıkları taşınamaz
   *     • imaj ~10× küçülür → dağıtım ve geri alma hızlanır
   *     • derleme araçları, test koşucusu, Playwright ve Prisma CLI imajda YOK
   *
   * VERCEL'DE (Faz 11):
   *   Vercel kendi çıktı formatını üretir; `standalone` orada gereksiz bir
   *   kopyalama katmanıdır ve derleme çıktısını büyütür.
   *
   * ⚠️ Bu, `TRUSTED_PROXY`nin aksine bir GÜVENLİK kararı değil, PAKETLEME
   * kararıdır — bu yüzden ortamdan tespit edilmesi güvenlidir. Yanlış tarafa
   * düşmek yalnızca çıktı boyutunu etkiler. `VERCEL` değişkenini Vercel'in
   * derleme ortamı yazar.
   */
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),

  /**
   * ⚠️ SOURCE MAP DAVRANIŞI — BİLİNÇLİ KARAR
   *
   * `productionBrowserSourceMaps` KAPALI (varsayılan) bırakıldı ve burada
   * açıkça yazıldı ki "unutulmuş" sanılmasın.
   *
   * Açık olsaydı: `.map` dosyaları PUBLIC olarak servis edilir; sunucu
   * bileşenlerinden istemciye taşınan kod, iç modül yolları, yorumlar ve
   * değişken adları okunabilir hâle gelirdi. Hata izleme sağlayıcısı
   * bağlandığında doğru yol, map'leri PUBLIC servis etmek değil, derleme
   * adımında sağlayıcıya YÜKLEYİP imajdan silmektir.
   *
   * Sunucu tarafı stack trace'leri zaten müşteriye gösterilmez
   * (bkz. src/server/observability.ts).
   */
  productionBrowserSourceMaps: false,

  /**
   * ⚠️ `typescript` PAKETİ ÜRETİM ÇIKTISINA GİRMEZ.
   *
   * Next'in dosya izleyicisi, `next-server` içindeki TS tanı (diagnostics)
   * yükleyicilerini gördüğü için `typescript` paketini (~9 MB) standalone
   * çıktıya kopyalar. Bu bir DERLEME aracıdır; derlenmiş uygulama onu
   * çalışırken kullanmaz.
   *
   * Dışarıda bırakmak hem "üretim imajında dev bağımlılığı olmayacak"
   * kuralını gerçekten uygular hem de imajı küçültür.
   */
  outputFileTracingExcludes: {
    '*': ['node_modules/typescript/**'],
  },
  experimental: {
    // src/server/** içindeki paketlerin client bundle'a sızmasını engeller
    serverActions: { bodySizeLimit: '2mb' },
  },

  /**
   * ⚠️ `pg` ve Prisma driver adapter'ı BUNDLE EDİLMEZ.
   *
   * `instrumentation.ts` her iki runtime (nodejs + edge) için derlenir.
   * Kod `NEXT_RUNTIME !== 'nodejs'` ise erken döner ve `@/server/db`yi
   * yalnızca dinamik import ile yükler — ama webpack yine de bağımlılık
   * grafiğini çözmeye çalışır ve `pg`nin `fs`/`net` kullanımında kırılır.
   *
   * Bu paketleri harici bırakmak doğru davranıştır: node_modules'tan
   * `require` edilirler, Edge derlemesine hiç girmezler.
   */
  serverExternalPackages: ['pg', 'pg-native', '@prisma/adapter-pg'],

  /**
   * ⚠️ EDGE DERLEMESİ `instrumentation-node`u HİÇ GÖRMEZ.
   *
   * `instrumentation.ts` hem Node.js hem Edge runtime için derlenir.
   * Çalışma zamanında Edge dalı veritabanına dokunan modülü yüklemez
   * (`NEXT_RUNTIME` kontrolü) — ama webpack bunu bilmez ve `pg`nin
   * `fs`/`net` bağımlılıklarını çözmeye çalışıp derlemeyi kırar.
   *
   * Çözüm, çalışma zamanı kontrolünü DERLEME zamanına taşımaktır: Edge
   * derlemesinde bu modül boş bir modüle indirgenir. Node.js derlemesi
   * etkilenmez.
   */
  webpack(config, { nextRuntime, webpack }) {
    if (nextRuntime === 'edge') {
      /**
       * Edge derlemesi `instrumentation-node` modülünü GÖRMEZ.
       *
       * ⚠️ `resolve.alias` burada İŞE YARAMAZ: `@/...` istekleri Next'in
       * `JsConfigPathsPlugin`i tarafından alias'tan ÖNCE çözülür. Bu yüzden
       * modül, çözümleme sonrası aşamada `IgnorePlugin` ile kesilir.
       *
       * Çalışma zamanında güvenlidir: `register()` Edge runtime'ında en
       * baştan döner, bu modülü hiç istemez.
       */
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /instrumentation-node(\.ts)?$/ }),
      )

      // Node.js'e özgü veritabanı yığını Edge grafiğinden tamamen çıkarılır.
      config.resolve.alias = {
        ...config.resolve.alias,
        pg: false,
        'pg-native': false,
        '@prisma/adapter-pg': false,
      }
    }
    return config
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Hesap/panel sayfaları ve API cevapları ara belleklenmez.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ]
  },
  images: {
    // Hedef önizleme görselleri KENDİ media-proxy'mizden servis edilir (Mimari §8.3).
    // Dış CDN'e doğrudan bağlanılmaz: hotlink kırılır ve kullanıcı IP'si platforma sızar.
    remotePatterns: [],
  },
}

export default nextConfig
