/**
 * ⭐ ORTAM AYRIMI DENETİMİ — CLI (Faz 10)
 *
 *   npx tsx scripts/check-env-separation.mts .env.staging .env.production
 *
 * İki ortam dosyasını karşılaştırır ve paylaşılan sırları bildirir.
 * Blocker bulgusu varsa çıkış kodu 1'dir (CI'da kırar).
 *
 * ⚠️ HİÇBİR DEĞER YAZDIRILMAZ — yalnızca değişken ADLARI.
 * ⚠️ Dosyalar `process.env`e YÜKLENMEZ.
 */

import { existsSync, readFileSync } from 'node:fs'
import { compareEnvironments, parseEnvFile } from './env-separation'

const [leftPath, rightPath] = process.argv.slice(2)

if (!leftPath || !rightPath) {
  console.error(
    '\nKullanım: npx tsx scripts/check-env-separation.mts <dosya-A> <dosya-B>\n' +
      '  Örnek:  npx tsx scripts/check-env-separation.mts .env.staging .env.production\n',
  )
  process.exit(1)
}

for (const p of [leftPath, rightPath]) {
  if (!existsSync(p)) {
    console.error(`\nDosya bulunamadı: ${p}\n`)
    process.exit(1)
  }
}

const left = parseEnvFile(readFileSync(leftPath, 'utf8'))
const right = parseEnvFile(readFileSync(rightPath, 'utf8'))

const findings = compareEnvironments(left, right, leftPath, rightPath)

if (findings.length === 0) {
  console.log(`\n✓ Ortam ayrımı temiz: ${leftPath} ↔ ${rightPath}\n`)
  process.exit(0)
}

console.log(`\nOrtam ayrımı raporu: ${leftPath} ↔ ${rightPath}\n`)
for (const f of findings) {
  console.log(`  [${f.level === 'blocker' ? 'ENGEL ' : 'uyarı '}] ${f.code} — ${f.message}`)
}
console.log('')

const blockers = findings.filter((f) => f.level === 'blocker').length
if (blockers > 0) {
  console.error(`${blockers} engelleyici bulgu. Ortamlar birbirinden ayrılmamış.\n`)
  process.exit(1)
}
