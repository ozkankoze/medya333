import 'server-only'

/**
 * ⭐ İSTEMCİ IP ÇÖZÜMLEME — GÜVENİLİR PROXY MODELİ (Faz 11)
 *
 * ⚠️ BU DOSYA BİR GÜVENLİK SINIRIDIR.
 *
 * Rate limit, kimliğini istemci IP'sinden alır. IP yanlış çözülürse rate
 * limit **tamamen atlatılabilir**: saldırgan her istekte farklı bir sahte IP
 * göndererek her seferinde temiz bir kova alır — giriş denemesi, sipariş
 * oluşturma ve misafir sipariş sorgulama limitleri anlamsızlaşır.
 *
 * FAZ 11'DE BULUNAN GERÇEK AÇIK
 *
 * Önceki kod şuydu:
 *
 *     const forwarded = headers.get('x-forwarded-for')
 *     if (forwarded) return forwarded.split(',')[0]!.trim()
 *     return headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? 'unknown'
 *
 * İki ayrı sorun vardı:
 *
 * 1. **`x-forwarded-for`'un EN SOLDAKİ değeri alınıyordu.** Bu başlık bir
 *    zincirdir ve her proxy kendi gördüğü adresi SONA ekler. En soldaki değer
 *    istemcinin GÖNDERDİĞİ değerdir — yani saldırganın yazdığı değer. Tek
 *    güvenilebilir konum, kendi güvendiğimiz proxy'nin eklediği EN SAĞDAKİ
 *    değerdir.
 *
 * 2. **`cf-connecting-ip` körü körüne okunuyordu.** Cloudflare arkasında
 *    değilsek bu başlığı kimse yazmaz — yani onu yazan tek taraf saldırgandır.
 *
 * VERCEL'DE DURUM
 *
 * Vercel `x-forwarded-for` başlığını **üzerine yazar ve dış IP'leri
 * iletmez**; bunu tam olarak IP sahteciliğini önlemek için yapar. Yani Vercel
 * üzerinde başlık tek bir değer içerir ve güvenilirdir. `x-real-ip` ve
 * `x-vercel-forwarded-for` da aynı değeri taşır; ikincisi, Vercel'in ÜSTÜNE
 * bir proxy konduğunda bile Vercel tarafından yazılmış değeri korur.
 * (Kaynak: Vercel — Request headers.)
 *
 * ⚠️ Buradan çıkan sonuç: "Vercel'de sorun yok" demek yeterli DEĞİLDİR.
 * Aynı kod Faz 10'daki Docker + ters proxy yolunda da çalışır ve orada en
 * soldaki değeri almak canlı bir açıktır. Bu yüzden çözüm platforma değil,
 * **açıkça yapılandırılan bir güven modeline** bağlanmıştır.
 */

import { env } from '@/env'

/**
 * Hangi başlığa, neden güvendiğimiz.
 *
 * `vercel`
 *   Vercel'in yazdığı `x-vercel-forwarded-for` tercih edilir. Vercel'in üstüne
 *   (ör. Cloudflare) bir proxy konsa bile bu başlık Vercel tarafından yazılmış
 *   olanı taşır.
 *
 * `xff-rightmost`  ⭐ VARSAYILAN
 *   `x-forwarded-for` zincirinin EN SAĞDAKİ değeri. Tek bir güvenilir hop
 *   (nginx, Caddy, ALB, Vercel) arkasında doğru ve sahtelenemez değerdir.
 *   Vercel'de de doğrudur: orada zincir zaten tek elemanlıdır.
 *
 * `cloudflare`
 *   `cf-connecting-ip`. YALNIZCA gerçekten Cloudflare arkasındaysanız ve
 *   origin'e yalnızca Cloudflare erişebiliyorsa güvenlidir. Açıkça seçilmedikçe
 *   bu başlık OKUNMAZ.
 *
 * `none`
 *   Hiçbir başlığa güvenilmez. Tüm istekler tek bir kimlik altında toplanır —
 *   yani rate limit AŞIRI kısıtlayıcı olur. Bu bilinçli bir "fail-closed"
 *   seçimidir: yanlışlıkla sınırsıza düşmekten iyidir.
 */
export type TrustedProxyMode = 'vercel' | 'xff-rightmost' | 'cloudflare' | 'none'

/** Güvenilmeyen/çözülemeyen istemci için tek ortak kimlik. */
export const UNKNOWN_CLIENT = 'unknown'

