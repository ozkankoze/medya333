/**
 * ENTEGRASYON TESTİ VERİTABANI KURULUMU
 *
 * İki mod:
 *   1. TEST_DATABASE_URL tanımlıysa → o veritabanı kullanılır.
 *      (Docker daemon'ı olmayan ortamlar ve hızlı yerel döngü için.)
 *   2. Tanımlı değilse → Testcontainers ile geçici PostgreSQL ayağa kaldırılır.
 *      (CI'da standart yol; Docker gerekir.)
 *
 * Her iki modda da migration'lar `prisma/migrations/**\/migration.sql`
 * dosyalarından SIRAYLA uygulanır — yani migration SQL'inin kendisi de
 * test edilmiş olur.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { PrismaClient } from '@/generated/prisma/client'

const MIGRATIONS_DIR = path.resolve('prisma/migrations')

export interface TestDatabase {
  url: string
  db: PrismaClient
  /** Testcontainers kullanıldıysa konteyneri durdurur. */
  stop: () => Promise<void>
  mode: 'external' | 'testcontainers'
}

/** Migration klasörlerini sırayla uygular ve _prisma_migrations tablosunu doldurur. */
export async function applyMigrations(url: string): Promise<string[]> {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        id                      VARCHAR(36) PRIMARY KEY,
        checksum                VARCHAR(64) NOT NULL,
        finished_at             TIMESTAMPTZ,
        migration_name          VARCHAR(255) NOT NULL,
        logs                    TEXT,
        rolled_back_at          TIMESTAMPTZ,
        started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_steps_count     INTEGER NOT NULL DEFAULT 0
      )`)

    const applied: string[] = []
    for (const name of dirs) {
      const already = await client.query(
        'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL',
        [name],
      )
      if (already.rowCount) continue

      const sql = readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')
      await client.query(sql)
      await client.query(
        `INSERT INTO "_prisma_migrations"(id, checksum, migration_name, finished_at, applied_steps_count)
         VALUES ($1, $2, $3, now(), 1)`,
        [`${name}-test`, 'test', name],
      )
      applied.push(name)
    }
    return applied
  } finally {
    await client.end()
  }
}

export async function setupTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL

  if (external) {
    await applyMigrations(external)
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: external }) })
    return { url: external, db, mode: 'external', stop: async () => void (await db.$disconnect()) }
  }

  // Testcontainers — CI'daki standart yol
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('medya333_test')
    .withUsername('medya333')
    .withPassword('medya333')
    .start()

  const url = container.getConnectionUri()
  await applyMigrations(url)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  return {
    url,
    db,
    mode: 'testcontainers',
    stop: async () => {
      await db.$disconnect()
      await container.stop()
    },
  }
}

/** Testler arası izolasyon: katalog dışındaki işlem verisini temizler. */
export async function truncateTransactional(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "OrderEvent", "OrderItem", "Refund", "PaymentEvent", "Payment",
                   "CouponRedemption", "Order", "Target", "AuditLog", "AdapterCallLog"
    RESTART IDENTITY CASCADE
  `)
}
