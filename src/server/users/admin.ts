import 'server-only'

import type { UserRole } from '@/lib/enums'
import { ROLE_LEVEL, USER_ROLE } from '@/lib/enums'
import { writeAudit } from '@/server/audit'
import { db } from '@/server/db'

/**
 * ⭐ KULLANICI VE ROL YÖNETİMİ (Faz 9)
 *
 * ⚠️ ROLLER DEĞİŞTİRİLMEDİ: CUSTOMER · SUPPORT · OPERATOR · ADMIN · SUPERADMIN.
 * Eklenen tek şey, bu rolleri veritabanına elle girmeden atayabilmek.
 *
 * ⚠️ YETKİ YÜKSELTME (privilege escalation) BEŞ AYRI KURALLA ENGELLENİR:
 *
 *   1. Uç zaten `minimumRole: 'ADMIN'` ister → CUSTOMER hiç giremez.
 *   2. **Kimse kendi rolünü değiştiremez.** Bu tek kural, "ADMIN kendini
 *      SUPERADMIN yapar" senaryosunu tamamen kapatır.
 *   3. ADMIN, **kendi seviyesinden yüksek veya kendine eşit** bir rol ATAYAMAZ.
 *      Yani ADMIN yeni bir ADMIN veya SUPERADMIN üretemez.
 *   4. ADMIN, **kendi seviyesinden yüksek veya kendine eşit** bir kullanıcıyı
 *      DEĞİŞTİREMEZ. Aksi hâlde bir ADMIN diğerini düşürüp tek yetkili olabilirdi.
 *   5. **Son SUPERADMIN düşürülemez.** Sistemde en az bir tam yetkili kalmalı;
 *      aksi hâlde kimse rol atayamaz hâle gelir ve kilitlenme veritabanına
 *      elle müdahale gerektirir.
 *
 * SUPERADMIN 3. ve 4. kuraldan muaftır (tam yetki), 2. ve 5. kurala tabidir.
 */

export class UserAdminError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'UserAdminError'
  }
}

export interface AdminUserRow {
  id: string
  /** ⚠️ MASKELİ. Ham adres yönetim listesinde gösterilmez. */
  emailMasked: string
  name: string | null
  role: UserRole
  isGuest: boolean
  isBlocked: boolean
  orderCount: number
  createdAt: string
  lastLoginAt: string | null
  /** Bu satırın rolü, bakan kişi tarafından değiştirilebilir mi? */
  canEditRole: boolean
}

