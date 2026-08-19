import type { MetadataRoute } from 'next'
import { appBaseUrl } from '@/server/base-url'
import { getCatalog } from '@/server/catalog'

export const dynamic = 'force-dynamic'

/**
 * sitemap.xml
 *
 * ⚠️ Hizmet adresleri KATALOGDAN üretilir. Yeni bir platform/hizmet
 * aktifleştiğinde site haritası kendiliğinden günceller; elle liste tutulmaz.
 *
 * Yalnızca herkese açık, indekslenebilir sayfalar yer alır — panel, hesap,
 * sipariş detayı ve ödeme adresleri robots.txt'te de engellidir.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl()
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/yardim`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/siparis-takip`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/giris`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/kayit`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/kvkk-gizlilik`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/kullanim-kosullari`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/satis-sozlesmesi`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/iptal-iade`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/cerez-politikasi`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  try {
    const catalog = await getCatalog()
    const serviceRoutes: MetadataRoute.Sitemap = catalog.platforms.flatMap((p) =>
      p.services.map((s) => ({
        url: `${base}/?p=${p.slug}&s=${s.slug}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
    )
    return [...staticRoutes, ...serviceRoutes]
  } catch {
    // Katalog okunamazsa site haritası BOŞ DÖNMEZ; statik sayfalar kalır.
    return staticRoutes
  }
}
