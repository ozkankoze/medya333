/**
 * Seed CLI girişi — `npm run db:seed`.
 * İş mantığı `seedAll()` içindedir; entegrasyon testleri de onu kullanır.
 *
 * ⚠️ ÜRETİM KAPISI BURADADIR ve `seedAll` çağrılmadan ÖNCE çalışır.
 * Kapının CLI'da olması, testlerin `seedAll`i doğrudan çağırabilmesini
 * sağlar (onlar zaten test aşamasındadır ve kendi veritabanlarını kurar).
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../src/generated/prisma/client'
import { seedAll } from './index'
import { assertSeedAllowed, SeedForbiddenError } from './guard'

try {
  const stage = assertSeedAllowed()
  console.log(`\nMedya 333 — seed başlıyor (aşama: ${stage})\n`)
} catch (err) {
  if (err instanceof SeedForbiddenError) {
    console.error(`\n${err.message}\n`)
    process.exit(1)
  }
  throw err
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL tanımlı değil.')

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

seedAll(db)
  .then(() => console.log('\nSeed tamamlandı.\n'))
  .catch((e) => {
    console.error('Seed hatası:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
