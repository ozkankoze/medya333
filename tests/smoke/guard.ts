/**
 * ⭐ DUMAN TESTİ HEDEF KAPISI (Faz 11)
 *
 * ⚠️ CANLI VERİTABANINA TEST VERİSİ YAZILMAZ.
 *
 * Duman testleri iki katmandır:
 *
 *   OKUMA katmanı  (tests/smoke/**)  → hiçbir kayıt oluşturmaz. Canlı dahil
 *                                      HER ortama karşı çalıştırılabilir.
 *   YAZMA katmanı  (tests/e2e/**)    → sipariş, kullanıcı, hedef ve
 *                                      fulfillment kaydı OLUŞTURUR. Yalnızca
 *                                      staging/preview/yerel ortamda çalışır.
 *
 * Bu modül, yazma katmanının canlı alan adına yönlendirilmesini ENGELLER.
 * Kontrol bir "uyarı" değil, bir KAPIDIR: eşleşme varsa Playwright hiç
 * başlamaz.
 */

/** Canlı alan adı — buraya yazma testi çalıştırılamaz. */
export const PRODUCTION_HOSTS = ['www.medya333.com', 'medya333.com']

export class ProductionTargetError extends Error {
  constructor(url: string) {
    super(
      '\n\n' +
        '  ⛔ YAZMA TESTLERİ CANLI ORTAMA KARŞI ÇALIŞTIRILAMAZ\n' +
        '\n' +
        `     Hedef: ${url}\n` +
        '\n' +
        '     Bu paket sipariş, kullanıcı, hedef ve fulfillment KAYDI oluşturur.\n' +
        '     Canlı veritabanında demo kayıt oluşturmak geri alınamaz ve\n' +
        '     gerçek sipariş numaralarıyla karışır.\n' +
        '\n' +
        '     Yapılacak:\n' +
        '       • Yazma testleri için staging/preview adresini kullanın.\n' +
        '       • Canlıya karşı yalnızca OKUMA duman testini çalıştırın:\n' +
        '           SMOKE_BASE_URL=https://www.medya333.com npm run test:smoke\n\n',
    )
    this.name = 'ProductionTargetError'
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/:\d+$/, '')
  } catch {
    return null
  }
}

/** Canlı alan adına yazma testi yönlendirilmişse fırlatır. */
export function assertNotProductionTarget(url: string | undefined): void {
  if (!url) return
  const host = hostOf(url)
  if (host && PRODUCTION_HOSTS.includes(host)) throw new ProductionTargetError(url)
}

/** Hedef canlı mı? (Okuma katmanı bunu bilgi amaçlı kullanır.) */
export function isProductionTarget(url: string | undefined): boolean {
  if (!url) return false
  const host = hostOf(url)
  return Boolean(host && PRODUCTION_HOSTS.includes(host))
}
