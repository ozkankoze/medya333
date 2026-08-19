/**
 * ⭐ ORTAM AYRIMI DOĞRULAMASI (Faz 10)
 *
 * "Staging ayrı sır kullanmalı" bir KURALDIR. Bu modül kuralı DENETLENEBİLİR
 * hâle getirir: iki ortam dosyasını karşılaştırır ve aynı değeri paylaşan
 * sırları bildirir.
 *
 * NEDEN ÖNEMLİ?
 *   • Aynı `AUTH_SECRET` → staging'de üretilen bir oturum çerezi CANLIDA da
 *     geçerlidir. Staging'e erişimi olan herkes canlıda oturum açabilir.
 *   • Aynı `ORDER_TOKEN_SECRET` → staging'de üretilmiş bir misafir takip
 *     linki canlı siparişleri açar.
 *   • Aynı `DATABASE_URL` → staging testleri canlı müşteri verisine yazar.
 *   • Aynı `REDIS_URL` → staging, canlının rate limit sayaçlarını ve katalog
 *     cache'ini ezer.
 *
 * ⚠️ DEĞERLER ASLA YAZDIRILMAZ. Karşılaştırma SHA-256 özetleri üzerinden
 *    yapılır; rapor yalnızca DEĞİŞKEN ADI verir. Aksi hâlde ayrımı doğrulayan
 *    araç, sırları terminal geçmişine ve CI log'una döken araç olurdu.
 */

import { createHash } from 'node:crypto'

/** Ortamlar arasında ASLA paylaşılmaması gereken değişkenler. */
export const MUST_DIFFER = [
  'AUTH_SECRET',
  'ORDER_TOKEN_SECRET',
  'IP_HASH_SALT',
  'DATABASE_URL',
  'REDIS_URL',
  'PAYTR_MERCHANT_KEY',
  'PAYTR_MERCHANT_SALT',
  'IYZICO_SECRET_KEY',
  'IYZICO_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'INVOICE_API_SECRET',
] as const

/**
 * Ortamlar arasında AYNI olması BEKLENEN değişkenler — bunlar sır değildir ve
 * farklı olmaları da normaldir; yalnızca `MUST_DIFFER` denetiminden muaftır.
 */
export const SHARED_ALLOWED = ['MAIL_FROM', 'DEFAULT_TAX_RATE_BP', 'NEXT_PUBLIC_SITE_NAME'] as const

/**
 * Ortamlar arasında FARKLI olması beklenen ama sır olmayan değişkenler.
 * Aynı olmaları "hata" değil ama neredeyse her zaman bir kopyala-yapıştır
 * kazasıdır; uyarı üretilir.
 */
export const SHOULD_DIFFER = ['APP_ENV', 'APP_BASE_URL', 'NEXT_PUBLIC_SITE_URL'] as const

export interface SeparationFinding {
  level: 'blocker' | 'warning'
  code: 'SHARED_SECRET' | 'SHARED_URL' | 'PLACEHOLDER' | 'MISSING'
  key: string
  message: string
}

/**
 * Basit `.env` ayrıştırıcı.
 *
 * ⚠️ `dotenv` KULLANILMAZ: `dotenv/config` okuduğu dosyayı `process.env`e
 * YAZAR. Bu araç iki ortamın sırlarını aynı süreçte açar; onları çalışan
 * sürecin ortamına sızdırmak (ve oradan alt süreçlere taşımak) kabul edilemez.
 */
export function parseEnvFile(content: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out.set(key, value)
  }
  return out
}

/** ⚠️ Kıyaslama için özet — ham değer hiçbir yerde tutulmaz. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

const PLACEHOLDERS = ['change-me', 'changeme', 'placeholder', 'example', 'xxxxx', 'KULLANICI']

/**
 * İki ortamı karşılaştırır.
 *
 * `leftName`/`rightName` yalnızca raporlama içindir (ör. "staging", "production").
 */
export function compareEnvironments(
  left: Map<string, string>,
  right: Map<string, string>,
  leftName = 'A',
  rightName = 'B',
): SeparationFinding[] {
  const findings: SeparationFinding[] = []

  for (const key of MUST_DIFFER) {
    const a = left.get(key)
    const b = right.get(key)

    // Biri tanımsızsa paylaşım yoktur; eksiklik ayrı bir konudur.
    if (!a || !b) {
      if (!a && !b) continue
      findings.push({
        level: 'warning',
        code: 'MISSING',
        key,
        message: `${key} yalnızca ${a ? leftName : rightName} tarafında tanımlı.`,
      })
      continue
    }

    if (digest(a) === digest(b)) {
      const isUrl = key.endsWith('_URL')
      findings.push({
        level: 'blocker',
        code: isUrl ? 'SHARED_URL' : 'SHARED_SECRET',
        key,
        // ⚠️ Değer YAZILMAZ.
        message: isUrl
          ? `${key} ${leftName} ve ${rightName} ortamlarında AYNI adresi gösteriyor. ` +
            'İki ortam aynı veri deposunu paylaşamaz.'
          : `${key} ${leftName} ve ${rightName} ortamlarında AYNI. Her ortam kendi sırrını üretmelidir.`,
      })
    }
  }

  for (const key of SHOULD_DIFFER) {
    const a = left.get(key)
    const b = right.get(key)
    if (a && b && a === b) {
      findings.push({
        level: 'warning',
        code: 'SHARED_URL',
        key,
        message: `${key} iki ortamda da aynı ("${a}"). Ortamların ayrı adresleri olmalıdır.`,
      })
    }
  }

  for (const [name, map] of [
    [leftName, left],
    [rightName, right],
  ] as const) {
    for (const key of MUST_DIFFER) {
      const value = map.get(key)
      if (!value) continue
      const lower = value.toLowerCase()
      if (PLACEHOLDERS.some((p) => lower.includes(p.toLowerCase()))) {
        findings.push({
          level: 'warning',
          code: 'PLACEHOLDER',
          key,
          message: `${key} (${name}) örnek/placeholder bir değere benziyor.`,
        })
      }
    }
  }

  return findings
}
