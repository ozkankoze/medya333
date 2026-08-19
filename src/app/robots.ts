import type { MetadataRoute } from 'next'
import { appBaseUrl } from '@/server/base-url'

export const dynamic = 'force-dynamic'

/**
 * robots.txt
 *
 * ⚠️ Panel, hesap ve API yolları taranmaz. Bunlar zaten yetki ister ama arama
 * motoruna "buraya bakma" demek, sipariş numarası veya takip token'ı içeren
 * adreslerin yanlışlıkla indekslenmesini de engeller.
 *
 * ⚠️ `robots.txt` BİR GÜVENLİK MEKANİZMASI DEĞİLDİR. Buradaki her yol
 * sunucuda ayrıca yetkiyle korunur (`requireRole`, sahiplik kontrolü, imzalı
 * token). Disallow yalnızca *indekslenmeyi* engeller, *erişimi* değil —
 * kötü niyetli bir tarayıcı bu dosyayı zaten okumaz.
 *
 * ⚠️ `/giris` ve `/kayit` (Faz 9): arama sonucunda görünmelerinin bir değeri
 * yok; üstelik `?next=` parametresiyle indekslenirlerse kullanıcıyı beklenmedik
 * yönlendirmelere taşıyan adresler arama motorunda birikir.
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
          '/siparis-olusturuldu', // tek seferlik başarı ekranı
          '/odeme/', // ödeme sonucu/checkout
          '/giris',
          '/kayit',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
