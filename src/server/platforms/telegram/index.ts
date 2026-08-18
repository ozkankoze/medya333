import 'server-only'

import type { TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { unverified, type PlatformAdapter } from '../adapter'

/**
 * TELEGRAM ADAPTER
 *
 * Bot API `getChat` açık kanallar için sınırlı bilgi verebilir; bot kısıtlarına
 * tabidir ve her kanalda çalışmaz. Faz 6'da değerlendirilecek.
 *
 * FAZ 0 DURUMU: Entegrasyon yok.
 */
export const telegramAdapter: PlatformAdapter = {
  key: 'telegram',

  capabilities: {
    verifyProfile: false,
    verifyPost: false,
    followerCount: false,
    thumbnail: false,
    liveMetric: false,
  },

  supportedTargetTypes: ['CHANNEL', 'GROUP', 'POST'],

  parse(input: string, targetType: TargetType) {
    return parseTarget('telegram', input, targetType)
  },

  async resolve(normalized, _targetType, ctx) {
    return unverified(
      normalized,
      ctx.canonicalUrl,
      'Telegram kanal bilgileri otomatik alınamıyor. Hedefin doğru olduğunu kontrol edip onaylayın.',
    )
  },
}
