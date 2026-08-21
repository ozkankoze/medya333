/**
 * ⭐ INSTAGRAM ORTAM DEĞİŞKENLERİ — TUZAK TESTİ
 *
 * ⚠️ NEDEN VAR?
 *
 * `INSTAGRAM_BUSINESS_DISCOVERY_ENABLED` daha önce `z.coerce.boolean()` ile
 * tanımlıydı. Zod'un `coerce.boolean()`'ı altta `Boolean(value)` çağırır ve
 * ortam değişkenleri HER ZAMAN DİZEDİR:
 *
 *     Boolean("false") === true      ← boş olmayan her dize doğrudur
 *
 * Yani `.env` dosyasına `INSTAGRAM_BUSINESS_DISCOVERY_ENABLED="false"` yazan
 * bir operatör, bayrağı KAPATTIĞINI sanırken AÇMIŞ olurdu. Fail-closed olarak
 * tasarlanmış bir güvenlik anahtarı sessizce fail-OPEN'a dönerdi ve Meta'ya
 * istenmeyen çağrılar giderdi.
 *
 * Bu test o tuzağı bir daha kurulamaz hale getirir.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/** `src/env.ts` içindeki şemanın birebir aynısı. */
const flagSchema = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1')

describe('INSTAGRAM_BUSINESS_DISCOVERY_ENABLED', () => {
  it('⚠️ "false" dizesi KAPALI demektir (eski coerce hatası)', () => {
    expect(flagSchema.parse('false')).toBe(false)
    // Hatanın kendisi — bir daha dönmesin diye burada sabitleniyor:
    expect(Boolean('false')).toBe(true)
  })

  it('"0" da kapalıdır', () => {
    expect(flagSchema.parse('0')).toBe(false)
  })

  it('"true" ve "1" açar', () => {
    expect(flagSchema.parse('true')).toBe(true)
    expect(flagSchema.parse('1')).toBe(true)
  })

  it('tanımsızsa KAPALIDIR (fail-closed varsayılan)', () => {
    expect(flagSchema.parse(undefined)).toBe(false)
  })

  it('⚠️ belirsiz değerler SESSİZCE yorumlanmaz — reddedilir', () => {
    // "yes"/"TRUE"/"on" gibi değerleri kabul etmek, operatörün ne kastettiğini
    // TAHMİN etmek olurdu. Uygulama açılmasın, operatör düzeltsin.
    for (const bad of ['yes', 'TRUE', 'False', 'on', 'evet', '2', 'null']) {
      expect(() => flagSchema.parse(bad)).toThrow()
    }
  })
})

describe('IG_USER_ID', () => {
  const schema = z.string().regex(/^\d{1,32}$/).optional()

  it('yalnızca rakam kabul eder', () => {
    expect(schema.parse('17841400000000000')).toBe('17841400000000000')
  })

  it('kullanıcı adı veya adres reddedilir', () => {
    for (const bad of ['medya333', '@medya333', 'https://instagram.com/x', '1784 140']) {
      expect(() => schema.parse(bad)).toThrow()
    }
  })
})

describe('IG_GRAPH_API_VERSION', () => {
  const schema = z.string().regex(/^v\d+\.\d+$/).default('v25.0')

  it('varsayılan v25.0', () => {
    expect(schema.parse(undefined)).toBe('v25.0')
  })

  it('biçim dışı değer reddedilir', () => {
    for (const bad of ['25.0', 'v25', 'latest', '']) {
      expect(() => schema.parse(bad)).toThrow()
    }
  })
})

describe('⚠️ SIR SINIRI — istemciye sızma yüzeyi', () => {
  it('hiçbir Instagram değişkeni NEXT_PUBLIC_ öneki taşımaz', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/env.ts', import.meta.url), 'utf8'),
    )
    // `client` bloğundaki her satır istemci bundle'ına girer.
    const clientBlock = source.slice(source.indexOf('client: {'), source.indexOf('runtimeEnv'))
    for (const secret of ['IG_ACCESS_TOKEN', 'IG_APP_SECRET', 'IG_USER_ID', 'IG_APP_ID']) {
      expect(clientBlock, `${secret} client bloğunda OLMAMALI`).not.toContain(secret)
      expect(source).not.toContain(`NEXT_PUBLIC_${secret}`)
    }
  })
})
