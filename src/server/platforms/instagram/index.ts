import 'server-only'

import type { TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { unverified, type PlatformAdapter } from '../adapter'

/**
 * INSTAGRAM ADAPTER — Faz 0: fallback akışı (Faz 0 kararı #2)
 *
 * DURUM (Ağustos 2026):
 * Instagram Graph API, sahibi olmadığınız rastgele bir hesabın profil bilgisini
 * vermez. Business Discovery endpoint'i HEM sorgulayan HEM hedef hesabın
 * Business/Creator olmasını, bağlı bir Facebook Sayfası ve Meta App Review
 * onayını gerektirir. Bu yüzden varsayılan sonuç UNVERIFIED'dır.
 *
 * SCRAPING KULLANILMAZ. Ne kendi kodumuzla ne üçüncü parti scraping API'siyle.
 *
 * FALLBACK AKIŞI:
 *   URL/handle girilir → normalize edilir → kullanıcı adı çıkarılır
 *   → kanonik URL kullanıcıya gösterilir → "Bu hedef doğru" onayı alınır
 *   → sipariş devam eder (Target.userConfirmed = true, TARGET_CONFIRMED olayı)
 *
 * İLERİDE RESMÎ API EKLENDİĞİNDE:
 *   `INSTAGRAM_BUSINESS_DISCOVERY_ENABLED` env bayrağı açılır ve aşağıdaki
 *   `resolveViaBusinessDiscovery` implemente edilir. Arayüz, çağıran kod ve
 *   UI DEĞİŞMEZ — sadece dönen status VERIFIED olmaya başlar.
 */
export const instagramAdapter: PlatformAdapter = {
  key: 'instagram',

  capabilities: {
    // Business Discovery devreye alınırsa bu bayraklar env'den okunacak şekilde
    // güncellenir; UI otomatik olarak takipçi alanını göstermeye başlar.
    verifyProfile: false,
    verifyPost: false,
    followerCount: false,
    thumbnail: false,
    liveMetric: false,
  },

  /**
   * ⚠️ VIDEO dahildir: reel/tv bağlantıları `parseTarget` tarafından gönderi
   * ile AYNI şekilde çözümlenir ve katalogdaki "Görüntülenme" hizmeti VIDEO
   * hedefi kullanır. Liste eksik kaldığında katalog ile adapter sessizce
   * ayrışıyordu (bkz. assertTargetTypeSupported).
   */
  supportedTargetTypes: ['PROFILE', 'POST', 'VIDEO'],

  parse(input: string, targetType: TargetType) {
    return parseTarget('instagram', input, targetType)
  },

  async resolve(normalized, targetType, ctx) {
    // Gelecekteki resmî API dalı — şu an kapalı, entegrasyon yok.
    // if (env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED) {
    //   return resolveViaBusinessDiscovery(normalized, ctx)
    // }

    const reason =
      targetType === 'POST'
        ? 'Instagram gönderileri için otomatik önizleme bulunmuyor. Bağlantının doğru olduğunu kontrol edip onaylayın.'
        : 'Instagram hesap bilgileri resmî API üzerinden alınamıyor. Hedefin doğru olduğunu kontrol edip onaylayın.'

    return unverified(normalized, ctx.canonicalUrl, reason)
  },
}
