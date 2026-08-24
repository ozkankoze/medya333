import type { MetadataRoute } from 'next'
import { indexableServiceSlugs } from '@/lib/seo/service-pages'
import { appBaseUrl } from '@/server/base-url'
import { getCatalog } from '@/server/catalog'

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
 *   • **Editoryal metni olmayan hizmet sayfaları** — bunlar `noindex`tir;
 *     sitemap'e konsa sayfanın kendisiyle çelişirdi (bkz. aşağıdaki not)
 *
 * ⚠️ Sihirbaz derin bağlantıları neden çıkarıldı?
 * Bunlar ana sayfanın sorgu parametreli varyantlarıdır ve hepsinin canonical
 * adresi `/`'dir (bkz. `app/layout.tsx → alternates.canonical`). Site
 * haritasına canonical'i BAŞKA bir adres olan URL koymak kendi kendisiyle
 * çelişir: arama motoruna "bunu indeksle" derken sayfanın kendisi "hayır,
 * asıl adres şu" der.
 *
 * ⭐ Bunun yerine hizmetlerin KENDİ adresleri var: `/hizmetler/{slug}`.
 * Bu sayfalar kendi kendilerine canonical'dir ve özgün metin taşırlar.
 *
 * ⚠️ LİSTE KATALOGDAN TÜRETİLİR AMA KATALOĞUN TAMAMI DEĞİLDİR.
 * `indexableServiceSlugs` yalnızca elle yazılmış editoryal metni olan
 * hizmetleri döndürür. Katalog büyüdükçe sitemap kendiliğinden şişmez;
 * yeni bir sayfanın buraya girmesi için önce metninin yazılması gerekir.
 * Bu, "22 şablon sayfayı Google'a içerik diye sunma" ihtimalini yapısal
 * olarak kapatır.
 *
 * ⚠️ KATALOG OKUNAMAZSA SİTE HARİTASI ÇÖKMEZ. Veritabanı erişilemezse
 * hizmet sayfaları listeden düşer ama sabit sayfalar yayınlanmaya devam
 * eder; boş/500 dönen bir sitemap, Search Console'da tüm site için hata
 * üretirdi.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl()
  const now = new Date()

  let serviceEntries: MetadataRoute.Sitemap = []
  try {
    const catalog = await getCatalog()
    serviceEntries = indexableServiceSlugs(catalog.platforms).map((slug) => ({
      url: `${base}/hizmetler/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))
  } catch (err) {
    console.error('[sitemap] Katalog okunamadı, hizmet sayfaları atlandı:', (err as Error).message)
  }

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/hizmetler`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    ...serviceEntries,
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
