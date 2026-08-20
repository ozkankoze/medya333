import type { MetadataRoute } from 'next'
import { buildRobots } from '@/lib/seo/robots-rules'
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
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots({ base: appBaseUrl(), live: isLiveDeployment() })
}
