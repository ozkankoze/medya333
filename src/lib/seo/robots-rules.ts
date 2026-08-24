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

/**
 * ⭐⭐ İNDEKSLENEBİLİRLİK — KANONİK HOST'A GÖRE, AŞAMA BAYRAĞINA GÖRE DEĞİL
 *
 * ⚠️ BU FONKSİYON GERÇEK BİR KESİNTİDEN DOĞDU.
 *
 * Önceden indekslenebilirlik `isLiveDeployment()`e (yani `APP_ENV`e) bağlıydı.
 * Bir gün canlı projede `APP_ENV` "production" dışında bir değere ayarlıydı ve
 * `www.medya333.com/robots.txt` TÜM SİTEYİ Google'a kapattı. Hiçbir hata
 * düşmedi, hiçbir test kırılmadı, sayfalar normal açılıyordu — site yalnızca
 * arama motoruna görünmez olmuştu.
 *
 * Asıl sorun daha derindi: `APP_ENV` aynı anda "gerçek para tahsil edilebilir
 * mi?" sorusunu da yönetiyor. PayTR onayı beklenirken o soruya "hayır" demek
 * ZORUNLUYDU, ve bu "indekslenebilir mi?" sorusuna da zorla "hayır"
 * dedirtiyordu. İki ayrı soru tek bayrağa bağlanmıştı.
 *
 * ⚠️ DOĞRU ÖLÇÜT: KANONİK ALAN ADINA CEVAP VEREN DAĞITIM, TANIMI GEREĞİ
 * CANLI SİTEDİR. Preview'lar kendi `*.vercel.app` adreslerinde cevap verir ve
 * kanonik host'la eşleşmez.
 *
 * Üç koşulun HEPSİ gerekir — hepsi FAIL-CLOSED yönde:
 *   1. Taban adres HTTPS olmalı  → yerel geliştirme kapalı kalır
 *   2. Taban adres bir dağıtım alias'ı OLMAMALI → `APP_BASE_URL` yanlışlıkla
 *      `*.vercel.app` bırakılmışsa hiçbir şey indekslenmez (yinelenen içerik
 *      üretmektense kapalı kalmak yeğdir)
 *   3. İsteğin host'u taban adresin host'uyla AYNI olmalı → preview kapalı
 *
 * ⚠️ HOST OKUNAMAZSA eski davranışa (`live`) düşülür. Bilinmeyen bir durumda
 * yeni kuralı uydurmaktansa, önceki bilinen davranışı sürdürmek doğrudur.
 */
export interface IndexableInput {
  /** Kanonik taban adres (`APP_BASE_URL`). */
  base: string
  /** İsteğin `Host` başlığı — okunamadıysa null. */
  requestHost: string | null
  /** Eski ölçüt; yalnızca host okunamadığında yedek olarak kullanılır. */
  live: boolean
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

/** `Host` başlığını normalize eder (büyük/küçük harf ve varsayılan port). */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:443$/, '')
}

export function isIndexableRequest({ base, requestHost, live }: IndexableInput): boolean {
  // 1) HTTPS değilse indekslenecek bir şey yok (yerel/geliştirme).
  if (!base.startsWith('https://')) return false

  const canonicalHost = hostOf(base)
  if (!canonicalHost) return false

  // 2) Kanonik adres bir dağıtım alias'ıysa kapalı kal — bu bir yapılandırma
  //    hatasıdır ve indekslenirse yinelenen içerik üretir.
  if (canonicalHost === 'vercel.app' || canonicalHost.endsWith('.vercel.app')) return false

  // 3) Host okunamadıysa eski ölçüte düş.
  if (!requestHost) return live

  return normalizeHost(requestHost) === canonicalHost
}

export interface RobotsInput {
  /** Kanonik taban adres (sonunda `/` olmadan). */
  base: string
  /** Bu dağıtım indekslenebilir mi? (bkz. `isIndexableRequest`) */
  indexable: boolean
}

/**
 * ⭐ İNDEKSLENEBİLİR OLMAYAN ORTAM HİÇ TARANMAZ (Faz 11)
 *
 * Vercel'de her Preview dağıtımı halka açık bir adres alır. Aynı içerik iki
 * ayrı adreste indekslenirse:
 *   • yinelenen içerik riski doğar,
 *   • arama sonucunda müşterinin karşısına ESKİ bir dağıtım çıkabilir,
 *   • staging'deki test verisi ve deneme metinleri aranabilir hâle gelir.
 */
export function buildRobots({ base, indexable }: RobotsInput): MetadataRoute.Robots {
  if (!indexable) {
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
