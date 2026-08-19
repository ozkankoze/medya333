/**
 * ORTAM AYRIMI TESTİ (Faz 10)
 *
 * Kanıtlanan şey: **staging olarak çalışan bir uygulama, "production" diye
 * damgalanmış bir veritabanına bağlanamaz.**
 *
 * Bu, "staging ayrı DATABASE_URL kullanmalı" kuralının test edilebilir hâlidir.
 * Kuralın kendisi test edilemez (bir `.env` dosyasına bakmak hiçbir şey
 * kanıtlamaz); ihlalinin YAKALANDIĞI test edilebilir.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@/generated/prisma/client'
import {
  DEPLOYMENT_STAGES,
  STAMP_ID,
  isDeploymentStage,
  readDeploymentStamp,
  resolveDeploymentStage,
  stageRealm,
  stampMismatchMessage,
  verifyDeploymentStamp,
  type DeploymentStage,
} from '@/server/deployment-stamp'
import { setupTestDatabase, type TestDatabase } from './db-setup'

let ctx: TestDatabase
let db: PrismaClient

async function stamp(stage: string, label: string | null = null) {
  await db.$executeRawUnsafe(
    `INSERT INTO "DeploymentStamp" ("id", "stage", "label", "stampedAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT ("id") DO UPDATE
       SET "stage" = EXCLUDED."stage", "label" = EXCLUDED."label"`,
    STAMP_ID,
    stage,
    label,
  )
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  await db.$executeRawUnsafe('DELETE FROM "DeploymentStamp"')
})

describe('aşama çözümleme', () => {
  it('APP_ENV tek doğru kaynaktır', () => {
    expect(resolveDeploymentStage({ APP_ENV: 'production', NODE_ENV: 'development' })).toBe(
      'production',
    )
    expect(resolveDeploymentStage({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe('staging')
    expect(resolveDeploymentStage({ APP_ENV: 'e2e', NODE_ENV: 'production' })).toBe('e2e')
  })

  it('APP_ENV yoksa NODE_ENV=development → development', () => {
    expect(resolveDeploymentStage({ NODE_ENV: 'development' })).toBe('development')
  })

  it('⚠️ FAIL-CLOSED: hiçbir değişken yoksa production varsayılır', () => {
    expect(resolveDeploymentStage({})).toBe('production')
    expect(resolveDeploymentStage({ APP_ENV: '', NODE_ENV: '' })).toBe('production')
    // `next start` NODE_ENV'i production yapar; APP_ENV yazılmamışsa canlı sayılır
    expect(resolveDeploymentStage({ NODE_ENV: 'production' })).toBe('production')
  })

  it('bilinmeyen bir APP_ENV değeri kapıyı gevşetmez', () => {
    expect(resolveDeploymentStage({ APP_ENV: 'prod' })).toBe('production')
    expect(resolveDeploymentStage({ APP_ENV: 'staging ' })).toBe('staging') // trim
    expect(isDeploymentStage('prod')).toBe(false)
    for (const s of DEPLOYMENT_STAGES) expect(isDeploymentStage(s)).toBe(true)
  })
})

describe('damga okuma', () => {
  it('damga yoksa null döner (hata değil)', async () => {
    await expect(readDeploymentStamp(db)).resolves.toBeNull()
  })

  it('yazılan damga okunur', async () => {
    await stamp('staging', 'hetzner-db-02')
    const row = await readDeploymentStamp(db)
    expect(row?.stage).toBe('staging')
    expect(row?.label).toBe('hetzner-db-02')
    expect(row?.stampedAt).toBeInstanceOf(Date)
  })

  it('ikinci bir damga satırı oluşturulamaz (tek satır kısıtı)', async () => {
    await stamp('staging')
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "DeploymentStamp" ("id", "stage") VALUES ('ikinci', 'production')`,
      ),
    ).rejects.toThrow()
  })

  it('serbest metin bir aşama yazılamaz', async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "DeploymentStamp" ("id", "stage") VALUES ('singleton', 'prod-2')`,
      ),
    ).rejects.toThrow()
  })
})

describe('⭐ ortam ayrımı — staging üretim veritabanına bağlanamaz', () => {
  it('production damgalı DB + staging uygulaması = MISMATCH', async () => {
    await stamp('production')

    const verdict = await verifyDeploymentStamp(db, 'staging')

    expect(verdict.status).toBe('mismatch')
    if (verdict.status !== 'mismatch') throw new Error('unreachable')
    expect(verdict.expected).toBe('staging')
    expect(verdict.found).toBe('production')
  })

  it('uyuşmazlık mesajı CANLI veritabanına bağlanıldığını açıkça söyler', async () => {
    const msg = stampMismatchMessage('staging', 'production')
    expect(msg).toContain('CANLI VERİTABANINA')
    expect(msg).toContain('staging')
  })

  it('⚠️ uyuşmazlık mesajı bağlantı adresi/kimlik bilgisi SIZDIRMAZ', async () => {
    const msg = stampMismatchMessage('staging', 'production')
    expect(msg).not.toMatch(/postgres(ql)?:\/\//)
    expect(msg).not.toContain('@')
    expect(msg).not.toContain(ctx.url)
  })

  it('e2e uygulaması da üretim veritabanına bağlanamaz', async () => {
    await stamp('production')
    expect((await verifyDeploymentStamp(db, 'e2e')).status).toBe('mismatch')
  })

  it('üretim uygulaması staging veritabanına bağlanamaz (ters yön de kapalı)', async () => {
    await stamp('staging')
    const verdict = await verifyDeploymentStamp(db, 'production')
    expect(verdict.status).toBe('mismatch')
    if (verdict.status !== 'mismatch') throw new Error('unreachable')
    expect(verdict.found).toBe('staging')
  })

  it('bölge matrisi: production/staging izole, development ve e2e ortak', async () => {
    for (const own of DEPLOYMENT_STAGES) {
      await stamp(own)
      for (const other of DEPLOYMENT_STAGES) {
        const verdict = await verifyDeploymentStamp(db, other as DeploymentStage)
        const expected = stageRealm(own) === stageRealm(other as DeploymentStage)
        expect(
          verdict.status,
          `damga=${own} aşama=${other}`,
        ).toBe(expected ? 'match' : 'mismatch')
      }
    }
  })

  it('development veritabanı e2e koşusuna açıktır (yerel akış kırılmaz)', async () => {
    await stamp('development')
    expect((await verifyDeploymentStamp(db, 'e2e')).status).toBe('match')
    await stamp('e2e')
    expect((await verifyDeploymentStamp(db, 'development')).status).toBe('match')
  })

  it('⚠️ yerel esneklik canlıya UZANMAZ', async () => {
    await stamp('development')
    expect((await verifyDeploymentStamp(db, 'production')).status).toBe('mismatch')
    await stamp('production')
    expect((await verifyDeploymentStamp(db, 'development')).status).toBe('mismatch')
  })

  it('CHECK kısıtı olmayan bir kopyada tanınmayan damga da uyuşmazlıktır', async () => {
    const broken = {
      $queryRaw: async () => [
        { stage: 'prod', label: null, stampedAt: new Date(), stampedBy: null },
      ],
    }
    expect((await verifyDeploymentStamp(broken, 'production')).status).toBe('mismatch')
  })
})

describe('damgasız / okunamayan veritabanı', () => {
  it('damga yoksa "missing" döner — boot durmaz ama görünür olur', async () => {
    const verdict = await verifyDeploymentStamp(db, 'production')
    expect(verdict.status).toBe('missing')
  })

  it('tablo okunamıyorsa "unreadable" döner ve hata metni TAŞINMAZ', async () => {
    const broken = {
      $queryRaw: async () => {
        const err = new Error('connect ECONNREFUSED postgres://kullanici:parola@10.0.0.5:5432/prod')
        err.name = 'PrismaClientInitializationError'
        throw err
      },
    }

    const verdict = await verifyDeploymentStamp(broken, 'production')
    expect(verdict.status).toBe('unreadable')
    if (verdict.status !== 'unreadable') throw new Error('unreachable')
    // ⚠️ Yalnızca hata TÜRÜ taşınır; bağlantı adresi log'a düşmez.
    expect(verdict.reason).toBe('PrismaClientInitializationError')
    expect(verdict.reason).not.toContain('parola')
    expect(verdict.reason).not.toContain('10.0.0.5')
  })

  it('fırlatmaz — damga kontrolü uygulamayı beklenmedik şekilde çökertemez', async () => {
    const broken = {
      $queryRaw: async () => {
        throw 'string hata'
      },
    }
    await expect(verifyDeploymentStamp(broken, 'production')).resolves.toMatchObject({
      status: 'unreadable',
      reason: 'UnknownError',
    })
  })
})
