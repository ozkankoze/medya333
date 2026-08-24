import { headers } from 'next/headers'
import type { MetadataRoute } from 'next'
import { buildRobots, isIndexableRequest } from '@/lib/seo/robots-rules'
import { appBaseUrl } from '@/server/base-url'
import { isLiveDeployment } from '@/server/production-guard'

export const dynamic = 'force-dynamic'

/**
 * robots.txt
 *
 * ⚠️ İnce bir kabuk: kurallar `@/lib/seo/robots-rules` içinde SAF bir
 * fonksiyondadır. Sebep o dosyanın başlığında yazılı — rota dosyası yalnızca
 * çalıştığı aşamanın çıktısını verebilir, dolayısıyla "canlıda ne yazacak?"
 * sorusu ancak saf fonksiyon test edilerek cevaplanabilir.
 *
 * ⚠️ İSTEĞİN HOST'U OKUNUR VE BU BİLİNÇLİDİR. İndekslenebilirlik artık
 * `APP_ENV`e değil, "bu istek kanonik alan adına mı geldi?" sorusuna bağlı.
 * Gerekçesi `robots-rules` içindeki `isIndexableRequest` başlığında: iki ayrı
 * soru ("indekslenebilir mi?" ve "gerçek para tahsil edilebilir mi?") tek
 * bayrağa bağlıydı ve bu, sitenin arama motoruna tamamen kapanmasına yol
 * açmıştı.
 *
 * ⚠️ `headers()` bu rotayı dinamik yapar — zaten `force-dynamic`ti, yeni bir
 * maliyet getirmez.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = appBaseUrl()

  /**
   * ⚠️ Host okunamazsa hata fırlatılmaz. robots.txt'nin 500 dönmesi, arama
   * motoru tarafında "geçici olarak tara" değil, belirsizlik demektir;
   * eski ölçüte düşmek her durumda daha iyidir.
   */
  let requestHost: string | null = null
  try {
    requestHost = (await headers()).get('host')
  } catch {
    requestHost = null
  }

  return buildRobots({
    base,
    indexable: isIndexableRequest({ base, requestHost, live: isLiveDeployment() }),
  })
}
