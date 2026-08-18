import 'server-only'

import type { TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { unverified, type PlatformAdapter } from '../adapter'

/**
 * X (TWITTER) ADAPTER
 *
 * X API v2'nin ücretsiz katmanı yeni geliştiricilere kapalı; kullanıcı arama
 * çağrı başına ücretlidir. Maliyet/fayda dengesi netleşene kadar doğrulama
 * kapalı tutulur ve fallback akışı kullanılır.
 *
 * FAZ 0 DURUMU: Entegrasyon yok.
 */
export const xAdapter: PlatformAdapter = {
  key: 'x',

  capabilities: {
    verifyProfile: false,
    verifyPost: false,
    followerCount: false,
    thumbnail: false,
    liveMetric: false,
  },

  supportedTargetTypes: ['PROFILE', 'POST'],

  parse(input: string, targetType: TargetType) {
    return parseTarget('x', input, targetType)
  },

  async resolve(normalized, _targetType, ctx) {
    return unverified(
      normalized,
      ctx.canonicalUrl,
      'X hesap bilgileri otomatik alınamıyor. Hedefin doğru olduğunu kontrol edip onaylayın.',
    )
  },
}
