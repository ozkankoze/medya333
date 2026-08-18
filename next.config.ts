import type { NextConfig } from 'next'

/**
 * Güvenlik header'ları burada merkezî olarak tanımlanır (Mimari §11, madde 19).
 * CSP'nin `frame-src` beyaz listesi Faz 4'te iyzico/PayTR alan adlarıyla genişletilecek.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // src/server/** içindeki paketlerin client bundle'a sızmasını engeller
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  images: {
    // Hedef önizleme görselleri KENDİ media-proxy'mizden servis edilir (Mimari §8.3).
    // Dış CDN'e doğrudan bağlanılmaz: hotlink kırılır ve kullanıcı IP'si platforma sızar.
    remotePatterns: [],
  },
}

export default nextConfig
