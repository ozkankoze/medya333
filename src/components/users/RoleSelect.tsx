'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAdminMutation } from '@/components/admin/admin-client'
import type { UserRole } from '@/lib/enums'

/**
 * ROL DEĞİŞTİRME
 *
 * ⚠️ Buradaki seçenek listesi yalnızca ARAYÜZ kolaylığıdır. Gerçek kapı
 * sunucudadır: `changeUserRole` aktörün seviyesini, hedefin seviyesini,
 * kendi kendine değişikliği ve son SUPERADMIN kuralını ayrıca uygular.
 * Bu listeyi tarayıcıdan değiştirmek hiçbir işe yaramaz.
 */
const ROLE_LABEL: Record<UserRole, string> = {
  CUSTOMER: 'Müşteri',
  SUPPORT: 'Destek',
  OPERATOR: 'Operatör',
  ADMIN: 'Yönetici',
  SUPERADMIN: 'Süper Yönetici',
}

export function RoleSelect({
  userId,
  current,
  options,
  disabled,
  testId,
}: {
  userId: string
  current: UserRole
  /** Aktörün atayabileceği roller — sunucudan gelir */
  options: UserRole[]
  disabled: boolean
  testId: string
}) {
  const m = useAdminMutation()
  const [value, setValue] = useState<UserRole>(current)

  if (disabled) {
    return (
      <span className="text-caption text-ink-500" data-testid={`${testId}-locked`}>
        {ROLE_LABEL[current]}
        <span className="block text-ink-400">değiştirilemez</span>
      </span>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value as UserRole)}
          data-testid={testId}
          aria-label="Rol"
          className="h-9 rounded-[--radius-control] border border-ink-200 bg-white px-2 text-small"
        >
          {/* Mevcut rol listede yoksa (aktör onu atayamıyorsa) yine gösterilir */}
          {(options.includes(current) ? options : [current, ...options]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="secondary"
          disabled={m.busy || value === current}
          data-testid={`${testId}-save`}
          onClick={() =>
            void m.send(`/api/v1/admin/users/${userId}/role`, 'PATCH', { role: value })
          }
        >
          {m.busy ? '…' : 'Kaydet'}
        </Button>
      </div>
      {m.error && (
        <span role="alert" className="text-caption text-danger-700">
          {m.error}
        </span>
      )}
      {m.ok && !m.error && <span className="text-caption text-success-700">Rol güncellendi.</span>}
    </div>
  )
}
