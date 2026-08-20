/**
 * ⭐ İSTEMCİ IP GÜVEN MODELİ (Faz 11)
 *
 * Bu dosya bir GÜVENLİK REGRESYON TESTİDİR.
 *
 * Faz 11 denetiminde bulunan gerçek açık: rate limit kimliği
 * `x-forwarded-for`'un EN SOLDAKİ değerinden ve `cf-connecting-ip`'ten
 * okunuyordu. İkisini de istemci yazabilir — yani saldırgan her istekte
 * farklı bir sahte IP göndererek her seferinde TEMİZ bir rate limit kovası
 * alabilir, giriş/sipariş/sorgulama limitlerini tamamen atlatabilirdi.
 *
 * Aşağıdaki testler o davranışın geri gelmesini engeller.
 */

import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_CLIENT,
  isPlausibleIp,
  resolveClientIp,
  trustedProxyWarning,
  type TrustedProxyMode,
} from '@/server/client-ip'

const CLIENT = '203.0.113.9' // gerçek istemci (proxy'nin eklediği)
const SPOOF = '198.51.100.7' // saldırganın yazdığı

function h(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

// ===========================================================================
describe('IP biçim doğrulaması', () => {
  it('geçerli IPv4 kabul edilir', () => {
    for (const ip of ['1.2.3.4', '203.0.113.9', '255.255.255.255', '0.0.0.0']) {
      expect(isPlausibleIp(ip), ip).toBe(true)
    }
  })

  it('geçerli IPv6 kabul edilir', () => {
    for (const ip of ['::1', '2001:db8::1', 'fe80::1ff:fe23:4567:890a']) {
      expect(isPlausibleIp(ip), ip).toBe(true)
    }
  })

  it('⚠️ çöp veri REDDEDİLİR — anahtar uzayı saldırganın eline bırakılmaz', () => {
    for (const bad of [
      '',
      '   ',
      'not-an-ip',
      '999.999.999.999',
      '1.2.3',
      '<script>alert(1)</script>',
      'a'.repeat(200),
      '1.2.3.4 OR 1=1',
      'localhost',
    ]) {
      expect(isPlausibleIp(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})

// ===========================================================================
describe('⭐ SAHTECİLİK — en soldaki değer ASLA kullanılmaz', () => {
  it('saldırgan XFF\'e değer önekleyemez (xff-rightmost)', () => {
    // Saldırgan `X-Forwarded-For: 198.51.100.7` gönderir.
    // Güvendiğimiz proxy gerçek IP'yi SONA ekler.
    const headers = h({ 'x-forwarded-for': `${SPOOF}, ${CLIENT}` })

    expect(resolveClientIp(headers, 'xff-rightmost')).toBe(CLIENT)
    expect(resolveClientIp(headers, 'xff-rightmost')).not.toBe(SPOOF)
  })

  it('uzun sahte zincir de sonucu değiştirmez', () => {
    const headers = h({
      'x-forwarded-for': `1.1.1.1, 2.2.2.2, 3.3.3.3, ${SPOOF}, ${CLIENT}`,
    })
    expect(resolveClientIp(headers, 'xff-rightmost')).toBe(CLIENT)
  })

  it('⚠️ HER modda en soldaki değer sonucu belirlemez', () => {
    const headers = h({ 'x-forwarded-for': `${SPOOF}, ${CLIENT}` })
    for (const mode of ['vercel', 'xff-rightmost', 'cloudflare'] as TrustedProxyMode[]) {
      expect(resolveClientIp(headers, mode), mode).not.toBe(SPOOF)
    }
  })

  it('⚠️ `cf-connecting-ip` açıkça seçilmedikçe OKUNMAZ', () => {
    // Cloudflare arkasında değilsek bu başlığı yazan tek taraf saldırgandır.
    const headers = h({ 'cf-connecting-ip': SPOOF, 'x-forwarded-for': CLIENT })

    expect(resolveClientIp(headers, 'xff-rightmost')).toBe(CLIENT)
    expect(resolveClientIp(headers, 'vercel')).toBe(CLIENT)

    // Yalnızca açık seçimle güvenilir.
    expect(resolveClientIp(headers, 'cloudflare')).toBe(SPOOF)
  })

  it('⚠️ hiçbir güvenilir başlık yoksa sahte başlık kabul EDİLMEZ', () => {
    const headers = h({ 'cf-connecting-ip': SPOOF, 'true-client-ip': SPOOF })
    expect(resolveClientIp(headers, 'xff-rightmost')).toBe(UNKNOWN_CLIENT)
  })

  it('biçimsiz bir "en sağdaki" değer bir sonraki güvenilir kaynağa düşer', () => {
    const headers = h({ 'x-forwarded-for': `${CLIENT}, cok-bozuk`, 'x-real-ip': CLIENT })
    expect(resolveClientIp(headers, 'xff-rightmost')).toBe(CLIENT)
  })
})

// ===========================================================================
describe('vercel modu', () => {
  it('`x-vercel-forwarded-for` tercih edilir', () => {
    // Vercel'in üstüne bir proxy konduğunda XFF değişebilir; Vercel'in
    // kendi başlığı korunur.
    const headers = h({
      'x-vercel-forwarded-for': CLIENT,
      'x-forwarded-for': SPOOF,
    })
    expect(resolveClientIp(headers, 'vercel')).toBe(CLIENT)
  })

  it('Vercel tek değerli XFF yazar — sonuç aynıdır', () => {
    const headers = h({ 'x-forwarded-for': CLIENT, 'x-real-ip': CLIENT })
    expect(resolveClientIp(headers, 'vercel')).toBe(CLIENT)
    expect(resolveClientIp(headers, 'xff-rightmost')).toBe(CLIENT)
  })
})

// ===========================================================================
describe('none modu — fail-closed', () => {
  it('hiçbir başlığa güvenilmez', () => {
    const headers = h({
      'x-forwarded-for': CLIENT,
      'x-real-ip': CLIENT,
      'x-vercel-forwarded-for': CLIENT,
      'cf-connecting-ip': CLIENT,
    })
    expect(resolveClientIp(headers, 'none')).toBe(UNKNOWN_CLIENT)
  })

  it('⚠️ sonuç SINIRSIZ değil, TEK KOVA — güvenli taraf budur', () => {
    // Aynı kimlik dönmesi, herkesin aynı limiti paylaşması demektir.
    // Farklı kimlik dönseydi rate limit tamamen kapanırdı.
    const a = resolveClientIp(h({ 'x-forwarded-for': '1.1.1.1' }), 'none')
    const b = resolveClientIp(h({ 'x-forwarded-for': '2.2.2.2' }), 'none')
    expect(a).toBe(b)
  })
})

// ===========================================================================
describe('port ve köşeli parantez ekleri', () => {
  it('IPv4:port temizlenir', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': `${CLIENT}:51234` }), 'xff-rightmost')).toBe(
      CLIENT,
    )
  })

  it('[IPv6]:port temizlenir', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '[2001:db8::1]:443' }), 'xff-rightmost')).toBe(
      '2001:db8::1',
    )
  })

  it('boşluklu zincir doğru ayrıştırılır', () => {
    expect(
      resolveClientIp(h({ 'x-forwarded-for': `  ${SPOOF} ,   ${CLIENT}  ` }), 'xff-rightmost'),
    ).toBe(CLIENT)
  })
})

