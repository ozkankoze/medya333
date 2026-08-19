'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * ⭐ YÖNETİM YAZMA İŞLEMLERİ — ORTAK İSTEMCİ (Faz 8)
 *
 * Her katalog formu aynı üç şeye ihtiyaç duyar: istek at, hatayı Türkçe
 * göster, başarıda sayfayı tazele. Bunu her bileşende tekrar yazmak,
 * bir yerde `res.ok` kontrolünü unutmakla sonuçlanır — o zaman form
 * "kaydedildi" der ama hiçbir şey kaydedilmez.
 *
 * ⚠️ YETKİ BURADA DEĞİL SUNUCUDA. Bu modül yalnızca arayüzdür; her uç
 * `adminHandler` üzerinden kimlik → rol → rate limit → Zod zincirinden geçer.
 * Buradaki `canWrite` yalnızca gereksiz düğme göstermemek içindir.
 */

export interface MutationState {
  busy: boolean
  error: string | null
  /** Alan bazlı doğrulama hataları (Zod `fieldErrors`) */
  fieldErrors: Record<string, string[]>
  ok: boolean
}

export interface AdminMutation extends MutationState {
  send: (
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ) => Promise<boolean>
  reset: () => void
}

export function useAdminMutation(): AdminMutation {
  const router = useRouter()
  const [state, setState] = useState<MutationState>({
    busy: false,
    error: null,
    fieldErrors: {},
    ok: false,
  })

  const send = useCallback(
    async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
      setState({ busy: true, error: null, fieldErrors: {}, ok: false })
      try {
        const res = await fetch(path, {
          method,
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })

        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as {
            error?: { message?: string; details?: Record<string, string[]> }
          } | null
          setState({
            busy: false,
            /**
             * ⚠️ Sunucunun Türkçe mesajı olduğu gibi gösterilir; istemcide
             * yeniden yazılmaz. Böylece iş kuralı mesajları TEK YERDE kalır.
             */
            error: json?.error?.message ?? 'İşlem tamamlanamadı.',
            fieldErrors: json?.error?.details ?? {},
            ok: false,
          })
          return false
        }

        setState({ busy: false, error: null, fieldErrors: {}, ok: true })
        router.refresh()
        return true
      } catch {
        setState({
          busy: false,
          error: 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.',
          fieldErrors: {},
          ok: false,
        })
        return false
      }
    },
    [router],
  )

  const reset = useCallback(
    () => setState({ busy: false, error: null, fieldErrors: {}, ok: false }),
    [],
  )

  return { ...state, send, reset }
}

/**
 * ⭐ TL METNİ → TAM SAYI KURUŞ
 *
 * ⚠️ KAYAN NOKTALI ARİTMETİK YOK. `parseFloat("8.29") * 100` 828.9999999…
 * verir; `Math.round` ile düzeltilse bile kademe sınırlarında bir kuruş
 * kayabilir. Metin ayrıştırılır: tam kısım ve kuruş kısmı ayrı ayrı tam
 * sayıya çevrilip birleştirilir.
 *
 * ⚠️ AYIRICI BELİRSİZLİĞİ — BU FONKSİYONUN ASIL İŞİ.
 * Naif çözüm "tüm noktaları sil, virgülü noktaya çevir"dir ve TEHLİKELİDİR:
 * sayısal tuş takımından ya da başka bir sistemden yapıştırılan "1349.90"
 * girdisi 134990 kuruş (1.349,90 ₺) yerine 13.499.000 kuruş (134.990 ₺)
 * olarak okunur. Yani YÜZ KAT fiyat hatası, hiçbir uyarı vermeden.
 *
 * Kural:
 *   1. İki farklı ayırıcı varsa (`1.349,90`) SONUNCUSU ondalıktır.
 *   2. Yalnızca virgül varsa (`1349,90`) virgül ondalıktır.
 *   3. Yalnızca nokta varsa: tek nokta ve ardından 3 HANE DEĞİLSE ondalıktır
 *      (`1349.90` → 1349,90 ₺). Tam 3 hane geliyorsa Türkçe binlik ayırıcı
 *      sayılır (`1.234` → 1.234 ₺).
 *   4. Binlik grupları katı doğrulanır: ilk grup 1–3 hane, sonrakiler tam 3.
 *      Böylece `1.2.3` gibi anlamsız girdiler SESSİZCE kabul edilmez.
 *
 * Geçersiz girdi `null` döner — asla "0" olarak yorumlanmaz.
 */
export function parseLiraToMinor(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '')
  if (raw === '') return null
  if (!/^[\d.,]+$/.test(raw)) return null

  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')

  let decimalSep: ',' | '.' | null = null
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.'
  } else if (lastComma >= 0) {
    decimalSep = ','
  } else if (lastDot >= 0) {
    const dots = raw.split('.').length - 1
    const after = raw.length - lastDot - 1
    // Tek nokta + 3 hane ⇒ binlik ("1.234"). Aksi hâlde ondalık ("1349.90").
    decimalSep = dots === 1 && after !== 3 ? '.' : null
  }

  let integerPart = raw
  let fractionPart = ''

  if (decimalSep) {
    const at = raw.lastIndexOf(decimalSep)
    integerPart = raw.slice(0, at)
    fractionPart = raw.slice(at + 1)
    // Ondalık kısım yalnızca 1–2 hane olabilir (kuruş).
    if (!/^\d{1,2}$/.test(fractionPart)) return null
  }

  /**
   * ⚠️ Kalan ayırıcılar BİNLİKTİR ve ondalık ayırıcıdan FARKLI olmak zorundadır.
   * "1,234,5" gibi girdilerde virgül hem binlik hem ondalık rolünde kullanılmış
   * olur; bu belirsizliği tahminle çözmek yerine reddediyoruz.
   */
  const thousandsSep =
    decimalSep === ',' ? '.' : decimalSep === '.' ? ',' : integerPart.includes('.') ? '.' : ','
  if (decimalSep && integerPart.includes(decimalSep)) return null

  const groups = integerPart.split(thousandsSep)
  if (groups.some((g) => g === '')) return null

  if (groups.length === 1) {
    // Ayırıcısız tam kısım: uzunluk serbest ("1349", "1234567").
    if (!/^\d+$/.test(groups[0]!)) return null
  } else {
    // Ayırıcılı: ilk grup 1–3 hane, sonrakiler TAM 3 hane.
    if (!/^\d{1,3}$/.test(groups[0]!)) return null
    for (const g of groups.slice(1)) {
      if (!/^\d{3}$/.test(g)) return null
    }
  }

  const whole = groups.join('')
  const kurus = (fractionPart + '00').slice(0, 2)
  return Number(whole) * 100 + Number(kurus)
}

/** Kuruş → düzenlenebilir TL metni ("134990" → "1349,90"). */
export function minorToLira(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',')
}

/** "1000, 2500 ,5000" → [1000, 2500, 5000]. Geçersiz parça varsa null. */
export function parseQuantityList(text: string): number[] | null {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)
  const out: number[] = []
  for (const p of parts) {
    /**
     * ⚠️ Nokta yalnızca BİNLİK ayırıcı olabilir ve gruplar tam 3 hane olmalıdır.
     * Körlemesine "tüm noktaları sil" deseydik "1.5.2" sessizce 152 olurdu —
     * hazır miktar listesine katalogda olmayan bir sayı girmiş olurduk.
     */
    if (!/^\d{1,3}(\.\d{3})*$/.test(p) && !/^\d+$/.test(p)) return null
    const n = Number(p.replace(/\./g, ''))
    if (!Number.isInteger(n) || n <= 0) return null
    out.push(n)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}
