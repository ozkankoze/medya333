import type { MetadataRoute } from 'next'

/**
 * ⭐ robots.txt KURALLARI — SAF FONKSİYON (Faz 11)
 *
 * ⚠️ NEDEN AYRI DOSYA?
 *
 * `src/app/robots.ts` bir Next rota dosyasıdır ve çalıştığı ortamın
 * aşamasını (`APP_ENV`) okur. Yani bir testte yalnızca O ANKİ aşamanın
 * çıktısı görülebilir: E2E `e2e` aşamasında koştuğu için canlı çıktının
 * doğruluğu HİÇ test edilemezdi.
 *
 * Kuralları saf bir fonksiyona taşımak, her iki dalın da test edilmesini
 * sağlar — "canlıda ne yazacak?" sorusu canlıya çıkmadan cevaplanabilir.
 */

/**
 * Arama motoruna kapatılan yollar.
 *
 * ⚠️ `robots.txt` BİR GÜVENLİK MEKANİZMASI DEĞİLDİR. Buradaki her yol
 * sunucuda ayrıca yetkiyle korunur (`requireRole`, sahiplik kontrolü, imzalı
 * token). Disallow yalnızca *indekslenmeyi* engeller, *erişimi* değil —
 * kötü niyetli bir tarayıcı bu dosyayı zaten okumaz.
 */
export const DISALLOWED_PATHS = [
  '/api/',
  '/yonetim/', // operasyon paneli
  '/panel/',
  '/hesabim', // müşteri paneli
  '/siparisler/', // sipariş detayı — takip token'ı içerebilir
  '/siparis-olusturuldu', // tek seferlik başarı ekranı
  '/odeme/', // ödeme sonucu/checkout
  /**
   * ⚠️ `/giris` ve `/kayit` (Faz 9): arama sonucunda görünmelerinin bir
   * değeri yok; üstelik `?next=` parametresiyle indekslenirlerse kullanıcıyı
   * beklenmedik yönlendirmelere taşıyan adresler arama motorunda birikir.
   */
  '/giris',
  '/kayit',
] as const

export interface RobotsInput {
  /** Kanonik taban adres (sonunda `/` olmadan). */
  base: string
  /** Bu dağıtım GERÇEKTEN canlı mı? (`APP_ENV=production` + `NODE_ENV=production`) */
  live: boolean
}

/**
 * ⭐ CANLI OLMAYAN ORTAM HİÇ İNDEKSLENMEZ (Faz 11)
 *
 * Vercel'de her Preview dağıtımı halka açık bir adres alır. Aynı içerik iki
 * ayrı adreste indekslenirse:
 *   • yinelenen içerik riski doğar,
 *   • arama sonucunda müşterinin karşısına ESKİ bir dağıtım çıkabilir,
 *   • staging'deki test verisi ve deneme metinleri aranabilir hâle gelir.
 *
 * ⚠️ Bu, canlıyı yanlışlıkla kapatma riski taşımaz: `APP_ENV` tanımsızsa
 * aşama zaten "production" sayılır (ADR-027, fail-closed).
 */
export function buildRobots({ base, live }: RobotsInput): MetadataRoute.Robots {
  if (!live) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      /**
       * ⚠️ Sitemap ve host BİLDİRİLMEZ: kapalı bir ortamın haritasını vermek,
       * "girme" dedikten hemen sonra kapıyı göstermektir.
       */
    }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...DISALLOWED_PATHS],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
