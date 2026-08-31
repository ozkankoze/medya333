/**
 * ⭐ İSTEMCİ TARAFI JSON İSTEĞİ — TEK GİRİŞ NOKTASI
 *
 * ⚠️⚠️ BU DOSYA BİR OLAYIN SONUCUDUR. Ne olduğu önemli, çünkü aynı hata
 * üç ayrı formda birden vardı ve hiçbiri hata vermiyordu.
 *
 * Formlar şöyle yazılmıştı:
 *
 *     try {
 *       const res = await fetch(url, ...)
 *       if (!res.ok) { ...; return }
 *       e.currentTarget.reset()     // ← await'ten SONRA
 *       router.refresh()
 *     } catch {
 *       setError('Bağlantı hatası. Tekrar deneyin.')
 *     }
 *
 * React, olay işleyicisinin SENKRON bölümü bittikten sonra sentetik olayın
 * `currentTarget` alanını temizler. `await`ten sonra o değer `null`dur ve
 * `null.reset()` bir `TypeError` fırlatır. `TypeError` de aynı `catch`e
 * düşer ve kullanıcıya "Bağlantı hatası" olarak gösterilir.
 *
 * Sonuç, basit bir hata mesajı yanlışlığı DEĞİLDİ:
 *   · Kayıt aslında OLUŞMUŞTU (sunucu 200 dönmüştü).
 *   · Kullanıcı hata gördüğü için düğmeye tekrar basıyordu.
 *   · Her basış YENİ BİR KAYIT daha oluşturuyordu.
 *   · `router.refresh()` hiç çalışmadığı için liste de güncellenmiyor,
 *     yani çoğaltma anında görünmüyordu.
 * Tarayıcı testinde üç denemenin üçü de veritabanına yazıldı ve üçünde de
 * ekranda "Bağlantı hatası" yazdı. Kasa hareketi formunda aynı hata,
 * doğrudan BANKA BAKİYESİNİ çiftliyordu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ÇÖZÜM MESAJI DEĞİŞTİRMEK DEĞİL, YAPIYI DEĞİŞTİRMEKTİR.
 *
 * Buradaki sözleşme: bu fonksiyon ASLA `throw` ETMEZ. Sonucu ayrık bir
 * nesne olarak döndürür. Böylece çağıran taraf başarıdan sonraki arayüz
 * işlerini (`reset`, `refresh`, durum güncelleme) HİÇBİR `try` bloğunun
 * içinde yapmaz — dolayısıyla o işlerdeki bir hata bir daha asla "ağ
 * hatası" diye raporlanamaz. Sınıf olarak kapatıldı, örnek olarak değil.
 */

export type PostJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status: number | null }

/**
 * ⚠️ VARSAYILAN MESAJ "Bağlantı hatası" DEĞİLDİR.
 * Ağ gerçekten koptuysa öyle denir; başka her şey için sunucunun kendi
 * mesajı kullanılır. Her hataya "bağlantı" demek, kullanıcıyı internetini
 * kontrol etmeye yollar — sorun bambaşka yerdeyken.
 */
const NETWORK_MESSAGE = 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'
const UNEXPECTED_MESSAGE = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'

interface ApiErrorBody {
  error?: { message?: string; code?: string }
}

/**
 * ⚠️ GELİŞTİRMEDE GERÇEK HATA KONSOLA YAZILIR, ÜRETİMDE YAZILMAZ.
 * `process.env.NODE_ENV` derleme sırasında sabitlenir, yani üretim
 * paketinde bu dal tamamen elenir; yığın izi kullanıcının konsoluna
 * hiçbir koşulda düşmez.
 */
function logInDev(context: string, err: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[postJson] ${context}`, err)
  }
}

export async function postJson<T = unknown>(
  url: string,
  body?: unknown,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
): Promise<PostJsonResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    // ⚠️ YALNIZCA BURASI GERÇEK BİR AĞ HATASIDIR. `fetch` yalnızca istek
    //    hiç tamamlanamadığında reddeder; 4xx/5xx cevaplar buraya DÜŞMEZ.
    logInDev(`ağ hatası: ${method} ${url}`, err)
    return { ok: false, message: NETWORK_MESSAGE, status: null }
  }

  if (!res.ok) {
    /**
     * ⚠️ HATA GÖVDESİNİ OKUMAK DA BAŞARISIZ OLABİLİR (boş gövde, HTML hata
     * sayfası, kesilen bağlantı). O durumda isteğin kendisi başarısızdır
     * ama ağ sorunu değildir — ayrı ve dürüst bir mesaj gerekir.
     */
    let message = UNEXPECTED_MESSAGE
    try {
      const parsed = (await res.json()) as ApiErrorBody | null
      if (parsed?.error?.message) message = parsed.error.message
    } catch (err) {
      logInDev(`hata gövdesi okunamadı (${res.status}): ${method} ${url}`, err)
    }
    logInDev(`sunucu ${res.status}: ${method} ${url} — ${message}`, null)
    return { ok: false, message, status: res.status }
  }

  /**
   * ⚠️ BAŞARILI CEVABIN GÖVDESİ OKUNAMAZSA İŞLEM YİNE DE BAŞARILIDIR.
   * Sunucu 2xx döndüyse yazma gerçekleşmiştir. Burada hata döndürmek, tam
   * olarak düzeltmeye çalıştığımız yanılgıyı yeniden üretirdi: gerçekleşmiş
   * bir kaydı başarısız göstermek ve kullanıcıyı tekrar denemeye itmek.
   */
  let data: T
  try {
    data = (await res.json()) as T
  } catch (err) {
    logInDev(`başarılı cevabın gövdesi okunamadı: ${method} ${url}`, err)
    data = undefined as T
  }
  return { ok: true, data }
}
