import 'server-only'

import { TARGET_TYPE, type TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { unverified, type PlatformAdapter } from '../adapter'

/**
 * GENERIC ADAPTER — yeni platformların varsayılan davranışı.
 *
 * Admin panelden bir platform eklendiğinde (örn. Spotify) henüz kendi adapter'ı
 * yoktur. Registry bu adapter'a düşer: format normalize edilir, kanonik URL
 * üretilir, sonuç her zaman UNVERIFIED olur ve kullanıcı onayı istenir.
 *
 * Sonuç: yeni platform eklemek DEPLOY GEREKTİRMEZ. Sadece zengin önizleme
 * istendiğinde bir adapter dosyası yazılır; başka hiçbir yer değişmez.
 */
export const genericAdapter: PlatformAdapter = {
  key: 'generic',

  capabilities: {
    verifyProfile: false,
    verifyPost: false,
    followerCount: false,
    thumbnail: false,
    liveMetric: false,
  },

  supportedTargetTypes: TARGET_TYPE,

  parse(input: string, targetType: TargetType) {
    return parseTarget('generic', input, targetType)
  },

  async resolve(normalized, _targetType, ctx) {
    return unverified(
      normalized,
      ctx.canonicalUrl,
      'Bu platform için otomatik doğrulama bulunmuyor. Lütfen hedefin doğru olduğunu kontrol edip onaylayın.',
    )
  },
}
