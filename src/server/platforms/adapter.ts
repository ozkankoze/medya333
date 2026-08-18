import 'server-only'

import type { TargetType } from '@/lib/enums'
import type { ParseResult } from '@/lib/platforms/parse'

/**
 * PLATFORM ADAPTER ARAYÜZÜ
 *
 * KAPSAM SINIRI (Faz 0 kararı #2 / #6):
 * Adapter'lar YALNIZCA hedef doğrulama, profil/gönderi önizleme ve izin verilen
 * veri erişimi için kullanılır. Hiçbir adapter sosyal medya hesabına etkileşim
 * göndermez, hesap oluşturmaz veya otomatik işlem yapmaz. Hizmetin kendisi
 * gerçek kullanıcılar tarafından manuel gerçekleştirilir.
 *
 * SCRAPING YASAK: Ne kendi kodumuzla ne üçüncü parti scraping API'siyle.
 * Yalnızca resmî / izin verilen public API'ler kullanılır.
 */

export interface TargetPreview {
  displayName?: string | null
  handle?: string | null
  /** Dış CDN URL'si. Kaydetmeden önce media-proxy'e indirilir. */
  avatarUrl?: string | null
  thumbnailUrl?: string | null
  followerCount?: number | null
  isPrivate?: boolean | null
  /** Ham API cevabı — denetim ve hata ayıklama için saklanır */
  raw?: unknown
}

export type ResolveOutcome =
  | {
      status: 'VERIFIED'
      normalized: string
      canonicalUrl: string
      externalId?: string
      preview: TargetPreview
      /** "youtube_data_api" | "tiktok_oembed" | ... */
      method: string
    }
  | {
      status: 'UNVERIFIED'
      normalized: string
      canonicalUrl: string
      /** Kullanıcıya gösterilecek açıklama */
      reason: string
      method: 'format_only'
      /** Kullanıcıdan "Bu hedef doğru" onayı istenmeli mi? */
      requiresConfirmation: true
    }
  | { status: 'PRIVATE'; normalized: string; canonicalUrl: string }
  | { status: 'NOT_FOUND'; normalized: string; canonicalUrl: string }
  | { status: 'INVALID'; reason: string; example: string }

export interface AdapterCapabilities {
  /** Profil doğrulanabiliyor mu (resmî API ile)? */
  verifyProfile: boolean
  /** Gönderi/video doğrulanabiliyor mu? */
  verifyPost: boolean
  /** Takipçi/abone sayısı çekilebiliyor mu? UI bu alanı buna göre render eder. */
  followerCount: boolean
  /** Küçük resim alınabiliyor mu? */
  thumbnail: boolean
  /** Fulfillment ölçümü için metrik tekrar sorgulanabiliyor mu? */
  liveMetric: boolean
}

export interface PlatformAdapter {
  readonly key: string
  readonly capabilities: AdapterCapabilities
  readonly supportedTargetTypes: readonly TargetType[]

  /** SAF — ağ yok. lib/platforms/parse.ts'i sarar. */
  parse(input: string, targetType: TargetType): ParseResult

  /**
   * Ağ çağrısı yapar. **ASLA throw etmez** — en kötü ihtimalle UNVERIFIED döner.
   * Adapter çökmesi sipariş kaybına dönüşmemeli.
   */
  resolve(
    normalized: string,
    targetType: TargetType,
    ctx: { canonicalUrl: string; handle?: string },
  ): Promise<ResolveOutcome>

  /** Manuel fulfillment ölçümü. capabilities.liveMetric true ise implemente edilir. */
  fetchMetric?(normalized: string, kind: string): Promise<number | null>
}

// ---------------------------------------------------------------------------
// Dayanıklılık sabitleri (Mimari §8.4)
// ---------------------------------------------------------------------------

export const ADAPTER_TIMEOUT_MS = 3_000
export const ADAPTER_CACHE_TTL_OK_S = 15 * 60
export const ADAPTER_CACHE_TTL_FAIL_S = 2 * 60
export const BREAKER_ERROR_THRESHOLD = 10
export const BREAKER_WINDOW_MS = 5 * 60 * 1000
export const BREAKER_OPEN_MS = 15 * 60 * 1000

/** Zaman aşımlı fetch — her adapter dış çağrısı bunu kullanır. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = ADAPTER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Doğrulanamadı sonucu üretir — fallback akışının tek noktası. */
export function unverified(
  normalized: string,
  canonicalUrl: string,
  reason: string,
): ResolveOutcome {
  return {
    status: 'UNVERIFIED',
    normalized,
    canonicalUrl,
    reason,
    method: 'format_only',
    requiresConfirmation: true,
  }
}
