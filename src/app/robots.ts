import type { MetadataRoute } from 'next'
import { appBaseUrl } from '@/server/base-url'

export const dynamic = 'force-dynamic'

/**
 * robots.txt
 *
 * ⚠️ Panel, hesap ve API yolları taranmaz. Bunlar zaten yetki ister ama
 * arama motoruna "buraya bakma" demek, sipariş numarası içeren adreslerin
 * yanlışlıkla indekslenmesini de engeller.
 */
export default function robots(): MetadataRoute.Robots {
  const base = appBaseUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/yonetim/', // operasyon paneli
          '/panel/',
          '/hesabim', // müşteri paneli
          '/siparisler/', // sipariş detayı — takip token'ı içerebilir
          '/odeme/', // ödeme sonucu/checkout
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
