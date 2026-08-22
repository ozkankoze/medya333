/**
 * ⭐ ŞEMA DOĞRULAMA — migration sonrası (Faz 11)
 *
 *   DATABASE_URL="<adres>" npx tsx scripts/verify-schema.mts
 *
 * Migration uygulandıktan sonra şemanın gerçekten yerinde olduğunu PRISMA
 * İSTEMCİSİYLE doğrular. "migrate deploy hata vermedi" ile "tablolar var"
 * aynı şey değildir: bölücü hatası yüzünden yarım uygulanmış bir script
 * sessizce eksik şema bırakabilir.
 *
 * ⚠️ HİÇBİR KAYIT OLUŞTURMAZ — yalnızca okur. Canlıya karşı güvenle
 *    çalıştırılabilir.
 * ⚠️ BAĞLANTI ADRESİNİ YAZDIRMAZ. Hata mesajları bile yalnızca hata TÜRÜNÜ
 *    taşır; sürücü hata metinleri host, kullanıcı adı ve parola içerir.
 */

import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

/** Şemanın ayakta sayılması için var olması ZORUNLU tablolar. */
const REQUIRED_MODELS = [
  'TaxRate',
  'Platform',
  'Service',
  'ServiceVariant',
  'PricingRule',
  'Target',
  'Order',
  'OrderEvent',
  'Payment',
  'PaymentEvent',
  'Fulfillment',
  'Notification',
  'User',
  'Session',
  'AuditLog',
  'DeploymentStamp',
] as const

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('\nDATABASE_URL tanımlı değil.\n')
  process.exit(1)
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

async function main() {
  // --- 1) Uygulanmış migration'lar -----------------------------------------
  const applied = (await db.$queryRaw`
    SELECT "migration_name", "finished_at"
    FROM "_prisma_migrations"
    ORDER BY "started_at"
  `) as Array<{ migration_name: string; finished_at: Date | null }>

  console.log('\n═══ UYGULANMIŞ MIGRATION\'LAR ═══')
  for (const m of applied) {
    console.log(`  ${m.finished_at ? '✓' : '✗ YARIM'}  ${m.migration_name}`)
  }
  const unfinished = applied.filter((m) => !m.finished_at)

  // --- 2) Tablolar ----------------------------------------------------------
  const rows = (await db.$queryRaw`
    SELECT "table_name" FROM information_schema.tables
    WHERE "table_schema" = 'public' AND "table_type" = 'BASE TABLE'
  `) as Array<{ table_name: string }>
  const present = new Set(rows.map((r) => r.table_name))

  console.log(`\n═══ TABLOLAR (${present.size} adet) ═══`)
  const missing: string[] = []
  for (const model of REQUIRED_MODELS) {
    const ok = present.has(model)
    if (!ok) missing.push(model)
    console.log(`  ${ok ? '✓' : '✗'}  ${model}`)
  }

  // --- 3) TaxRate ve Platform PRISMA İSTEMCİSİYLE okunabiliyor mu? ----------
  // ⚠️ Tablonun var olması yetmez: Prisma'nın beklediği SÜTUNLAR da olmalı.
  //    `count()` şemayla uyuşmayan bir tabloda hata verir.
  console.log('\n═══ PRISMA İSTEMCİSİYLE OKUMA ═══')
  let readable = true
  try {
    const taxRates = await db.taxRate.count()
    console.log(`  ✓ TaxRate  okunabiliyor · ${taxRates} kayıt`)
  } catch (err) {
    readable = false
    console.log(`  ✗ TaxRate  OKUNAMIYOR (${err instanceof Error ? err.name : 'hata'})`)
  }
  try {
    const platforms = await db.platform.count()
    console.log(`  ✓ Platform okunabiliyor · ${platforms} kayıt`)
  } catch (err) {
    readable = false
    console.log(`  ✗ Platform OKUNAMIYOR (${err instanceof Error ? err.name : 'hata'})`)
  }

  // --- 4) Dağıtım damgası ---------------------------------------------------
  const stamp = (await db.$queryRaw`
    SELECT "stage", "label" FROM "DeploymentStamp" WHERE "id" = 'singleton' LIMIT 1
  `) as Array<{ stage: string; label: string | null }>

  console.log('\n═══ DAĞITIM DAMGASI ═══')
  if (stamp[0]) {
    console.log(`  ✓ ${stamp[0].stage}${stamp[0].label ? ` · ${stamp[0].label}` : ''}`)
  } else {
    console.log('  ⚠️ DAMGA YOK — `npm run db:stamp -- --stage=<aşama>` çalıştırın.')
    console.log('     Damgasız veritabanında yanlış-ortam koruması ÇALIŞMAZ.')
  }

  // --- Sonuç ----------------------------------------------------------------
  const failed = missing.length > 0 || unfinished.length > 0 || !readable
  console.log('\n' + '─'.repeat(60))
  if (failed) {
    if (unfinished.length) console.log(`⛔ YARIM KALMIŞ MIGRATION: ${unfinished.map((m) => m.migration_name).join(', ')}`)
    if (missing.length) console.log(`⛔ EKSİK TABLO: ${missing.join(', ')}`)
    if (!readable) console.log('⛔ Prisma istemcisi tabloları okuyamıyor — şema/istemci uyuşmuyor.')
    console.log('\nŞEMA DOĞRULAMASI DÜŞTÜ.\n')
    process.exitCode = 1
  } else {
    console.log('✓ ŞEMA DOĞRULANDI — tüm zorunlu tablolar yerinde ve okunabiliyor.\n')
  }
}

main()
  .catch((err) => {
    // ⚠️ Yalnızca hata TÜRÜ — bağlantı adresi taşınmaz.
    console.error(`\nDoğrulama çalıştırılamadı: ${err instanceof Error ? err.name : 'bilinmeyen hata'}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    void db.$disconnect()
  })
