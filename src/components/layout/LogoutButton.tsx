'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Çıkış — oturum satırı SUNUCUDA silinir, yalnızca çerez temizlenmez. */
export function LogoutButton() {
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
      className="rounded-[--radius-control] px-3 py-2 text-ink-600 hover:bg-ink-100 disabled:opacity-50"
    >
      {busy ? 'Çıkılıyor…' : 'Çıkış'}
    </button>
  )
}
