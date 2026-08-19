import 'server-only'

import { env } from '@/env'
import { appBaseUrl } from '@/server/base-url'

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
 *
 * ⚠️ ŞEMA `APP_BASE_URL`DEN OKUNUR — `NEXT_PUBLIC_SITE_URL`den DEĞİL (Faz 9).
 * `NEXT_PUBLIC_` değişkenleri DERLEME sırasında koda gömülür. Aynı imaj
 * `NEXT_PUBLIC_SITE_URL=http://localhost:3000` ile derlenip
 * `https://www.medya333.com` altına konursa çerez `secure` İŞARETLENMEZ ve
 * `__Secure-` öneki kullanılmaz: oturum çerezi HTTPS üzerinden gider ama
 * tarayıcıya "düz HTTP'de de gönderebilirsin" demiş oluruz. Çalışma zamanı
 * değişkeni bu sınıfı tamamen ortadan kaldırır.
 */

function siteIsHttps(): boolean {
  try {
    return new URL(appBaseUrl()).protocol === 'https:'
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
