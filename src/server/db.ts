import 'server-only'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/env'

/**
 * Prisma 7 — Rust engine yok. queryCompiler + pg driver adapter kullanılır.
 * Dev'de HMR sırasında bağlantı sızıntısı olmasın diye global singleton.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * ⭐ SORGU SAYACI — N+1 ÖLÇÜMÜ (Faz 10)
 *
 * "Bu ekranda N+1 yok" bir İDDİADIR. İddiayı teste çevirmenin tek yolu,
 * bir işlemin kaç SQL sorgusu ürettiğini SAYMAKTIR: kayıt sayısını iki
 * katına çıkardığımızda sorgu sayısı da artıyorsa N+1 vardır.
 *
 * ⚠️ VARSAYILAN OLARAK KAPALIDIR. Yalnızca `PRISMA_QUERY_METRICS=1` ile açılır.
 * ⚠️ SORGU METNİ VE PARAMETRELER TUTULMAZ — yalnızca bir sayaç artar.
 *    Sorgu metni müşteri e-postası, hedef hesap ve sipariş numarası içerir;
 *    bunları bir sayaç uğruna belleğe/loga taşımak kabul edilemez.
 */
const QUERY_METRICS_ENABLED = process.env.PRISMA_QUERY_METRICS === '1'

let queryCount = 0

/** Ölçüm penceresini başlatır. */
export function resetQueryCount(): void {
  queryCount = 0
}

/**
 * Ölçüm penceresinde çalışan SQL sorgusu sayısı.
 * Ölçüm kapalıysa `null` döner — 0 döndürmek "hiç sorgu yok" yalanı olurdu.
 */
export function readQueryCount(): number | null {
  return QUERY_METRICS_ENABLED ? queryCount : null
}

function createClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })

  const client = new PrismaClient({
    adapter,
    log: QUERY_METRICS_ENABLED
      ? [{ emit: 'event', level: 'query' }, 'error']
      : env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  })

  if (QUERY_METRICS_ENABLED) {
    // ⚠️ Olayın içeriğine BAKILMAZ; yalnızca sayılır.
    ;(client as unknown as { $on: (e: 'query', cb: () => void) => void }).$on('query', () => {
      queryCount += 1
    })
  }

  return client
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient()

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = db
