import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ROLE_LEVEL, USER_ROLE, type UserRole } from '@/lib/enums'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth'
import { db } from '@/server/db'
import { assignableRoles, listUsers } from '@/server/users/admin'
import { RoleSelect } from '@/components/users/RoleSelect'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Kullanıcılar',
  robots: { index: false, follow: false },
}

const ROLE_LABEL: Record<UserRole, string> = {
  CUSTOMER: 'Müşteri',
  SUPPORT: 'Destek',
  OPERATOR: 'Operatör',
  ADMIN: 'Yönetici',
  SUPERADMIN: 'Süper Yönetici',
}

/**
 * /yonetim/kullanicilar — ROL YÖNETİMİ (Faz 9)
 *
 * ⚠️ SAYFA SEVİYESİNDE ADMIN+ KAPISI. Layout SUPPORT'a kadar açıktır; bu
 * ekran ayrıca kontrol eder. Asıl kapı yine API ucundadır — sayfa gizlemek
 * yetki mekanizması değildir.
 *
 * ⚠️ E-posta adresleri MASKELİ gösterilir. Rol atamak için tam adres gerekli
 * değildir; gerekli olan kişiyi ayırt edebilmektir.
 */
export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; guests?: string; cursor?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/yonetim/giris?next=/yonetim/kullanicilar')
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL.ADMIN) redirect('/yonetim/fulfillment')

  const sp = await searchParams
  const roleFilter = (USER_ROLE as readonly string[]).includes(sp.role ?? '')
    ? (sp.role as UserRole)
    : undefined

  const [data, superAdminCount] = await Promise.all([
    listUsers(
      {
        ...(sp.q ? { search: sp.q } : {}),
        ...(roleFilter ? { role: roleFilter } : {}),
        ...(sp.guests === '1' ? { includeGuests: true } : {}),
        ...(sp.cursor ? { cursor: sp.cursor } : {}),
      },
      { id: user.id, role: user.role },
    ),
    db.user.count({ where: { role: 'SUPERADMIN' } }),
  ])

  const options = assignableRoles(user.role)

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-4">
        <h2 className="text-h3 text-ink-900">Kullanıcılar ve roller</h2>
        <ul className="mt-2 flex flex-col gap-1 text-caption leading-relaxed text-ink-600">
          <li>• Kendi rolünüzü değiştiremezsiniz — bu işlem başka bir yönetici gerektirir.</li>
          <li>
            • Rolünüz <strong>{ROLE_LABEL[user.role]}</strong>: yalnızca{' '}
            {options.map((r) => ROLE_LABEL[r]).join(', ') || '—'} atayabilirsiniz.
          </li>
          <li>
            • Sistemde <strong>{superAdminCount}</strong> süper yönetici var. Sonuncusu
            düşürülemez.
          </li>
          <li>• Her rol değişikliği denetim kaydına yazılır.</li>
        </ul>
      </div>

      {/* ------------------------------- Filtreler ---------------------------- */}
      <form action="/yonetim/kullanicilar" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-ink-600">Ara</span>
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="e-posta veya ad"
            data-testid="user-search"
            className="h-10 w-60 rounded-[--radius-control] border border-ink-200 px-3 text-small"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-ink-600">Rol</span>
          <select
            name="role"
            defaultValue={roleFilter ?? ''}
            className="h-10 rounded-[--radius-control] border border-ink-200 bg-white px-2 text-small"
          >
            <option value="">Tümü</option>
            {USER_ROLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 rounded-[--radius-control] border border-ink-200 px-3 text-small text-ink-700">
          <input type="checkbox" name="guests" value="1" defaultChecked={sp.guests === '1'} className="size-4" />
          Misafir kayıtları da göster
        </label>
        <button
          type="submit"
          className="h-10 rounded-[--radius-control] bg-brand-600 px-4 text-small font-medium text-white hover:bg-brand-700"
        >
          Filtrele
        </button>
      </form>

      {/* --------------------------------- Liste ------------------------------ */}
      {data.items.length === 0 ? (
        <div className="rounded-[--radius-card] border border-dashed border-ink-200 bg-white p-12 text-center">
          <p className="text-body text-ink-700">Eşleşen kullanıcı yok.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
          <table className="w-full min-w-[52rem] text-small">
            <thead className="border-b border-ink-200 text-left text-caption text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Kullanıcı</th>
                <th className="px-4 py-3 font-medium">Mevcut rol</th>
                <th className="px-4 py-3 font-medium text-right">Sipariş</th>
                <th className="px-4 py-3 font-medium">Kayıt</th>
                <th className="px-4 py-3 font-medium">Rol değiştir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {data.items.map((u) => (
                <tr key={u.id} data-testid="user-row" className="hover:bg-ink-50">
                  <td className="px-4 py-3">
                    {/* ⚠️ MASKELİ ADRES — tam e-posta gösterilmez. */}
                    <span className="font-mono text-caption text-ink-800">{u.emailMasked}</span>
                    {u.name && <span className="block text-caption text-ink-500">{u.name}</span>}
                    {u.isGuest && (
                      <span className="mt-0.5 inline-block rounded-full bg-ink-100 px-2 text-caption text-ink-600">
                        misafir kaydı
                      </span>
                    )}
                    {u.isBlocked && (
                      <span className="mt-0.5 inline-block rounded-full bg-danger-100 px-2 text-caption text-danger-700">
                        engelli
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-caption font-medium',
                        ROLE_LEVEL[u.role] >= ROLE_LEVEL.ADMIN
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-ink-100 text-ink-700',
                      )}
                      data-testid={`role-badge-${u.id}`}
                    >
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="tabular px-4 py-3 text-right text-ink-800">{u.orderCount}</td>
                  <td className="px-4 py-3 text-caption text-ink-500">
                    {new Date(u.createdAt).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-4 py-3">
                    <RoleSelect
                      userId={u.id}
                      current={u.role}
                      options={options}
                      disabled={!u.canEditRole || u.isGuest}
                      testId={`role-select-${u.id}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-ink-500" data-testid="user-summary">
          {data.total} kullanıcı
        </p>
        {data.nextCursor && (
          <Link
            href={`/yonetim/kullanicilar?cursor=${data.nextCursor}${sp.q ? `&q=${sp.q}` : ''}`}
            className="rounded-[--radius-control] border border-ink-200 px-4 py-2 text-small text-ink-700 hover:bg-ink-50"
          >
            Sonraki →
          </Link>
        )}
      </div>
    </div>
  )
}
