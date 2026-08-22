/**
 * ⭐ MIGRATION SQL DENETİMİ (Faz 10)
 *
 * ⚠️ NEDEN VAR?
 *
 * Migration'ları uygulayan araç (`scripts/migrate-wasm.mts` ve
 * `tests/integration/db-setup.ts`) dosyayı noktalı virgülden bölerek
 * ifadelere ayırır. Bir AÇIKLAMA SATIRI içinde noktalı virgül geçtiğinde,
 * cümlenin geri kalanı ayrı bir SQL ifadesi sanılır ve migration
 * "syntax error at or near ..." ile DÜŞER.
 *
 * Bu, Faz 10'da iki kez yaşandı. Bir daha yaşanmaması için kural teste
 * çevrildi: açıklama satırlarında noktalı virgül YASAKTIR.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS = path.resolve(__dirname, '../../prisma/migrations')

const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

describe('migration dosyaları', () => {
  it('en az bir migration var', () => {
    expect(dirs.length).toBeGreaterThan(0)
  })

  /**
   * ⚠️ MUAFİYET LİSTESİ ARTIK BOŞ (Faz 11).
   *
   * Faz 10'da iki dosya "zaten uygulandı, checksum'ı bozmayalım" gerekçesiyle
   * muaf tutulmuştu. Faz 11'de BOŞ bir veritabanında prova yapılınca görüldü
   * ki bu dosyalar SIFIRDAN kurulan bir veritabanında — yani tam olarak yeni
   * üretim veritabanında — ifade bölücüsünü kıran satırlar içeriyordu.
   *
   * Muafiyet, hatayı gizleyen bir rahatlıktı. Yorumlar düzeltildi (SQL anlamı
   * değişmedi) ve liste boşaltıldı. Buraya bir daha isim eklenmemelidir.
   */
  const LEGACY_EXEMPT = new Set<string>([])

  it('⚠️ açıklama satırlarında noktalı virgül YOK (ifade bölücüyü kırar)', () => {
    const offenders: string[] = []

    for (const dir of dirs) {
      if (LEGACY_EXEMPT.has(dir)) continue
      const file = path.join(MIGRATIONS, dir, 'migration.sql')
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith('--') && line.includes(';')) {
          offenders.push(`${dir}/migration.sql:${i + 1}`)
        }
      })
    }

    expect(offenders, `Açıklamada ";" bulundu:\n${offenders.join('\n')}`).toEqual([])
  })

  it('her migration klasöründe migration.sql var', () => {
    for (const dir of dirs) {
      expect(() => readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'))).not.toThrow()
    }
  })

  it('⚠️ hiçbir migration sır veya gerçek bağlantı adresi içermez', () => {
    for (const dir of dirs) {
      const body = readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8')
      expect(body, `${dir}`).not.toMatch(/postgres(ql)?:\/\/[^\s]*:[^\s@]+@/)
      expect(body, `${dir}`).not.toMatch(/re_[A-Za-z0-9]{20,}/)
      expect(body, `${dir}`).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/)
    }
  })
})
