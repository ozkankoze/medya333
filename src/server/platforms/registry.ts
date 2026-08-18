import 'server-only'

import type { PlatformAdapter } from './adapter'
import { facebookAdapter } from './facebook'
import { genericAdapter } from './generic'
import { instagramAdapter } from './instagram'
import { telegramAdapter } from './telegram'
import { tiktokAdapter } from './tiktok'
import { xAdapter } from './x'
import { youtubeAdapter } from './youtube'

/**
 * ADAPTER REGISTRY
 *
 * Platform.adapterKey → adapter eşlemesi. Anahtar SLUG DEĞİL: admin
 * "Instagram Reels" adında ikinci bir platform açıp adapterKey="instagram"
 * seçerek mevcut mantığı yeniden kullanabilir.
 *
 * Bilinmeyen anahtar → genericAdapter. Bu yüzden admin panelden eklenen yeni
 * bir platform, kodda tek satır değişiklik olmadan aynı gün çalışır.
 */
const REGISTRY = new Map<string, PlatformAdapter>([
  ['generic', genericAdapter],
  ['instagram', instagramAdapter],
  ['tiktok', tiktokAdapter],
  ['youtube', youtubeAdapter],
  ['x', xAdapter],
  ['facebook', facebookAdapter],
  ['telegram', telegramAdapter],
])

export function getAdapter(adapterKey: string | null | undefined): PlatformAdapter {
  if (!adapterKey) return genericAdapter
  return REGISTRY.get(adapterKey) ?? genericAdapter
}

/** Admin "yeni platform" formundaki adapter dropdown'ını doldurur. */
export function listAdapterKeys(): string[] {
  return [...REGISTRY.keys()]
}

export function hasAdapter(adapterKey: string): boolean {
  return REGISTRY.has(adapterKey)
}