/** `ornek@site.com` → `or***@site.com` */
function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${address.slice(0, Math.min(2, at))}***@${address.slice(at + 1)}`
}

/** Aktör, hedef kullanıcının rolünü değiştirebilir mi? */
export function canEditRole(
  actor: { id: string; role: UserRole },
  target: { id: string; role: UserRole },
): boolean {
  // Kural 2 — kimse kendini değiştiremez.
  if (actor.id === target.id) return false
  // Kural 4 — ADMIN kendine eşit/üstün kullanıcıya dokunamaz.
  if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.SUPERADMIN) {
    if (ROLE_LEVEL[target.role] >= ROLE_LEVEL[actor.role]) return false
  }
  return ROLE_LEVEL[actor.role] >= ROLE_LEVEL.ADMIN
}

/** Aktörün atayabileceği roller. */
export function assignableRoles(actorRole: UserRole): UserRole[] {
  if (ROLE_LEVEL[actorRole] >= ROLE_LEVEL.SUPERADMIN) return [...USER_ROLE]
  // Kural 3 — ADMIN yalnızca KENDİNDEN DÜŞÜK rol atayabilir.
  return USER_ROLE.filter((r) => ROLE_LEVEL[r] < ROLE_LEVEL[actorRole])
}

export interface ListUsersParams {
  search?: string
  role?: UserRole
  /** Misafir (gölge) kayıtlar varsayılan olarak GİZLİ — sipariş başına bir tane oluşur. */
  includeGuests?: boolean
  cursor?: string
}

const PAGE_SIZE = 50

export async function listUsers(
  params: ListUsersParams,
  viewer: { id: string; role: UserRole },
): Promise<{ items: AdminUserRow[]; nextCursor: string | null; total: number }> {
  const where: Record<string, unknown> = {}
  if (!params.includeGuests) where.isGuest = false
  if (params.role) where.role = params.role
  if (params.search) {
    const q = params.search.trim().slice(0, 80).toLowerCase()
    // ⚠️ Parametreli sorgu — Prisma string birleştirme yapmaz.
    if (q) where.OR = [{ email: { contains: q } }, { name: { contains: q, mode: 'insensitive' } }]
  }

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      // ⚠️ Cursor sayfalama; sıralama tie-breaker ile biter.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isGuest: true,
        isBlocked: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { orders: true } },
      },
    }),
    db.user.count({ where }),
  ])

  const hasExtra = rows.length > PAGE_SIZE
  const page = hasExtra ? rows.slice(0, PAGE_SIZE) : rows

  return {
    items: page.map((u) => ({
      id: u.id,
      // ⚠️ Ham e-posta yönetim listesinde GÖSTERİLMEZ (PII minimizasyonu).
      emailMasked: maskEmail(u.email),
      name: u.name,
      role: u.role as UserRole,
      isGuest: u.isGuest,
      isBlocked: u.isBlocked,
      orderCount: u._count.orders,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      canEditRole: canEditRole(viewer, { id: u.id, role: u.role as UserRole }),
    })),
    nextCursor: hasExtra ? (page[page.length - 1]?.id ?? null) : null,
    total,
  }
}

export interface ChangeRoleInput {
  userId: string
  role: UserRole
  actorId: string
  actorRole: UserRole
  actorIpHash?: string | null
}

export async function changeUserRole(input: ChangeRoleInput): Promise<{
  userId: string
  from: UserRole
  to: UserRole
}> {
  if (!(USER_ROLE as readonly string[]).includes(input.role)) {
    throw new UserAdminError('INVALID_ROLE', 'Geçersiz rol.', 400)
  }

  const target = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, isGuest: true },
  })
  if (!target) throw new UserAdminError('USER_NOT_FOUND', 'Kullanıcı bulunamadı.', 404)

  const from = target.role as UserRole
  const actor = { id: input.actorId, role: input.actorRole }

  // --- Kural 2: kendi rolünü değiştirme --------------------------------------
  if (actor.id === target.id) {
    throw new UserAdminError(
      'SELF_ROLE_CHANGE',
      'Kendi rolünüzü değiştiremezsiniz. Bu işlem için başka bir yönetici gerekir.',
      403,
    )
  }

  // --- Kural 4: hedefin mevcut seviyesi --------------------------------------
  if (!canEditRole(actor, { id: target.id, role: from })) {
    throw new UserAdminError(
      'TARGET_ABOVE_ACTOR',
      'Kendi yetki seviyenizdeki veya üzerindeki bir kullanıcının rolünü değiştiremezsiniz.',
      403,
    )
  }

  // --- Kural 3: atanabilecek roller ------------------------------------------
  if (!assignableRoles(actor.role).includes(input.role)) {
    throw new UserAdminError(
      'ROLE_ABOVE_ACTOR',
      'Kendi yetki seviyenizde veya üzerinde bir rol atayamazsınız.',
      403,
    )
  }

  // --- Misafir gölge kayıt ----------------------------------------------------
  if (target.isGuest) {
    throw new UserAdminError(
      'GUEST_USER',
      'Misafir sipariş kaydına rol atanamaz. Kullanıcının önce hesap açması gerekir.',
      409,
    )
  }

  if (from === input.role) return { userId: target.id, from, to: input.role }

  /**
   * --- Kural 5: SON SUPERADMIN KİLİTLENMESİ --------------------------------
   * ⚠️ Sayım ve güncelleme AYNI transaction içinde, satır kilidiyle yapılır.
   * Aksi hâlde iki eşzamanlı istek "başka SUPERADMIN var" görüp ikisini birden
   * düşürebilir ve sistem yönetilemez hâle gelir.
   */
  await db.$transaction(async (tx) => {
    if (from === 'SUPERADMIN' && input.role !== 'SUPERADMIN') {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "User" WHERE role = 'SUPERADMIN' FOR UPDATE`
      if (rows.length <= 1) {
        throw new UserAdminError(
          'LAST_SUPERADMIN',
          'Sistemdeki son SUPERADMIN düşürülemez. Önce başka bir SUPERADMIN atayın.',
          409,
        )
      }
    }
    await tx.user.update({ where: { id: target.id }, data: { role: input.role } })
  })

  await writeAudit({
    actorId: input.actorId,
    actorIpHash: input.actorIpHash ?? null,
    action: 'user.role_change',
    entityType: 'User',
    entityId: target.id,
    // ⚠️ PII YAZILMAZ: e-posta, ad ve telefon audit payload'ına girmez.
    before: { role: from },
    after: { role: input.role },
  })

  return { userId: target.id, from, to: input.role }
}
