'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Çıkış — oturum satırı SUNUCUDA silinir, yalnızca çerez temizlenmez.
 *
 * ⚠️ `onDark`: düğme hem koyu başlıkta hem açık sayfa gövdesinde kullanılıyor.
 * Tek bir renk vermek, ikisinden birinde okunmaz bir metin bırakıyordu.
 */
export function LogoutButton({ onDark = false }: { onDark?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await fetch('/api/v1/auth/logout', { method: 'POST' })
        } finally {
          setBusy(false)
          router.push('/')
          router.refresh()
        }
      }}
      className={
        'w-full rounded-[--radius-control] px-3 py-2 text-left text-small font-medium disabled:opacity-50 sm:w-auto sm:text-center ' +
        (onDark
          ? 'text-white/70 hover:bg-white/10 hover:text-white'
          : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900')
      }
    >
      {busy ? 'Çıkılıyor…' : 'Çıkış'}
    </button>
  )
}
