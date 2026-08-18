import 'server-only'

import { env } from '@/env'

/**
 * SUNUCU TARAFI TABAN ADRES
 *
 * Ödeme sağlayıcısına verilen callback/success/fail adresleri ve kendi
 * checkout bağlantılarımız buradan üretilir.
 *
 * ⚠️ Neden `NEXT_PUBLIC_SITE_URL` doğrudan kullanılmıyor?
 * Next.js, `NEXT_PUBLIC_` önekli değişkenleri DERLEME sırasında koda gömer.
 * Aynı derleme imajı staging'de ve canlıda farklı adreslerle çalıştığında
 * sağlayıcıya YANLIŞ callback adresi gider ve ödeme bildirimi hiç ulaşmaz —
 * sessiz ve teşhisi zor bir hata. `APP_BASE_URL` çalışma zamanında okunur.
 */
export function appBaseUrl(): string {
  return (env.APP_BASE_URL ?? env.NEXT_PUBLIC_SITE_URL).replace(/\/$/, '')
}
