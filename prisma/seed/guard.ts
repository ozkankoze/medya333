/**
 * ⭐ SEED ÜRETİM KAPISI (Faz 10)
 *
 * `npm run db:seed` canlı veritabanına karşı çalıştırılırsa ne olur?
 *
 * Bugünkü seed idempotenttir ve demo veri üretmez — ama bu bir tesadüf değil,
 * korunması gereken bir özelliktir. Yarın birinin seed'e "birkaç örnek sipariş"
 * eklemesi, canlı veritabanında sahte sipariş oluşturması demektir. Daha
 * kötüsü: `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` ortamda kalmışsa seed
 * **canlıda bir SUPERADMIN oluşturur veya şifresini sıfırlar**.
 *
 * Bu yüzden kapı davranışa değil, ORTAMA bakar: canlıda seed ÇALIŞMAZ.
 *
 * ⚠️ Kapı `APP_ENV`e bakar, `NODE_ENV`e değil. `next build` ve birçok CI
 * adımı NODE_ENV'i "production" yapar; seed'i bu yüzden engellemek
 * geliştirici akışını gereksiz yere kırardı. "Canlı mıyız" sorusunun tek
 * doğru kaynağı `APP_ENV`tir (bkz. ADR-027).
 *
 * ⚠️ FAIL-CLOSED: `APP_ENV` tanımsızsa CANLI kabul edilir. Canlı sunucuda
 * değişkeni yazmayı unutmak kapıyı gevşetmez.
 */

export class SeedForbiddenError extends Error {
  readonly code = 'SEED_FORBIDDEN_IN_PRODUCTION'
  constructor(message: string) {
    super(message)
    this.name = 'SeedForbiddenError'
  }
}

export type SeedStage = 'development' | 'test' | 'staging' | 'production'

/** Seed'in çalışmasına izin verilen aşamalar. */
const ALLOWED_STAGES: ReadonlySet<SeedStage> = new Set(['development', 'test', 'staging'])

/**
 * Hangi aşamadayız?
 *
 * `APP_ENV` yalnızca `production | staging | e2e` alır (bkz. `src/env.ts`).
 * Seed açısından `e2e` bir test aşamasıdır. `APP_ENV` hiç yoksa `NODE_ENV`e
 * bakılır; o da yoksa **production** varsayılır.
 */
export function resolveSeedStage(env: NodeJS.ProcessEnv = process.env): SeedStage {
  const appEnv = env.APP_ENV?.trim()

  if (appEnv === 'staging') return 'staging'
  if (appEnv === 'e2e') return 'test'
  if (appEnv === 'production') return 'production'

  // APP_ENV yok → NODE_ENV'e düş
  const nodeEnv = env.NODE_ENV?.trim()
  if (nodeEnv === 'development') return 'development'
  if (nodeEnv === 'test') return 'test'

  // ⚠️ Bilinmeyen/boş ortam = CANLI (fail-closed)
  return 'production'
}

/**
 * Seed çalıştırılabilir mi? Değilse fırlatır.
 *
 * ⚠️ `SEED_ALLOW_PRODUCTION` gibi bir kaçış kapısı BİLİNÇLİ OLARAK YOKTUR.
 * Böyle bir bayrak eklendiği anda, acele eden biri onu ortama yazar ve kapı
 * hiç var olmamış gibi olur. Canlı veritabanına gerçekten seed gerekiyorsa
 * (yeni katalog yayını) doğru yol, seed'i `APP_ENV=staging` ile bir
 * **kopya** üzerinde çalıştırıp SQL farkını gözden geçirmektir.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): SeedStage {
  const stage = resolveSeedStage(env)

  if (!ALLOWED_STAGES.has(stage)) {
    throw new SeedForbiddenError(
      'SEED ÜRETİMDE ÇALIŞTIRILAMAZ.\n' +
        `  Algılanan aşama: ${stage} (APP_ENV=${env.APP_ENV ?? '<tanımsız>'}, ` +
        `NODE_ENV=${env.NODE_ENV ?? '<tanımsız>'})\n` +
        '\n' +
        '  Seed katalog yazar, kupon oluşturur ve SEED_ADMIN_* tanımlıysa\n' +
        '  SUPERADMIN hesabı açar/günceller. Canlı veritabanında bunların\n' +
        '  hiçbiri kazara yapılmamalıdır.\n' +
        '\n' +
        '  İzin verilen aşamalar: development · test · staging\n' +
        '  Canlı katalog güncellemesi için: docs/PRODUCTION_RUNBOOK.md § 6',
    )
  }

  return stage
}
