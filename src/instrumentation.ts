/**
 * SÜREÇ AÇILIŞ KANCASI (Next.js instrumentation)
 *
 * Uygulama isteği KARŞILAMADAN önce bir kez çalışır. Üretim yapılandırması
 * hatalıysa burada patlamak, ilk müşteri isteğinde patlamaktan iyidir:
 * container sağlıksız işaretlenir ve dağıtım geri alınır.
 *
 * ⚠️ Yalnızca Node.js runtime'da çalışır; Edge middleware'de env doğrulaması
 * yapılmaz (orada DB/Redis erişimi de yoktur).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { assertProductionReady, isLiveDeployment } = await import('@/server/production-guard')

  // Üretimde blocker varsa fırlatır ve süreç açılmaz.
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
}
