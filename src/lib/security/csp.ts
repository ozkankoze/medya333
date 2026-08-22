/**
 * ⭐ CONTENT-SECURITY-POLICY — SAF ÜRETİCİ
 *
 * ⚠️ NEDEN AYRI BİR DOSYA? (`lib/seo/robots-rules.ts` ile aynı gerekçe)
 *
 * CSP daha önce `next.config.ts` içinde sabit bir dizeydi ve testi de o dosyanın
 * METNİNİ tarıyordu: `expect(config).not.toContain('unsafe-eval')`. Bu test,
 * yapılandırma tek bir ortam için sabitken işe yarıyordu — ama artık kural
 * ortama göre DEĞİŞİYOR ve "canlıda ne yazacak?" sorusu metin taramasıyla
 * cevaplanamaz: dosyada geçen bir dize, üretimde gönderilen başlıkta olduğu
 * anlamına gelmez.
 *
 * Kural saf bir fonksiyona taşındı. Artık test, dosyanın içeriğini değil
 * ÜRETİLEN POLİTİKAYI doğruluyor — yani gerçek soruyu.
 *
 * ⚠️ BU DOSYA BİR GÜVENLİK SINIRIDIR. `'unsafe-eval'` yalnızca `dev: true`
 *    dalında verilir ve bu, `tests/unit/csp.test.ts` ile sabitlenmiştir.
 */

/**
 * ⭐ GOOGLE ADS DÖNÜŞÜM TAKİBİ — İZİN VERİLEN ALAN ADLARI
 *
 * ⚠️ BU LİSTE TAHMİN DEĞİL. Google'ın kendi CSP kılavuzundan alınmıştır
 * (developers.google.com/tag-platform/security/guides/csp → "Google Ads:
 * Conversion, Remarketing, Conversion Linker"). Eksik bir alan adı, etiketin
 * SESSİZCE çalışmaması demektir: script yüklenir, hiçbir dönüşüm düşmez ve
 * bu haftalarca fark edilmez — bütçe körlemesine harcanır.
 *
 * ⚠️ `www.google.com.tr` ŞART. Google dönüşüm pikselini kullanıcının ülke
 * alan adına atar (`www.google.<TLD>`); Türkiye'den gelen trafikte
 * `www.google.com` tek başına YETMEZ.
 */
const GOOGLE_ADS_SCRIPT = [
  'https://www.googletagmanager.com',
  'https://www.googleadservices.com',
  'https://googleads.g.doubleclick.net',
  'https://pagead2.googlesyndication.com',
  'https://www.google.com',
] as const

const GOOGLE_ADS_IMG = [
  'https://www.googletagmanager.com',
  'https://www.googleadservices.com',
  'https://googleads.g.doubleclick.net',
  'https://pagead2.googlesyndication.com',
  'https://www.google.com',
  'https://www.google.com.tr',
] as const

const GOOGLE_ADS_CONNECT = [
  'https://www.googletagmanager.com',
  'https://www.googleadservices.com',
  'https://googleads.g.doubleclick.net',
  'https://pagead2.googlesyndication.com',
  'https://ad.doubleclick.net',
  'https://www.google.com',
  'https://www.google.com.tr',
] as const

const GOOGLE_ADS_FRAME = ['https://www.googletagmanager.com', 'https://td.doubleclick.net'] as const

/** 3D Secure sayfaları sağlayıcı alan adında açılır — çerçeveye izin verilir. */
export const PAYMENT_FRAME_SRC = [
  'https://*.iyzipay.com',
  'https://*.iyzico.com',
  'https://*.paytr.com',
] as const

export interface CspOptions {
  /**
   * `next dev` çalışıyor mu?
   *
   * ⚠️ FAIL-CLOSED: çağıran taraf bunu AÇIKÇA vermek zorundadır. Varsayılan
   *    değer verilmez — "unutulursa güvenli tarafta kal" davranışı, buradaki
   *    tek doğru varsayılanın `false` olmasını gerektirir ve zorunlu parametre
   *    bunu derleme zamanında garanti eder.
   */
  dev: boolean
  /**
   * Google Ads etiketi bu ortamda YÜKLENİYOR MU?
   *
   * ⚠️ AYNI FAIL-CLOSED KURALI. Etiket yokken Google alan adlarını politikaya
   * eklemek, kullanılmayan bir saldırı yüzeyini açık bırakmaktır. Bayrak
   * `NEXT_PUBLIC_GOOGLE_ADS_ID` tanımlıysa açılır; yani politika ile sayfada
   * gerçekten yüklenen script TEK KAYNAKTAN türer.
   */
  googleAds: boolean
}

