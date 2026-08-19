/**
 * ORTAM AYRIMI DOĞRULAMASI — birim testleri (Faz 10)
 *
 * Kanıtlanan şey: iki ortam aynı sırrı paylaşıyorsa araç bunu YAKALAR ve
 * yakalarken sırrın kendisini SIZDIRMAZ.
 */

import { describe, expect, it } from 'vitest'
import {
  MUST_DIFFER,
  compareEnvironments,
  parseEnvFile,
} from '../../scripts/env-separation'

const SECRET_A = 'ZGVuZW1lLXNpci1kZWdlcmktYWFhYWFhYWFhYWFhYWE='
const SECRET_B = 'ZGVuZW1lLXNpci1kZWdlcmktYmJiYmJiYmJiYmJiYmI='

function envMap(over: Record<string, string> = {}) {
  return new Map(
    Object.entries({
      APP_ENV: 'staging',
      AUTH_SECRET: SECRET_A,
      ORDER_TOKEN_SECRET: SECRET_B,
      IP_HASH_SALT: 'aaaa1111bbbb2222cccc3333',
      DATABASE_URL: 'postgresql://u:p@staging-db:5432/medya333',
      REDIS_URL: 'redis://staging-redis:6379',
      ...over,
    }),
  )
}

describe('.env ayrıştırma', () => {
  it('tırnak, yorum ve boş satırları doğru işler', () => {
    const m = parseEnvFile(
      ['# yorum', '', 'A="tırnaklı"', "B='tekli'", 'C=düz', 'export D=export-lu', 'BOZUK'].join(
        '\n',
      ),
    )
    expect(m.get('A')).toBe('tırnaklı')
    expect(m.get('B')).toBe('tekli')
    expect(m.get('C')).toBe('düz')
    expect(m.get('D')).toBe('export-lu')
    expect(m.has('BOZUK')).toBe(false)
  })

  it('değer içindeki "=" korunur (bağlantı adresleri, base64 sırlar)', () => {
    const m = parseEnvFile('DATABASE_URL="postgresql://u:p@h:5432/db?schema=public"\nS="abc=="')
    expect(m.get('DATABASE_URL')).toBe('postgresql://u:p@h:5432/db?schema=public')
    expect(m.get('S')).toBe('abc==')
  })

  it('⚠️ dosya process.env\'e YAZILMAZ', () => {
    parseEnvFile('MEDYA333_AYRIM_TESTI="sızmamalı"')
    expect(process.env.MEDYA333_AYRIM_TESTI).toBeUndefined()
  })
})

describe('⭐ paylaşılan sır tespiti', () => {
  it('ayrı sırlar kullanan iki ortam temizdir', () => {
    const staging = envMap()
    const production = envMap({
      APP_ENV: 'production',
      AUTH_SECRET: 'Y2FubGktb3R1cnVtLXNpcnJpLXh4eHh4eHh4eHh4eA==',
      ORDER_TOKEN_SECRET: 'Y2FubGktdG9rZW4tc2lycmkteXl5eXl5eXl5eXl5eXk=',
      IP_HASH_SALT: 'dddd4444eeee5555ffff6666',
      DATABASE_URL: 'postgresql://u:p@prod-db:5432/medya333',
      REDIS_URL: 'redis://prod-redis:6379',
    })

    expect(compareEnvironments(staging, production, 'staging', 'production')).toEqual([])
  })

  it('aynı AUTH_SECRET blocker üretir', () => {
    const shared = { AUTH_SECRET: SECRET_A }
    const findings = compareEnvironments(
      envMap(shared),
      envMap({ ...shared, APP_ENV: 'production', DATABASE_URL: 'postgresql://u:p@prod:5432/x', REDIS_URL: 'redis://prod:6379', ORDER_TOKEN_SECRET: 'farkli-token-sirri-zzzz', IP_HASH_SALT: '9999888877776666' }),
      'staging',
      'production',
    )

    const auth = findings.find((f) => f.key === 'AUTH_SECRET')
    expect(auth?.level).toBe('blocker')
    expect(auth?.code).toBe('SHARED_SECRET')
  })

  it('⚠️ aynı DATABASE_URL blocker üretir — staging canlı veriye yazamaz', () => {
    const url = 'postgresql://u:p@prod-db:5432/medya333'
    const findings = compareEnvironments(
      envMap({ DATABASE_URL: url }),
      envMap({
        APP_ENV: 'production',
        DATABASE_URL: url,
        AUTH_SECRET: 'a-farkli-sir-1111',
        ORDER_TOKEN_SECRET: 'b-farkli-sir-2222',
        IP_HASH_SALT: 'c-farkli-tuz-3333',
        REDIS_URL: 'redis://prod:6379',
      }),
      'staging',
      'production',
    )

    const dbFinding = findings.find((f) => f.key === 'DATABASE_URL')
    expect(dbFinding?.level).toBe('blocker')
    expect(dbFinding?.code).toBe('SHARED_URL')
  })

  it('korunan HER değişken için paylaşım yakalanır', () => {
    const same = Object.fromEntries(MUST_DIFFER.map((k) => [k, `ayni-deger-${k}`]))
    const findings = compareEnvironments(new Map(Object.entries(same)), new Map(Object.entries(same)))
    const blocked = findings.filter((f) => f.level === 'blocker').map((f) => f.key)
    for (const key of MUST_DIFFER) expect(blocked).toContain(key)
  })

  it('⚠️ rapor SIR DEĞERİNİ hiçbir zaman içermez', () => {
    const findings = compareEnvironments(
      envMap(),
      envMap({ APP_ENV: 'production' }),
      'staging',
      'production',
    )
    const text = JSON.stringify(findings)
    expect(text).not.toContain(SECRET_A)
    expect(text).not.toContain(SECRET_B)
    expect(text).not.toContain('aaaa1111bbbb2222cccc3333')
    expect(text).not.toContain('u:p@staging-db')
  })

  it('tek tarafta tanımlı değişken uyarıdır, blocker değil', () => {
    const a = new Map([['AUTH_SECRET', SECRET_A]])
    const b = new Map<string, string>()
    const findings = compareEnvironments(a, b)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.level).toBe('warning')
    expect(findings[0]!.code).toBe('MISSING')
  })

  it('placeholder değerler uyarı üretir', () => {
    const findings = compareEnvironments(
      new Map([['AUTH_SECRET', 'change-me']]),
      new Map([['AUTH_SECRET', 'gercek-canli-sir-9999']]),
    )
    expect(findings.some((f) => f.code === 'PLACEHOLDER')).toBe(true)
  })

  it('aynı APP_BASE_URL uyarıdır (blocker değil)', () => {
    const findings = compareEnvironments(
      new Map([['APP_BASE_URL', 'https://www.medya333.com']]),
      new Map([['APP_BASE_URL', 'https://www.medya333.com']]),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.level).toBe('warning')
  })
})