// ===========================================================================
describe('yapılandırma uyarıları', () => {
  it('güvenli modlar uyarı üretmez', () => {
    expect(trustedProxyWarning('xff-rightmost')).toBeNull()
    expect(trustedProxyWarning('vercel')).toBeNull()
  })

  it('riskli modlar açıkça uyarır', () => {
    expect(trustedProxyWarning('none')).toContain('tek bir')
    expect(trustedProxyWarning('cloudflare')).toContain('cf-connecting-ip')
  })
})

// ===========================================================================
describe('⭐ RATE LIMIT KİMLİĞİ — bypass gerçekten kapalı', () => {
  it('sahte önek DEĞİŞSE BİLE kimlik AYNI kalır', async () => {
    const { rateLimitIdentifier } = await import('@/server/ratelimit')

    /**
     * Saldırganın senaryosu: her istekte farklı bir sahte IP önekleyerek
     * her seferinde temiz bir kova almak.
     *
     * Güvendiğimiz proxy gerçek IP'yi zincirin SONUNA eklediği için kimlik
     * DEĞİŞMEZ — yani limit saldırganı takip etmeye devam eder.
     */
    const identities = new Set(
      ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'].map((spoof) =>
        rateLimitIdentifier(h({ 'x-forwarded-for': `${spoof}, ${CLIENT}` })),
      ),
    )

    expect(identities.size, '5 farklı sahte önek 5 farklı kova üretti — BYPASS AÇIK').toBe(1)
  })

  it('farklı GERÇEK istemciler farklı kimlik alır (limit fazla kısıtlamıyor)', async () => {
    const { rateLimitIdentifier } = await import('@/server/ratelimit')
    const a = rateLimitIdentifier(h({ 'x-forwarded-for': '203.0.113.1' }))
    const b = rateLimitIdentifier(h({ 'x-forwarded-for': '203.0.113.2' }))
    expect(a).not.toBe(b)
  })

  it('⚠️ kimlik HAM IP DEĞİLDİR (KVKK — hash + tuz)', async () => {
    const { rateLimitIdentifier } = await import('@/server/ratelimit')
    const id = rateLimitIdentifier(h({ 'x-forwarded-for': CLIENT }))
    expect(id).not.toContain(CLIENT)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })
})
