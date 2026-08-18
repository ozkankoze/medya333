import 'server-only'

import { env } from '@/env'

/**
 * OTURUM ÇEREZİ — TEK KAYNAK
 *
 * Auth.js yapılandırması (Google akışı) ve kendi oturum yazıcımız
 * (`session.ts`, e-posta/şifre akışı) AYNI çerezi kullanır. Ayrı ayrı
 * tanımlanırsa biri diğerinin oturumunu okuyamaz — bu yüzden tek yerde.
 *
 * ⚠️ `__Secure-` ÖNEKİ SİTE ŞEMASINA GÖRE SEÇİLİR, NODE_ENV'e göre değil.
 * Tarayıcı `__Secure-` önekli çerezi yalnızca HTTPS üzerinden kabul eder.
 * NODE_ENV'e bağlanırsa üretim derlemesi HTTP üzerinde (yerel önizleme,
 * E2E, staging) çalışırken giriş SESSİZCE çalışmaz: sunucu çerezi yazar,
 * tarayıcı atar, kullanıcı sonsuz giriş döngüsüne düşer.
 */

function siteIsHttps(): boolean {
  try {
    return new URL(env.NEXT_PUBLIC_SITE_URL).protocol === 'https:'
  } catch {
    return env.NODE_ENV === 'production'
  }
}

export const SESSION_COOKIE_SECURE = siteIsHttps()

export const SESSION_COOKIE_NAME = SESSION_COOKIE_SECURE
  ? '__Secure-medya333.session'
  : 'medya333.session'

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: SESSION_COOKIE_SECURE,
}

/** middleware Edge runtime'da çalıştığı için isimleri statik olarak bilmeli. */
export const ALL_SESSION_COOKIE_NAMES = ['medya333.session', '__Secure-medya333.session'] as const
