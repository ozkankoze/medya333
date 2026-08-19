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
     * ⚠️ SÜREÇ KAPATILIR — yalnızca fırlatmak YETMEZ.
     *
     * Next.js, instrumentation hook'u hata verdiğinde süreci ayakta tutar ve
     * her isteğe 500 döner. Sonuç: konteyner "çalışıyor" görünür, orchestrator
     * onu sağlıklı sayabilir, load balancer trafiği ona yönlendirir ve
     * müşteri bir hata sayfası görür.
     *
     * Doğru davranış açıkça ÖLMEKTİR: konteyner yeniden başlatma döngüsüne
     * girer, dağıtım "unhealthy" olarak durur ve önceki sürüm ayakta kalır.
     *
     * ⚠️ Hata mesajı olduğu gibi yazılır; içinde sır YOKTUR — hem
     * `production-guard` hem damga kontrolü yalnızca DEĞİŞKEN ADI ve BULGU
     * KODU üretir (bkz. ilgili modüllerin başlıkları).
     */
    console.error(err instanceof Error ? err.message : String(err))
    console.error('[boot] Uygulama açılmadı. Süreç sonlandırılıyor.')
    process.exit(1)
  }
}
