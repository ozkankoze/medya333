import Script from 'next/script'
import { env } from '@/env'

/**
 * GOOGLE ADS ETİKETİ (gtag.js) — dönüşüm takibi
 *
 * Google'ın verdiği iki parçalı snippet'in birebir karşılığı:
 *   1. `googletagmanager.com/gtag/js?id=AW-…` — harici, async
 *   2. `dataLayer` + `gtag('js') / gtag('config', …)` — satır içi
 *
 * ⚠️ TEK ETİKET, TEK YER. Sitede başka hiçbir Google/GTM/Analytics kurulumu
 * YOK (kontrol edildi); bu bileşen kök düzende BİR KEZ render edilir. İkinci
 * bir yere eklenirse `gtag('config')` iki kez çalışır ve dönüşümler
 * ÇİFTLENİR — rapordaki sayı gerçeğin iki katı görünür.
 *
 * ⚠️ KİMLİK YOKSA HİÇBİR ŞEY YÜKLENMEZ. Böylece geliştirme ve önizleme
 * dağıtımları gerçek kampanya verisini kirletmez.
 *
 * ⚠️ CSP İLE BAĞLI. `next.config.ts` politikayı AYNI değişkenden üretir
 * (`buildCsp({ googleAds })`). Bu bileşeni kimlik olmadan zorlamak ya da
 * politikayı elle kısmak, "script yükleniyor ama tarayıcı engelliyor"
 * sessiz arızasını üretir: dönüşüm düşmez, hata da görünmez.
 *
 * ⚠️ `afterInteractive`: Next.js script'i sayfanın erken aşamasında ekler ama
 * ilk boyamayı bloklamaz. Dönüşüm etiketi için Google'ın istediği "mümkün
 * olduğunca yukarıda" koşulunu karşılar; `beforeInteractive` ise yalnızca
 * kök düzende çalışır ve ilk yüklemeyi yavaşlatır.
 */

export function GoogleAdsTag() {
  const id = env.NEXT_PUBLIC_GOOGLE_ADS_ID
  if (!id) return null

  return (
    <>
      <Script
        id="google-ads-loader"
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
      />
      <Script id="google-ads-config" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');`}
      </Script>
    </>
  )
}
