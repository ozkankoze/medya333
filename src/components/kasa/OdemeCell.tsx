'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'

/**
 * ⭐ SİPARİŞ SATIRINDAKİ "ÖDEME" HÜCRESİ — tabloya yazar gibi
 *
 * ⚠️⚠️ TEK KUTU, İKİ ANLAM:
 *     "12.09.2026" → para BEKLENİYOR. Kasaya hiçbir hareket yazılmaz;
 *                    satır panelin ana sayfasında ALACAK olarak görünür.
 *     "yapıkredi"  → para GELDİ. O hesaba gelir hareketi yazılır ve
 *                    BANKA BAKİYESİ ARTAR.
 *
 * ⚠️ TAHSİL EDİLMİŞ SATIRDA KUTU YOKTUR, sabit metin vardır. Kutu açık
 * kalsaydı ikinci kez hesap adı yazmak mümkün görünürdü; sunucu bunu
 * reddeder ama kullanıcı neden reddedildiğini anlamazdı. Tahsilatı geri
 * almak kasa dökümünden, hareketin kendisi silinerek yapılır — orada ne
 * olduğu görünür.
 */
export function OdemeCell({
  orderId,
  paidLabel,
  dueLabel,
  hesapAdlari,
}: {
  orderId: string
  /** Tahsil edilmişse "Yapıkredi · 12.09.26" gibi; değilse null. */
  paidLabel: string | null
  /** Beklenen tarih varsa "12.09.26"; yoksa null. */
  dueLabel: string | null
  /** Kutunun altında ipucu olarak gösterilecek hesap adları. */
  hesapAdlari: readonly string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (paidLabel) {
    return <span className="whitespace-nowrap text-success-700">{paidLabel}</span>
  }

  async function kaydet(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // ⚠️ Form elemanı `await`ten ÖNCE yakalanır.
    const formEl = e.currentTarget
    const value = String(new FormData(formEl).get('odeme') ?? '')
    setError(null)
    setBusy(true)
    const res = await postJson(`/api/v1/admin/kasa/siparisler/${orderId}/odeme`, { odeme: value })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[--radius-control] border border-dashed border-ink-300 px-2 py-1 text-left text-caption text-ink-600 hover:border-ink-400 hover:bg-ink-50"
        title="Tarih ya da hesap adı yaz"
      >
        {dueLabel ? (
          <>
            {/* ⚠️ Bekleyen tarih AÇIKÇA "bekliyor" der. Yalnızca tarih
                yazsaydı, tahsil tarihiyle karıştırılabilirdi. */}
            <span className="tabular text-ink-700">{dueLabel}</span>
            <span className="ml-1 text-ink-500">bekliyor</span>
          </>
        ) : (
          <span className="text-ink-400">yaz…</span>
        )}
      </button>
    )
  }

  return (
    <form onSubmit={kaydet} className="flex min-w-[11rem] flex-col gap-1">
      <input
        name="odeme"
        autoFocus
        maxLength={60}
        defaultValue={dueLabel ?? ''}
        placeholder="12.09.2026 / Yapıkredi"
        className="w-full rounded-[--radius-control] border border-ink-300 bg-white px-2 py-1 text-caption text-ink-900"
      />
      <div className="flex gap-1">
        <button type="submit" disabled={busy}
          className="rounded-[--radius-control] border border-ink-200 bg-white px-2 py-0.5 text-caption text-ink-700 hover:bg-ink-50 disabled:opacity-50">
          {busy ? '…' : 'Kaydet'}
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(null) }}
          className="rounded-[--radius-control] border border-ink-200 bg-white px-2 py-0.5 text-caption text-ink-700 hover:bg-ink-50 disabled:opacity-50">
          Vazgeç
        </button>
      </div>
      {/* ⚠️ HESAP ADLARI GÖZ ÖNÜNDE. Ezberden yazılması beklenseydi, yanlış
          yazımlar sürekli "anlaşılmadı" hatası üretirdi. */}
      <p className="text-caption leading-snug text-ink-500">
        Tarih → alacak · Hesap → gelir ({hesapAdlari.join(', ') || 'hesap yok'})
      </p>
      {error && <p role="alert" className="text-caption text-danger-600">{error}</p>}
    </form>
  )
}
