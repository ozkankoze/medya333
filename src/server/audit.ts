import 'server-only'

import { db } from './db'

/**
 * DENETİM KAYDI
 *
 * Her admin YAZMA işlemi buraya düşer: kim, ne zaman, hangi kaydı,
 * eski değer → yeni değer.
 *
 * Audit yazımı ASLA asıl işlemi düşürmez — hata durumunda loglanır ve geçilir.
 * (Denetim kaydı tutulamadı diye kullanıcının işlemi başarısız olmamalı.)
 */

export interface AuditInput {
  actorId?: string | null
  actorIpHash?: string | null
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
}

/** Denetim kaydına asla sızmaması gereken alanlar. */
const REDACTED_KEYS = new Set([
  'passwordHash',
  'twoFactorSecret',
  'accessTokenHash',
  'idempotencyKey',
  'rawInitPayload',
  'rawResultPayload',
  'access_token',
  'refresh_token',
  'id_token',
])

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(sanitize)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? '[REDACTED]' : sanitize(v)
    }
    return out
  }
  return value
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorIpHash: input.actorIpHash ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before === undefined ? undefined : (sanitize(input.before) as never),
        after: input.after === undefined ? undefined : (sanitize(input.after) as never),
      },
    })
  } catch (err) {
    console.error('[audit] kayıt yazılamadı:', (err as Error).message, input.action)
  }
}
