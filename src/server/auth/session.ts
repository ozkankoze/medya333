import 'server-only'

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { db } from '@/server/db'
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from './cookies'

/**
 * VERİTABANI OTURUMU — e-posta/şifre girişinin arkasındaki mekanizma
 *
 * ⚠️ NEDEN AUTH.JS'İN CREDENTIALS SAĞLAYICISI KULLANILMIYOR?
 *
 * Auth.js v5, Credentials sağlayıcısını `session.strategy === 'database'` ile
 * TEK sağlayıcı olduğunda `UnsupportedStrategy` hatasıyla reddediyor
 * (@auth/core/lib/utils/assert.js). Yani Google OAuth yapılandırılmamışken —
 * ki ilk canlıya çıkışta olağan durum — e-posta/şifre girişi TAMAMEN çalışmaz.
 *
 * İki seçenek vardı:
 *   a) JWT oturumuna geçmek → oturumu ANINDA iptal etme yeteneği kaybolurdu
 *      (bloklanan kullanıcı token süresi dolana kadar içeride kalırdı).
 *   b) Oturum satırını kendimiz yazmak → Auth.js'in Google için kullandığı
 *      AYNI `Session` tablosu ve AYNI çerez. `auth()` hiçbir fark görmez.
 *
 * (b) seçildi. Mimari karar korunuyor: veritabanı oturumu + e-posta/şifre +
 * Google + misafir siparişi. Google akışı Auth.js'te olduğu gibi kalır.
 *
 * Oturum token'ı 32 bayt rastgeledir; çerez adı ve seçenekleri Auth.js ile
 * ORTAK tek kaynaktan gelir (`./cookies`).
 */

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 gün

/** Yeni oturum satırı oluşturur ve çerezi yazar. */
export async function createDbSession(userId: string): Promise<void> {
  const sessionToken = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)

  await db.session.create({ data: { sessionToken, userId, expires } })

  const store = await cookies()
  store.set(SESSION_COOKIE_NAME, sessionToken, { ...SESSION_COOKIE_OPTIONS, expires })
}

/** Oturumu hem veritabanından hem çerezden siler. */
export async function destroyDbSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE_NAME)?.value
  if (token) {
    await db.session.deleteMany({ where: { sessionToken: token } })
  }
  store.set(SESSION_COOKIE_NAME, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
}

/** Kullanıcının TÜM oturumlarını kapatır (şifre değişimi, bloklama). */
export async function destroyAllSessionsFor(userId: string): Promise<number> {
  const res = await db.session.deleteMany({ where: { userId } })
  return res.count
}
