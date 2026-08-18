import 'server-only'

import type { TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { unverified, type PlatformAdapter } from '../adapter'

/**
 * YOUTUBE ADAPTER
 *
 * YouTube Data API v3 herkese açık kanal ve video verisini ücretsiz kotayla
 * verir — desteklenen platformlar arasında tam doğrulaması yapılabilen tek
 * platform budur.
 *
 * FAZ 0 DURUMU: Gerçek API çağrısı İMPLEMENTE EDİLMEDİ (Faz 6'ya bırakıldı).
 * Arayüz ve capability bayrakları hazır; API anahtarı yokken adapter
 * UNVERIFIED döner ve akış fallback ile devam eder.
 */
export const youtubeAdapter: PlatformAdapter = {
  key: 'youtube',

  capabilities: {
    verifyProfile: true,
    verifyPost: true,
    followerCount: true, // abone sayısı
    thumbnail: true,
    liveMetric: true,
  },

  supportedTargetTypes: ['CHANNEL', 'PROFILE', 'VIDEO'],

  parse(input: string, targetType: TargetType) {
    return parseTarget('youtube', input, targetType)
  },

  async resolve(normalized, _targetType, ctx) {
    // FAZ 6: YouTube Data API v3
    //   GET https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=...
    //   GET https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=@...
    // API anahtarı YALNIZCA sunucuda tutulur (env.YOUTUBE_API_KEY) — istemciye
    // gönderilirse kota çalınır.
    return unverified(
      normalized,
      ctx.canonicalUrl,
      'Otomatik doğrulama henüz etkin değil. Hedefin doğru olduğunu kontrol edip onaylayın.',
    )
  },
}
