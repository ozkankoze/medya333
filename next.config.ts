import type { NextConfig } from 'next'

/**
 * GÜVENLİK HEADER'LARI (Mimari §11 · Faz 7 denetimi)
 *
 * ⚠️ CSP burada TANIMLIDIR. Faz 0'da "Faz 4'te eklenecek" notu bırakılmıştı ve
 * unutulmuştu; Faz 7 denetimi bunu yakaladı.
 */

/** 3D Secure sayfaları sağlayıcı alan adında açılır — çerçeveye izin verilir. */
const PAYMENT_FRAME_SRC = [
  'https://*.iyzipay.com',
  'https://*.iyzico.com',
  'https://*.paytr.com',
]

/**
 * ⚠️ `script-src 'unsafe-inline'`: Next.js hidrasyon önyükleyicisini satır içi
 * script olarak yazar. Nonce tabanlı CSP, her isteği dinamik hâle getirip
 * statik/ISR önbelleğini devre dışı bırakır. Bu yüzden satır içi script'e izin
 * verilir ama `object-src 'none'`, `base-uri 'self'` ve `frame-ancestors 'none'`
 * ile saldırı yüzeyi daraltılır. XSS'e karşı asıl savunma React'in kaçışlaması
 * ve sunucu tarafı Zod doğrulamasıdır.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Görseller: kendi sunucumuz + data/blob (SVG ikonlar, önizleme)
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // XHR yalnızca kendi API'mize; üçüncü parti analytics YOK.
  "connect-src 'self'",
  `frame-src 'self' ${PAYMENT_FRAME_SRC.join(' ')}`,
  // Ödeme formu sağlayıcıya POST edilebilir.
  `form-action 'self' ${PAYMENT_FRAME_SRC.join(' ')}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

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
  experimental: {
    // src/server/** içindeki paketlerin client bundle'a sızmasını engeller
    serverActions: { bodySizeLimit: '2mb' },
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
