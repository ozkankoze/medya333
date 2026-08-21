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
export function buildCsp({ dev }: CspOptions): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"]
  if (dev) scriptSrc.push("'unsafe-eval'")

  // HMR, aynı köken üzerinde bir WebSocket açar. CSP3'te `'self'` çoğu
  // tarayıcıda `ws://` şemasını da kapsar, ama bu davranış tarayıcılar
  // arasında tutarlı DEĞİLDİR; geliştirmede açıkça izin veriyoruz.
  const connectSrc = ["'self'"]
  if (dev) connectSrc.push('ws:', 'wss:')

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    // Görseller: kendi sunucumuz + data/blob (SVG ikonlar, önizleme)
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // XHR yalnızca kendi API'mize; üçüncü parti analytics YOK.
    `connect-src ${connectSrc.join(' ')}`,
    `frame-src 'self' ${PAYMENT_FRAME_SRC.join(' ')}`,
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
