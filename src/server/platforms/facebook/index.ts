import 'server-only'

import type { TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { unverified, type PlatformAdapter } from '../adapter'

/**
 * FACEBOOK ADAPTER
 *
 * Graph API, sahibi olmadığınız bir Sayfa için sayfa erişim token'ı ister.
 * Rastgele profil/sayfa sorgulanamaz. Fallback akışı kullanılır.
 *
 * FAZ 0 DURUMU: Entegrasyon yok.
 */
export const facebookAdapter: PlatformAdapter = {
  key: 'facebook',

  capabilities: {
    verifyProfile: false,
    verifyPost: false,
    followerCount: false,
    thumbnail: false,
    liveMetric: false,
  },

  supportedTargetTypes: ['PROFILE', 'POST', 'VIDEO'],

  parse(input: string, targetType: TargetType) {
    return parseTarget('facebook', input, targetType)
  },

  async resolve(normalized, _targetType, ctx) {
    return unverified(
      normalized,
      ctx.canonicalUrl,
      'Facebook sayfa bilgileri otomatik alınamıyor. Hedefin doğru olduğunu kontrol edip onaylayın.',
    )
  },
}
