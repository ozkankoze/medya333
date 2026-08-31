'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * PAKET SATIRI İŞLEMLERİ — tahsil et / maliyeti işle / iptal
 *
 * ⚠️ "TAHSİL ET" BANKA BAKİYESİNİ ARTIRAN TEK YERDİR. Paket oluşturmak
 * kasaya dokunmaz; para gerçekten geldiğinde bu düğme kullanılır ve
 * seçilen hesaba gelir hareketi yazılır.
 *
 * ⚠️ HESAP SEÇİMİ ZORUNLUDUR ve varsayılan atanmaz. "İlk hesabı seç" gibi
 * bir kolaylık, paranın yanlış bankaya yazılmasına yol açar ve bu hata
 * ancak mutabakatta fark edilir.
 *
 * ⚠️ İPTAL ONAY İSTER. `window.confirm` bilinçli: geri alınamayan bir
 * işlem için tek tıkla gitmek fazla kolay olurdu. (Kayıt silinmez, ama
 * iptal de kendi başına geri alınamaz bir karardır.)
 */
export function PackageActions({
  id,
  accounts,
  canCollect,
  canRecordCost,
  canCancel,
}: {
  id: string
  accounts: Array<{ id: string; label: string }>
  canCollect: boolean
  canRecordCost: boolean
  canCancel: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState<null | 'tahsil' | 'maliyet'>(null)
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(b?.error?.message ?? 'İşlem başarısız.')
        return false
      }
      setOpen(null)
      setAccountId('')
      router.refresh()
      return true
    } catch {
      setError('Bağlantı hatası.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const btn =
    'rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1.5 text-caption ' +
    'text-ink-700 hover:bg-ink-50 disabled:opacity-50'

  if (open) {
    const today = new Date().toISOString().slice(0, 10)
    return (
      <div className="flex min-w-[16rem] flex-col gap-2">
        <select
          aria-label="Hesap"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-[--radius-control] border border-ink-200 bg-white px-2 py-1.5 text-caption"
        >
          {/* ⚠️ Boş varsayılan bilinçli — yanlış hesaba yazma riski. */}
          <option value="">Hesap seçin…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        {error && <p role="alert" className="text-caption text-danger-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            className={btn}
            disabled={busy || !accountId}
            onClick={() =>
              post(`/api/v1/admin/kasa/paketler/${id}/${open}`, {
                accountId,
                occurredAt: today,
              })
            }
          >
            {busy ? '…' : open === 'tahsil' ? 'Tahsil et' : 'Gideri işle'}
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => { setOpen(null); setError(null) }}>
            Vazgeç
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {canCollect && (
        <button type="button" className={btn} onClick={() => setOpen('tahsil')}>
          Tahsil et
        </button>
      )}
      {canRecordCost && (
        <button type="button" className={btn} onClick={() => setOpen('maliyet')} title="Maliyeti gerçek kasa çıkışına dönüştür">
          Gideri işle
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => {
            if (!window.confirm('Paket iptal edilsin mi? Kayıt silinmez, iptal olarak işaretlenir.')) return
            void post(`/api/v1/admin/kasa/paketler/${id}/iptal`)
          }}
        >
          İptal
        </button>
      )}
      {error && <p role="alert" className="w-full text-caption text-danger-600">{error}</p>}
    </div>
  )
}
