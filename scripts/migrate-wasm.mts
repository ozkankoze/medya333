/**
 * WASM SCHEMA ENGINE ÜZERİNDEN MIGRATION
 *
 * Prisma CLI, `migrate` komutlarında native `schema-engine` binary'sini
 * `binaries.prisma.sh`'ten indirmeye çalışır. Bu adresin engellendiği
 * ortamlarda (kurumsal proxy, kısıtlı CI runner) migration üretmek imkânsız
 * hale gelir.
 *
 * Bu script, Prisma'nın RESMÎ `@prisma/schema-engine-wasm` paketini driver
 * adapter (@prisma/adapter-pg) ile doğrudan sürer. Üretilen SQL, `prisma
 * migrate dev`in ürettiğiyle AYNI motordan çıkar — elle yazılmış DDL değildir.
 *
 * Kullanım:
 *   npx tsx scripts/migrate-wasm.mts create <isim>   # migration üret + uygula
 *   npx tsx scripts/migrate-wasm.mts apply           # bekleyen migration'ları uygula
 *   npx tsx scripts/migrate-wasm.mts status          # durum
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { bindMigrationAwareSqlAdapterFactory } from '@prisma/driver-adapter-utils'
// @ts-expect-error — WASM paketinin tipleri paket içinde, alias gerekmiyor
import { SchemaEngine } from '@prisma/schema-engine-wasm'

const SCHEMA_PATH = path.resolve('prisma/schema.prisma')
const MIGRATIONS_DIR = path.resolve('prisma/migrations')

function loadSchema() {
  return { files: [{ path: SCHEMA_PATH, content: readFileSync(SCHEMA_PATH, 'utf8') }] }
}

/** prisma/migrations klasörünü engine'in beklediği yapıya çevirir. */
function loadMigrationsList() {
  mkdirSync(MIGRATIONS_DIR, { recursive: true })
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  return {
    baseDir: MIGRATIONS_DIR,
    lockfile: {
      path: 'migration_lock.toml',
      content: existsSync(path.join(MIGRATIONS_DIR, 'migration_lock.toml'))
        ? readFileSync(path.join(MIGRATIONS_DIR, 'migration_lock.toml'), 'utf8')
        : null,
    },
    // Shadow DB'de migration'lardan önce çalışacak init script (no-op olabilir)
    shadowDbInitScript: '',
    migrationDirectories: dirs.map((name) => {
      const file = path.join(MIGRATIONS_DIR, name, 'migration.sql')
      return {
        path: name,
        migrationFile: {
          path: 'migration.sql',
          content: existsSync(file)
            ? { tag: 'ok', value: readFileSync(file, 'utf8') }
            : { tag: 'error', value: 'migration.sql bulunamadı' },
        },
      }
    }),
  }
}

const NO_FILTER = { externalTables: [], externalEnums: [] }

async function makeEngine() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL tanımlı değil.')

  const factory = new PrismaPg({ connectionString: url })
  const shadowUrl = process.env.SHADOW_DATABASE_URL
  const shadowFactory = shadowUrl ? new PrismaPg({ connectionString: shadowUrl }) : null

  /**
   * Engine, adapter'ı `ErrorCapturingSqlMigrationAwareDriverAdapterFactory`
   * arayüzünde bekler (her çağrı `{ ok, value }` ile sarmalanmış olmalı).
   * Prisma'nın resmî bağlayıcısı bunu yapar.
   */
  const migrationAware = {
    provider: factory.provider,
    adapterName: factory.adapterName,
    connect: () => factory.connect(),
    connectToShadowDb: () => (shadowFactory ?? factory).connect(),
  }
  const adapter = bindMigrationAwareSqlAdapterFactory(migrationAware as never)

  const logs: string[] = []
  const engine = await SchemaEngine.new(
    { datamodels: undefined },
    (msg: unknown) => {
      const text = typeof msg === 'string' ? msg : JSON.stringify(msg)
      logs.push(text)
      if (process.env.DEBUG_MIGRATE) console.log('[engine]', text)
    },
    adapter,
  )
  return { engine, logs }
}

/** `prisma migrate diff --from-X --to-schema-datamodel --script` karşılığı. */
async function diffToSql(engine: any, from: unknown): Promise<string> {
  const res = await engine.diff({
    from,
    to: { tag: 'schemaDatamodel', ...loadSchema() },
    script: true,
    exitCode: null,
    filters: NO_FILTER,
  })
  return (res.stdout ?? '').trim()
}

function timestamp(): string {
  // Migration klasör adı Prisma biçiminde: YYYYMMDDHHMMSS
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  return (
    String(d.getUTCFullYear()) +
    p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
    p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds())
  )
}

async function cmdCreate(name: string) {
  const { engine } = await makeEngine()

  // Mevcut migration'ların ürettiği duruma göre fark alınır. Böylece ikinci
  // ve sonraki migration'lar da doğru çalışır (yalnızca ilk kurulum değil).
  const existing = loadMigrationsList()
  const from =
    existing.migrationDirectories.length > 0
      ? { tag: 'migrations', ...existing }
      : { tag: 'empty' }

  const sql = await diffToSql(engine, from)
  if (!sql) {
    console.log('Şemada değişiklik yok — migration üretilmedi.')
    return
  }

  const dirName = `${timestamp()}_${name}`
  const dir = path.join(MIGRATIONS_DIR, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'migration.sql'), sql + '\n')
  console.log(`✓ Migration üretildi: ${dirName}  (${sql.split('\n').length} satır SQL)`)

  // migration_lock.toml (Prisma CLI'ın ürettiğiyle aynı)
  const lock = path.join(MIGRATIONS_DIR, 'migration_lock.toml')
  if (!existsSync(lock)) {
    writeFileSync(
      lock,
      '# Please do not edit this file manually\n' +
        '# It should be added in your version-control system (e.g., Git)\n' +
        'provider = "postgresql"\n',
    )
  }

  const applied = await engine.applyMigrations({
    migrationsList: loadMigrationsList(),
    filters: NO_FILTER,
  })
  console.log(`✓ Uygulanan migration sayısı: ${applied.appliedMigrationNames.length}`)
  for (const m of applied.appliedMigrationNames) console.log(`  → ${m}`)
}

async function cmdApply() {
  const { engine } = await makeEngine()
  const applied = await engine.applyMigrations({
    migrationsList: loadMigrationsList(),
    filters: NO_FILTER,
  })
  if (applied.appliedMigrationNames.length === 0) {
    console.log('Bekleyen migration yok — veritabanı güncel.')
  } else {
    console.log(`✓ Uygulandı: ${applied.appliedMigrationNames.join(', ')}`)
  }
}

async function cmdStatus() {
  const { engine } = await makeEngine()
  const d = await engine.diagnoseMigrationHistory({
    migrationsList: loadMigrationsList(),
    optInToShadowDatabase: false,
    filters: NO_FILTER,
  })
  console.log(JSON.stringify(d, null, 2))
}

const [cmd, arg] = process.argv.slice(2)

const run =
  cmd === 'create'
    ? cmdCreate(arg ?? 'migration')
    : cmd === 'apply'
      ? cmdApply()
      : cmd === 'status'
        ? cmdStatus()
        : Promise.reject(new Error('Kullanım: migrate-wasm.mts create <isim> | apply | status'))

run.catch((e) => {
  console.error('Migration hatası:', e?.message ?? e)
  process.exit(1)
})