/**
 * Yapılandırılmış güven modu.
 *
 * ⚠️ Ortamdan OTOMATİK TAHMİN EDİLMEZ. "Vercel'de miyiz" sorusunu
 * `process.env.VERCEL` ile cevaplamak cazip ama yanıltıcıdır: aynı kod
 * Docker'da da çalışır ve orada değişken yoktur — sessizce farklı bir güven
 * modeline geçmek, güvenlik davranışının dağıtım ortamına göre kendiliğinden
 * değişmesi demektir. Varsayılan (`xff-rightmost`) her iki yolda da doğrudur.
 */
export function trustedProxyMode(): TrustedProxyMode {
  return env.TRUSTED_PROXY
}

/**
 * Basit IP biçim doğrulaması.
 *
 * ⚠️ Doğrulama ŞART: başlıktan gelen değer rate limit anahtarına ve
 * (hash'lenerek) denetim kaydına gider. Biçimsiz bir değeri kabul etmek,
 * saldırgana anahtar uzayını istediği gibi genişletme imkânı verir.
 */
export function isPlausibleIp(value: string): boolean {
  const v = value.trim()
  if (v.length === 0 || v.length > 45) return false

  // IPv4 (nokta-ondalık)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    return v.split('.').every((o) => Number(o) <= 255)
  }

  // IPv6 — kaba biçim kontrolü; amaç doğrulama değil, çöp veriyi elemek.
  if (/^[0-9a-fA-F:]+$/.test(v) && v.includes(':')) return true

  return false
}

/** `x-forwarded-for` zincirini ayrıştırır. */
function chain(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((p) => p.trim())
    // IPv6 köşeli parantez ve port ekleri (`[::1]:443`, `1.2.3.4:5678`)
    .map((p) => p.replace(/^\[(.+)\]:\d+$/, '$1').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1'))
    .filter((p) => p.length > 0)
}

/**
 * İstemci IP'sini çözer.
 *
 * ⚠️ Çözülemezse `'unknown'` döner — TAHMİN ÜRETİLMEZ. `'unknown'` tek bir
 * ortak kova demektir; bu, herkesin kendi kovasını almasından (yani rate
 * limit'in kapanmasından) güvenlidir.
 */
export function resolveClientIp(
  headers: Headers,
  mode: TrustedProxyMode = trustedProxyMode(),
): string {
  if (mode === 'none') return UNKNOWN_CLIENT

  const candidates: string[] = []

  if (mode === 'cloudflare') {
    const cf = headers.get('cf-connecting-ip')
    if (cf) candidates.push(cf.trim())
  }

  if (mode === 'vercel') {
    // Vercel'in yazdığı başlık; üstte bir proxy olsa bile korunur.
    const vercelChain = chain(headers.get('x-vercel-forwarded-for'))
    const last = vercelChain[vercelChain.length - 1]
    if (last) candidates.push(last)
  }

  // ⚠️ HER MODDA son çare: `x-forwarded-for` zincirinin EN SAĞDAKİ elemanı.
  // En sağdaki değeri kendi güvendiğimiz proxy ekler; soldakiler istemciden
  // gelmiş olabilir.
  const xff = chain(headers.get('x-forwarded-for'))
  const rightmost = xff[xff.length - 1]
  if (rightmost) candidates.push(rightmost)

  // `x-real-ip` tek değerlidir ve ters proxy'ler tarafından yazılır.
  const real = headers.get('x-real-ip')?.trim()
  if (real) candidates.push(real)

  for (const c of candidates) {
    if (isPlausibleIp(c)) return c
  }

  return UNKNOWN_CLIENT
}

/**
 * Güven modelinin üretimde anlamlı olup olmadığını raporlar.
 * Açılış kapısı (`production-guard`) bunu kullanır.
 */
export function trustedProxyWarning(mode: TrustedProxyMode = trustedProxyMode()): string | null {
  if (mode === 'none') {
    return (
      'TRUSTED_PROXY="none" — istemci IP\'si çözülmüyor. Tüm istekler tek bir ' +
      'rate limit kovasını paylaşır; meşru kullanıcılar birbirini kilitleyebilir. ' +
      'Ters proxy arkasındaysanız "xff-rightmost", Vercel üzerindeyseniz "vercel" kullanın.'
    )
  }
  if (mode === 'cloudflare') {
    return (
      'TRUSTED_PROXY="cloudflare" — `cf-connecting-ip` başlığına güveniliyor. ' +
      'Bu YALNIZCA origin sunucusuna Cloudflare dışından erişilemiyorsa güvenlidir; ' +
      'aksi hâlde rate limit sahte başlıkla atlatılabilir.'
    )
  }
  return null
}
