import 'server-only'

import { env } from '@/env'
import { createIyzicoProvider } from './providers/iyzico'
import { createMockProvider } from './providers/mock'
import { createPaytrProvider } from './providers/paytr'
import type { PaymentProvider, ProviderKey } from './types'

/**
 * SAĞLAYICI KAYIT DEFTERİ
 *
 * Domain kodu sağlayıcıyı ADIYLA çağırmaz; buradan ister. Yeni sağlayıcı
 * eklemek = bir factory + bir satır. Sipariş/webhook servisleri değişmez.
 *
 * Aktif sağlayıcı `PAYMENT_PROVIDER` ile seçilir. Ancak bu yalnızca YENİ
 * ödemeler içindir: mevcut bir Payment kaydı HER ZAMAN kendi `provider`
 * alanıyla işlenir — sağlayıcı değiştirilse bile eski ödemelerin bildirimleri
 * doğru adapter'a gider.
 */

type Factory = () => PaymentProvider

const FACTORIES: Record<ProviderKey, Factory> = {
  iyzico: () => createIyzicoProvider(),
  paytr: () => createPaytrProvider(),
  mock: () => createMockProvider(),
}

/** Testlerde adapter değiştirmek için. */
const overrides = new Map<ProviderKey, PaymentProvider>()

export function setProviderOverride(key: ProviderKey, provider: PaymentProvider | null): void {
  if (provider) overrides.set(key, provider)
  else overrides.delete(key)
}

export function clearProviderOverrides(): void {
  overrides.clear()
}

export class UnknownProviderError extends Error {
  readonly code = 'UNKNOWN_PAYMENT_PROVIDER'
  constructor(key: string) {
    super(`Bilinmeyen ödeme sağlayıcısı: "${key}".`)
    this.name = 'UnknownProviderError'
  }
}

export function isProviderKey(value: string): value is ProviderKey {
  return value === 'iyzico' || value === 'paytr' || value === 'mock'
}

/** Belirli bir sağlayıcıyı getirir (mevcut Payment kayıtları için). */
export function getProvider(key: string): PaymentProvider {
  if (!isProviderKey(key)) throw new UnknownProviderError(key)
  const override = overrides.get(key)
  if (override) return override

  // ⚠️ Mock gerçek para ortamında ASLA çözülmez — yanlış yapılandırma
  // sessizce "her ödeme başarılı" davranışına dönüşmesin.
  // Kapı PAYMENT_ENVIRONMENT'tır, NODE_ENV değil: sandbox/staging dağıtımları
  // da üretim derlemesiyle çalışır (bkz. providers/mock.ts).
  if (key === 'mock' && env.PAYMENT_ENVIRONMENT === 'production') {
    throw new UnknownProviderError('mock')
  }
  return FACTORIES[key]()
}

/**
 * Yeni ödeme için aktif sağlayıcı.
 *
 * Yapılandırma yoksa (bu ortamda olduğu gibi) ve üretimde DEĞİLSEK mock'a
 * düşülür — böylece akışın tamamı gerçek merchant bilgisi olmadan
 * doğrulanabilir. Üretimde düşülmez: yapılandırılmamış sağlayıcı hatası
 * verilir, sahte başarı ÜRETİLMEZ.
 */
export function getActiveProvider(): PaymentProvider {
  const configured = getProvider(env.PAYMENT_PROVIDER)
  if (configured.isConfigured) return configured

  // Gerçek para ortamında mock'a DÜŞÜLMEZ: yapılandırılmamış sağlayıcı
  // döner ve `createPayment` net bir hatayla reddeder. Sahte başarı üretilmez.
  if (env.PAYMENT_ENVIRONMENT === 'production') return configured

  return getProvider('mock')
}

/**
 * BOOT KONTROLÜ — yanlış yapılandırmayı çalışma zamanına bırakma.
 *
 * `PAYMENT_ENVIRONMENT=production` iken mock sağlayıcı seçilmişse uygulama
 * açılmamalıdır: aksi halde canlıda her ödeme "başarılı" görünürdü.
 */
export function assertPaymentConfig(): void {
  if (env.PAYMENT_ENVIRONMENT === 'production' && env.PAYMENT_PROVIDER === 'mock') {
    throw new Error(
      'YAPILANDIRMA HATASI: PAYMENT_ENVIRONMENT=production iken PAYMENT_PROVIDER=mock olamaz. ' +
        'Canlı ortamda gerçek ödeme sağlayıcısı (iyzico veya paytr) tanımlanmalıdır.',
    )
  }
}

/** Operasyon/teşhis: hangi sağlayıcı hazır? */
export function providerHealth(): Array<{
  key: ProviderKey
  displayName: string
  configured: boolean
  environment: string
  active: boolean
}> {
  const activeKey = getActiveProvider().key
  return (['iyzico', 'paytr', 'mock'] as const).map((key) => {
    try {
      const p = getProvider(key)
      return {
        key,
        displayName: p.displayName,
        configured: p.isConfigured,
        environment: p.environment,
        active: key === activeKey,
      }
    } catch {
      return {
        key,
        displayName: key,
        configured: false,
        environment: env.PAYMENT_ENVIRONMENT,
        active: false,
      }
    }
  })
}
