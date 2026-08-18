import 'server-only'

import type { TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { unverified, type PlatformAdapter } from '../adapter'

/**
 * TIKTOK ADAPTER
 *
 * Video hedefleri için TikTok oEmbed (https://www.tiktok.com/oembed) kimlik
 * doğrulaması gerektirmez ve başlık, yazar, küçük resim döndürür — izin verilen
 * resmî yol budur. Profil hedefleri için resmî bir public yol YOKTUR.
 *
 * FAZ 0 DURUMU: oEmbed çağrısı İMPLEMENTE EDİLMEDİ (Faz 6). Arayüz hazır.
 */
export const tiktokAdapter: PlatformAdapter = {
  key: 'tiktok',

  capabilities: {
    verifyProfile: false,
    verifyPost: true,
    followerCount: false,
    thumbnail: true,
    liveMetric: false,
  },

  supportedTargetTypes: ['PROFILE', 'VIDEO'],

  parse(input: string, targetType: TargetType) {
    return parseTarget('tiktok', input, targetType)
  },

  async resolve(normalized, targetType, ctx) {
    // FAZ 6 (VIDEO): GET https://www.tiktok.com/oembed?url=<canonicalUrl>
    const reason =
      targetType === 'PROFILE'
        ? 'TikTok profillerini otomatik olarak doğrulayamıyoruz. Hedefi kontrol edip onaylayın.'
        : 'Otomatik doğrulama henüz etkin değil. Hedefi kontrol edip onaylayın.'
    return unverified(normalized, ctx.canonicalUrl, reason)
  },
}
