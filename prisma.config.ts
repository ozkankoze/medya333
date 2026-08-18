import path from 'node:path'
// Prisma 7 CLI .env dosyasını OTOMATİK YÜKLEMEZ. Migration komutlarının
// DATABASE_URL'i görebilmesi için burada açıkça yükleniyor.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 yapılandırması.
 *
 * Rust query engine YOK — queryCompiler (WASM) + driver adapter (@prisma/adapter-pg).
 * Çalışma zamanında binary bağımlılığı olmadığı için serverless soğuk başlangıç
 * daha hızlı ve deployment daha küçük.
 *
 * Prisma 7'de `datasource.url` ARTIK schema.prisma içinde tanımlanmaz; migration
 * ve introspection komutlarının kullandığı bağlantı burada verilir. Uygulama
 * çalışma zamanında bağlantıyı `PrismaClient({ adapter })` ile alır
 * (bkz. src/server/db.ts) — yani URL iki yerde ayrı ayrı yönetilir ve
 * uygulama kodu migration yapılandırmasına bağımlı değildir.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  datasource: {
    url: process.env.DATABASE_URL ?? '',
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },

  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed/cli.ts',
  },
})
