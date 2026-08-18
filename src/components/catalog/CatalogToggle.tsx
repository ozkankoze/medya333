'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * AKTİF / PASİF ANAHTARI
 *
 * ⚠️ Pasifleştirme SİLME DEĞİLDİR. Kayıt yerinde kalır; geçmiş siparişler,
 * ödemeler ve fulfillment kayıtları bozulmaz. Pasif kayıt yalnızca:
 *   • public katalogda görünmez
 *   • yeni siparişte seçilemez
 */
export function CatalogToggle({
  kind,
  id,
  isActive,
  label,
}: {
  kind: 'platforms' | 'services' | 'variants'
  id: string
  isActive: boolean
  label: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/${kind}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error?.message ?? 'İşlem tamamlanamadı.')
        return
      }
      router.refresh()
    } catch {
      setError('Bağlantı kurulamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-caption text-danger-700">{error}</span>}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={toggle}
        data-testid={`toggle-${kind}-${id}`}
        aria-label={`${label} ${isActive ? 'pasifleştir' : 'aktifleştir'}`}
      >
        {busy ? '…' : isActive ? 'Pasifleştir' : 'Aktifleştir'}
      </Button>
    </div>
  )
}
