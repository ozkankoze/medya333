import 'server-only'

import { ROLE_LEVEL, type UserRole } from '@/lib/enums'
import { auth } from './config'
import { AuthError } from './errors'

/**
 * YETKİLENDİRME KAPILARI
 *
 * Üç katman vardır (Mimari §11):
 *   1. middleware.ts   — kaba rota koruması
 *   2. requireUser/requireRole — burası
 *   3. Servis katmanında SAHİPLİK — `where: { id, userId }`
 *
 * ⚠️ IDOR KURALI: Hiçbir yerde önce `findUnique({ where: { id } })` yapıp
 * sonra JS'te sahiplik kontrol edilmez. Kullanıcı kapsamı SORGUNUN İÇİNDE olur.
 */

export { AuthError }

export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: UserRole
  isGuest: boolean
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth()
  if (!session?.user?.id || !session.user.email) return null
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    role: session.user.role,
    isGuest: session.user.isGuest,
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new AuthError('UNAUTHENTICATED', 'Bu işlem için giriş yapmalısınız.')
  if (user.isGuest) throw new AuthError('FORBIDDEN', 'Misafir hesapla bu işlem yapılamaz.')
  return user
}

/** Rol hiyerarşisi: SUPERADMIN > ADMIN > OPERATOR > SUPPORT > CUSTOMER */
export async function requireRole(minimum: UserRole): Promise<SessionUser> {
  const user = await requireUser()
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL[minimum]) {
    throw new AuthError('FORBIDDEN', 'Bu işlem için yetkiniz yok.')
  }
  return user
}

export const requireStaff = () => requireRole('SUPPORT')
export const requireOperator = () => requireRole('OPERATOR')
export const requireAdmin = () => requireRole('ADMIN')
export const requireSuperAdmin = () => requireRole('SUPERADMIN')

export function hasRole(user: { role: UserRole } | null, minimum: UserRole): boolean {
  return !!user && ROLE_LEVEL[user.role] >= ROLE_LEVEL[minimum]
}