/**
 * Politikayı üretir.
 *
 * ⚠️ `script-src 'unsafe-inline'`: Next.js hidrasyon önyükleyicisini satır içi
 * script olarak yazar. Nonce tabanlı CSP, her isteği dinamik hâle getirip
 * statik/ISR önbelleğini devre dışı bırakır. Bu yüzden satır içi script'e izin
 * verilir ama `object-src 'none'`, `base-uri 'self'` ve `frame-ancestors 'none'`
 * ile saldırı yüzeyi daraltılır. XSS'e karşı asıl savunma React'in kaçışlaması
 * ve sunucu tarafı Zod doğrulamasıdır.
 *
 * ⚠️ `'unsafe-eval'` — YALNIZCA GELİŞTİRMEDE.
 *
 * `next dev`, React Fast Refresh çalışma zamanını
 * (`@next/react-refresh-utils/dist/runtime.js`) ve webpack'in HMR modül
 * değerlendiricisini `eval` ile çalıştırır. CSP bunu engellediğinde tarayıcı
 * şunu atar:
 *
 *     Uncaught EvalError: Evaluating a string as JavaScript violates the
 *     following Content Security Policy directive ... 'unsafe-eval' is not
 *     an allowed source of script
 *
 * Ve bu hata `main-app.js` yüklenirken oluştuğu için **istemci paketi hiç
 * çalışmaz**: React HİDRE OLMAZ. Sayfa sunucudan gelen HTML olarak görünür,
 * butonlar gerçek `<button>`'dır, ama hiçbir `onClick` bağlanmamıştır —
 * tıklamalar sessizce hiçbir şey yapmaz. (Platform kartlarının tepkisiz
 * kalmasının sebebi tam olarak buydu; kartların kendi kodunda hata yoktu.)
 *
 * ⚠️ ÜRETİMDE ASLA VERİLMEZ. Üretim derlemesinde Fast Refresh yoktur; bu izin
 *    orada yalnızca XSS'in kod çalıştırmasını kolaylaştırırdı.
 */
export function buildCsp({ dev, googleAds }: CspOptions): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"]
  if (dev) scriptSrc.push("'unsafe-eval'")
  if (googleAds) scriptSrc.push(...GOOGLE_ADS_SCRIPT)

  // HMR, aynı köken üzerinde bir WebSocket açar. CSP3'te `'self'` çoğu
  // tarayıcıda `ws://` şemasını da kapsar, ama bu davranış tarayıcılar
  // arasında tutarlı DEĞİLDİR; geliştirmede açıkça izin veriyoruz.
  const connectSrc = ["'self'"]
  if (dev) connectSrc.push('ws:', 'wss:')
  if (googleAds) connectSrc.push(...GOOGLE_ADS_CONNECT)

  const imgSrc = ["'self'", 'data:', 'blob:']
  if (googleAds) imgSrc.push(...GOOGLE_ADS_IMG)

  const frameSrc = ["'self'", ...PAYMENT_FRAME_SRC]
  if (googleAds) frameSrc.push(...GOOGLE_ADS_FRAME)

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    // Görseller: kendi sunucumuz + data/blob (SVG ikonlar, önizleme)
    `img-src ${imgSrc.join(' ')}`,
    "font-src 'self' data:",
    // XHR kendi API'mize; Google Ads açıkken yalnızca dönüşüm uç noktalarına.
    `connect-src ${connectSrc.join(' ')}`,
    `frame-src ${frameSrc.join(' ')}`,
    // Ödeme formu sağlayıcıya POST edilebilir.
    `form-action 'self' ${PAYMENT_FRAME_SRC.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ]

  /**
   * ⚠️ `upgrade-insecure-requests` GELİŞTİRMEDE VERİLMEZ.
   *
   * Tarayıcıyı `http://localhost` isteklerini `https://`'e yükseltmeye zorlar;
   * yerel sunucuda TLS olmadığı için sayfa ve HMR bağlantısı kırılır.
   */
  if (!dev) directives.push('upgrade-insecure-requests')

  return directives.join('; ')
}
