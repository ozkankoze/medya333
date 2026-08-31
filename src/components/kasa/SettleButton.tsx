'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'

/**
 * ALACAK TAHSİLİ / BORÇ ÖDEMESİ
 *
 * ⚠️⚠️ BAKİYEYİ DEĞİŞTİREN TEK YER BURASIDIR. Alacak veya borç kaydı açmak
 * kasaya dokunmaz; para gerçekten hareket ettiğinde bu düğme kullanılır ve
 * seçilen hesaba gerçek hareket yazılır.
 *
 * ⚠️ HESAP SEÇİMİ ZORUNLUDUR ve varsayılan atanmaz. "İlk hesabı seç" gibi
 * bir kolaylık, paranın yanlış bankaya yazılmasına yol açar ve bu hata
 * ancak mutabakatta fark edilir.
 *
 * ⚠️ TUTAR DÜĞMEDE YAZAR. Kısmi tahsilat/ödeme yoktur: yazılan tutar HER
 * ZAMAN kaydın tamamıdır. Rakamı göstermek, kullanıcının kısmi işlem
 * yapabildiğini sanmasını önler.
 */
export function SettleButton({
  id,
  kind,
  amountLabel,
  accounts,
}: {
  id: string
  /** 'alacak' → tahsil et (giriş) · 'borc' → öde (çıkış) */
  kind: 'alacak' | 'borc'
  amountLabel: string
  accounts: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const btn =
    'rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1 text-caption ' +
    'text-ink-700 hover:bg-ink-50 disabled:opacity-50'

  async function submit() {
    setBusy(true)
    setError(null)
    const path =
      kind === 'alacak'
        ? `/api/v1/admin/kasa/alacaklar/${id}/tahsil`
        : `/api/v1/admin/kasa/borclar/${id}/ode`
    const res = await postJson(path, {
      accountId,
      occurredAt: new Date().toISOString().slice(0, 10),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setOpen(false)
    setAccountId('')
    router.refresh()
  }

  if (!open) {
    return (
      <button type="button" className={btn} onClick={() => setOpen(true)}>
        {kind === 'alacak' ? 'Tahsil et' : 'Öde'}
      </button>
    )
  }

  return (
    <div className="flex min-w-[14rem] flex-col gap-1.5">
      <select
        aria-label="Hesap"
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="rounded-[--radius-control] border border-ink-200 bg-white px-2 py-1 text-caption"
      >
        {/* ⚠️ Boş varsayılan bilinçli — yanlış hesaba yazma riski. */}
        <option value="">Hesap seçin…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
      {error && <p role="alert" className="text-caption text-danger-600">{error}</p>}
      <div className="flex gap-1.5">
        <button type="button" className={btn} disabled={busy || !accountId} onClick={() => void submit()}>
          {busy ? '…' : `${amountLabel} ${kind === 'alacak' ? 'tahsil et' : 'öde'}`}
        </button>
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => { setOpen(false); setError(null) }}
        >
          Vazgeç
        </button>
      </div>
    </div>
  )
}
