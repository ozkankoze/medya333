/**
 * ⭐ DAĞITIM DAMGASI ARACI (Faz 10)
 *
 *   npx tsx scripts/db-stamp.mts --check
 *   npx tsx scripts/db-stamp.mts --stage=staging --label="hetzner-db-02"
 *   npx tsx scripts/db-stamp.mts --stage=production --force
 *
 * Veritabanına "ben hangi ortamım" bilgisini yazar. Uygulama açılışta bu
 * damgayı okur; uyuşmazlık varsa AÇILMAZ (bkz. src/server/deployment-stamp.ts).
 *
 * ⚠️ AŞAMA ORTAMDAN TAHMİN EDİLMEZ. `--stage` açıkça verilmelidir: bu komut
 * bir kez çalıştırılır ve sonucu kalıcıdır; "APP_ENV neyse o" davranışı,
 * yanlış terminalde çalıştırıldığında canlı veritabanını sessizce yeniden
 * damgalardı.
 *
 * ⚠️ Mevcut damganın ÜZERİNE YAZMAK `--force` ister.
 */

import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import {
  DEPLOYMENT_STAGES,
  STAMP_ID,
  isDeploymentStage,
  readDeploymentStamp,
} from '../src/server/deployment-stamp'

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  const eq = hit.indexOf('=')
  return eq === -1 ? '' : hit.slice(eq + 1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL tanımlı değil.')
  process.exit(1)
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

async function main() {
  const existing = await readDeploymentStamp(db).catch((err: unknown) => {
    console.error(
      '\nDamga tablosu okunamadı. Migration uygulanmamış olabilir:\n' +
        '  npm run db:deploy   (veya: npx tsx scripts/migrate-wasm.mts apply)\n' +
        `  Hata türü: ${err instanceof Error ? err.name : 'bilinmiyor'}\n`,
    )
    process.exit(1)
  })

  const check = arg('check') !== undefined
  if (check) {
    if (!existing) {
      console.log('\nDamga YOK. Bu veritabanı henüz bir ortama atanmamış.\n')
      process.exit(2)
    }
    console.log(
      `\nDamga: ${existing.stage}` +
        (existing.label ? ` · ${existing.label}` : '') +
        `\n  Tarih: ${existing.stampedAt.toISOString()}` +
        (existing.stampedBy ? `\n  Yazan: ${existing.stampedBy}` : '') +
        '\n',
    )
    return
  }

  const stage = arg('stage')
  if (!stage) {
    console.error(
      '\n--stage zorunludur.\n' +
        `  Geçerli değerler: ${DEPLOYMENT_STAGES.join(' · ')}\n` +
        '  Örnek: npx tsx scripts/db-stamp.mts --stage=staging --label="hetzner-db-02"\n' +
        '  Mevcut damgayı görmek için: npx tsx scripts/db-stamp.mts --check\n',
    )
    process.exit(1)
  }
  if (!isDeploymentStage(stage)) {
    console.error(`\nGeçersiz aşama: "${stage}". Geçerli: ${DEPLOYMENT_STAGES.join(' · ')}\n`)
    process.exit(1)
  }

  const force = arg('force') !== undefined
  if (existing && existing.stage !== stage && !force) {
    console.error(
      `\nBu veritabanı zaten "${existing.stage}" olarak damgalı.\n` +
        `  İstenen: "${stage}"\n` +
        '\n' +
        '  Üzerine yazmak, bir ortamın veritabanını başka bir ortama devretmek\n' +
        '  demektir. Gerçekten bunu istiyorsanız --force ekleyin.\n',
    )
    process.exit(1)
  }
  if (existing && existing.stage === stage) {
    console.log(`\nDamga zaten "${stage}". Değişiklik yapılmadı.\n`)
    return
  }

  // `--label` verilmediyse mevcut not KORUNUR: aşama değiştirmek, operatörün
  // bıraktığı "hangi sunucu" notunu silmek için bir sebep değildir.
  const label = arg('label')?.trim() || existing?.label || null
  const stampedBy = process.env.STAMPED_BY?.trim() || null

  await db.$executeRaw`
    INSERT INTO "DeploymentStamp" ("id", "stage", "label", "stampedAt", "stampedBy")
    VALUES (${STAMP_ID}, ${stage}, ${label}, NOW(), ${stampedBy})
    ON CONFLICT ("id") DO UPDATE
      SET "stage" = EXCLUDED."stage",
          "label" = EXCLUDED."label",
          "stampedAt" = EXCLUDED."stampedAt",
          "stampedBy" = EXCLUDED."stampedBy"
  `

  console.log(`\nDamgalandı: ${stage}${label ? ` · ${label}` : ''}\n`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    void db.$disconnect()
  })
