import type { MetadataRoute } from 'next'
import { appBaseUrl } from '@/server/base-url'

export const dynamic = 'force-dynamic'

/**
 * sitemap.xml
 *
 * ⚠️ YALNIZCA İNDEKSLENMESİNİ İSTEDİĞİMİZ, HERKESE AÇIK SAYFALAR.
 *
 * Buraya GİRMEYENLER ve nedenleri:
 *
 *   • `/yonetim/**`, `/panel/**`, `/hesabim` — yetki ister, robots'ta da kapalı
 *   • `/siparisler/{no}` — **takip token'ı taşır**. Site haritasına konması,
 *     müşteriye özel bir sırrı yayınlamak olurdu.
 *   • `/siparis-olusturuldu`, `/odeme/**` — tek seferlik akış ekranları
 *   • `/giris`, `/kayit` — arama sonucunda bir değeri yok (robots'ta kapalı)
 *   • **`/?p=…&s=…` sihirbaz derin bağlantıları (Faz 9'da ÇIKARILDI)**
 *
 * ⚠️ Derin bağlantılar neden çıkarıldı?
 * Bunlar ana sayfanın sorgu parametreli varyantlarıdır ve hepsinin canonical
 * adresi `/`'dir (bkz. `app/layout.tsx → alternates.canonical`). Site
 * haritasına canonical'i BAŞKA bir adres olan URL koymak kendi kendisiyle
 * çelişir: arama motoruna "bunu indeksle" derken sayfanın kendisi "hayır,
 * asıl adres şu" der. Sonuç, 22 hizmet için yinelenen içerik sinyalidir.
 * Katalog zaten ana sayfadaki hizmet keşfinden taranabiliyor.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appBaseUrl()
  const now = new Date()

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/yardim`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    {
      url: `${base}/siparis-takip`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    // Yasal metinler — nadiren değişir ama indekslenebilir olmalı (güven sinyali)
    { url: `${base}/kvkk-gizlilik`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    {
      url: `${base}/kullanim-kosullari`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    { url: `${base}/satis-sozlesmesi`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/iptal-iade`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/cerez-politikasi`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
