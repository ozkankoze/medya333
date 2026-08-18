import 'server-only'

import { cookies } from 'next/headers'
import { SESSION_COOKIE_SECURE } from '@/server/auth/cookies'

/**
 * ÖDEME DÖNÜŞ ÇEREZİ
 *
 * Sorun: Misafir kullanıcı ödeme sağlayıcısına gidip geri döndüğünde,
 * dönüş sayfasının "bu sipariş senin mi" sorusunu cevaplayabilmesi gerekir.
 * Takip token'ını success URL'ine koymak en kolay yol olurdu ama token
 * tarayıcı geçmişine, sunucu erişim kayıtlarına ve `Referer` başlığına
 * düşerdi (bkz. ADR-009).
 *
 * Çözüm: Ödeme başlatılırken token kısa ömürlü, `httpOnly` bir çereze yazılır.
 * Sağlayıcı dönüşü üst düzey GET navigasyonu olduğu için `SameSite=Lax`
 * çerez tarayıcı tarafından GÖNDERİLİR. Token URL'e hiç girmez.
 *
 * TTL 2 saat: bir ödeme oturumundan uzun, kalıcı bir yetkiden kısa.
 *
 * ⚠️ Bu çerez bir KOLAYLIKTIR, yetkinin tek kaynağı değil. `cookies()` istek
 * bağlamı dışında (örn. arka plan işi, test koşumu) hata fırlatır; bu yüzden
 * tüm çağrılar yutulur. Çerez yazılamazsa ödeme akışı DÜŞMEZ — kullanıcı
 * takip bağlantısıyla siparişine erişmeye devam eder.
 */

const COOKIE_NAME = 'medya333.pay'
const TTL_SECONDS = 2 * 60 * 60

interface PaymentReturnCookie {
  orderNo: string
  token: string
}

export async function setPaymentReturnCookie(orderNo: string, token: string): Promise<void> {
  try {
    const store = await cookies()
    store.set(COOKIE_NAME, JSON.stringify({ orderNo, token } satisfies PaymentReturnCookie), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: SESSION_COOKIE_SECURE,
      maxAge: TTL_SECONDS,
    })
  } catch {
    // İstek bağlamı yok — çerez yazılamaz, akış etkilenmez.
  }
}

/** İlgili sipariş için çerezdeki token'ı döndürür; başka sipariş içinse null. */
export async function readPaymentReturnToken(orderNo: string): Promise<string | null> {
  try {
    const store = await cookies()
    const raw = store.get(COOKIE_NAME)?.value
    if (!raw) return null
    const parsed = JSON.parse(raw) as PaymentReturnCookie
    // ⚠️ Çerez YALNIZCA yazıldığı sipariş için geçerlidir.
    if (parsed.orderNo !== orderNo) return null
    return parsed.token || null
  } catch {
    return null
  }
}

export async function clearPaymentReturnCookie(): Promise<void> {
  try {
    const store = await cookies()
    store.set(COOKIE_NAME, '', { path: '/', maxAge: 0 })
  } catch {
    /* istek bağlamı yok */
  }
}
