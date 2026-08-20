/**
 * SÜREÇ AÇILIŞ KANCASI (Next.js instrumentation)
 *
 * Uygulama isteği KARŞILAMADAN önce bir kez çalışır. Yapılandırma hatalıysa
 * burada patlamak, ilk müşteri isteğinde patlamaktan iyidir.
 *
 * ⚠️ Yalnızca Node.js runtime'da çalışır; Edge middleware'de env doğrulaması
 * yapılmaz (orada DB/Redis erişimi de yoktur).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { assertProductionReady, isLiveDeployment } = await import('@/server/production-guard')

    // Üretimde blocker varsa fırlatır.
    const findings = assertProductionReady()

    // Hangi aşamada açıldığımız log'un ilk satırında görünsün: "canlı sandığım
    // ortam aslında staging'miş" hatası en pahalı hatalardan biridir.
    console.warn(
      `[boot] APP_ENV=${process.env.APP_ENV ?? 'production(varsayılan)'} ` +
        `canli=${isLiveDeployment() ? 'EVET' : 'hayır'} bulgu=${findings.length}`,
    )

    for (const f of findings) {
      // ⚠️ Yalnızca kod ve açıklama — hiçbir secret DEĞERİ yazılmaz.
      console.warn(`[boot:${f.level}] ${f.code} — ${f.message}`)
    }

    /**
     * ⭐ VERİTABANINA DOKUNAN KONTROLLER AYRI MODÜLDE.
     *
     * `pg` sürücüsü Edge derlemesinde çözülemez; bu dosya her iki runtime için
     * derlendiğinden, veritabanı erişimi `instrumentation-node` modülüne
     * taşınmıştır ve yalnızca burada, Node.js dalında yüklenir.
     *
     * ⚠️ Yapılandırma kapısından SONRA çalışır: mock ödeme gibi daha ucuz
     * hatalar, bir bağlantı açılmadan önce raporlanmış olur.
     */
    const { checkDeploymentStamp } = await import('@/instrumentation-node')
    await checkDeploymentStamp()
  } catch (err) {
    /**
     * ⚠️ Hata mesajı olduğu gibi yazılır; içinde sır YOKTUR — hem
     * `production-guard` hem damga kontrolü yalnızca DEĞİŞKEN ADI ve BULGU
     * KODU üretir (bkz. ilgili modüllerin başlıkları).
     */
    console.error(err instanceof Error ? err.message : String(err))

    /**
     * ⭐ ÇALIŞMA MODELİNE GÖRE İKİ FARKLI DOĞRU DAVRANIŞ (Faz 11)
     *
     * UZUN ÖMÜRLÜ SÜREÇ (Docker / VM / bare metal):
     *   Süreç KAPATILIR. Yalnızca fırlatmak yetmez — Next.js instrumentation
     *   hatasında süreci ayakta tutar ve her isteğe 500 döner. Konteyner
     *   "çalışıyor" görünür, orchestrator onu sağlıklı sayabilir, load
     *   balancer trafiği ona yönlendirir. Açıkça ölmek, yeniden başlatma
     *   döngüsü başlatır: dağıtım "unhealthy" durur, önceki sürüm ayakta kalır.
     *
     * SERVERLESS (Vercel / Lambda):
     *   `process.exit()` YANLIŞTIR. Fonksiyon örneği anında öldürülür ve o
     *   örnekte işlenmekte olan DİĞER istekler de yarıda kesilir; platform
     *   log'una anlamlı bir hata yerine "runtime exited" düşer. Ayrıca
     *   "yeniden başlat, önceki sürüm ayakta kalsın" diye bir şey yoktur:
     *   her istek zaten yeni bir örnektir.
     *
     *   Doğru davranış FIRLATMAKTIR: örnek 500 döner, hata platformun hata
     *   izleme akışına düşer ve geri alma kararı insana kalır.
     *
     * ⚠️ Bu otomatik tespit, `TRUSTED_PROXY`nin aksine bir GÜVENLİK kararı
     * değildir; süreç yaşam döngüsü kararıdır. Yanlış tarafa düşmek güvenlik
     * açığı üretmez, yalnızca hatanın raporlanma biçimini değiştirir.
     */
    const serverless = Boolean(
      process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? process.env.NETLIFY,
    )

    if (serverless) {
      console.error('[boot] Uygulama açılmadı (serverless — süreç öldürülmüyor).')
      throw err
    }

    console.error('[boot] Uygulama açılmadı. Süreç sonlandırılıyor.')
    process.exit(1)
  }
}
