/**
 * Katalogdaki tüm fiyat tablolarını doğrular ve rapor basar.
 * CI'da fiyat boşluğu/çakışması varsa build'i düşürmek için kullanılabilir.
 *   npm run db:validate-pricing
 */
import 'dotenv/config'
import { validateAllPricing } from '../src/server/catalog/admin'

const results = await validateAllPricing()

if (results.length === 0) {
  console.log('\n✓ Tüm fiyat tabloları sağlam — boşluk, çakışma veya geçersiz kademe yok.\n')
  process.exit(0)
}

let errors = 0
for (const r of results) {
  console.log(`\n${r.platformName} · ${r.serviceName} · ${r.variantLabel}  (${r.minQuantity}–${r.maxQuantity})`)
  for (const i of r.issues) {
    if (i.severity === 'error') errors++
    console.log(`  ${i.severity === 'error' ? '✗' : '⚠'} [${i.code}] ${i.message}`)
  }
}
console.log(`\n${errors} hata, ${results.reduce((n, r) => n + r.issues.length, 0) - errors} uyarı\n`)
process.exit(errors > 0 ? 1 : 0)
