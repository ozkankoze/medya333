/**
 * Seed CLI girişi — `npm run db:seed`.
 * İş mantığı `seedAll()` içindedir; entegrasyon testleri de onu kullanır.
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../src/generated/prisma/client'
import { seedAll } from './index'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL tanımlı değil.')

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

console.log('\nMedya 333 — seed başlıyor\n')
seedAll(db)
  .then(() => console.log('\nSeed tamamlandı.\n'))
  .catch((e) => {
    console.error('Seed hatası:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
