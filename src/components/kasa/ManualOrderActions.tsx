'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ORDER_STATUSES, ORDER_STATUS_LABEL, type ManualOrderStatus } from '@/lib/kasa/orders'

/**
 * SİPARİŞ SATIRI İŞLEMLERİ — durum / tahsil et / gideri işle / sil
 *
 * ⚠️ "TAHSİL ET" BANKA BAKİYESİNİ ARTIRAN TEK YERDİR. Sipariş girmek
 * kasaya dokunmaz; para gerçekten geldiğinde bu düğme kullanılır ve
 * seçilen hesaba gelir hareketi yazılır.
 *
 * ⚠️ HESAP SEÇİMİ ZORUNLUDUR ve varsayılan atanmaz. "İlk hesabı seç" gibi
 * bir kolaylık, paranın yanlış bankaya yazılmasına yol açar ve bu hata
 * ancak mutabakatta fark edilir.
 *
 * ⚠️ DURUM DEĞİŞİKLİĞİ ANINDA KAYDEDİLİR (ayrı bir "kaydet" yok). Tek
 * alanlı bir değişiklik için onay adımı koymak, günde onlarca satır giren
 * biri için gereksiz sürtünmedir — ve durum geri alınabilir bir bilgidir,
 * silme gibi kalıcı değildir.
 */
export function ManualOrderActions({
  id,
  accounts,
  status,
  saleLabel,
  costLabel,
  isPaid,
  canRecordCost,
  canDelete,
}: {
  id: string
  accounts: Array<{ id: string; label: string }>
  status: ManualOrderStatus
  /** Tahsil edilecek TAM tutar — düğmede gösterilir. */
  saleLabel: string
  costLabel: string
  isPaid: boolean
  canRecordCost: boolean
  /** Kasaya hareket yazılmışsa false — asıl engel veritabanındadır. */
  canDelete: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState<null | 'tahsil' | 'maliyet'>(null)
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(path: string, body?: unknown, method: 'POST' | 'DELETE' = 'POST') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
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
              send(`/api/v1/admin/kasa/siparisler/${id}/${open}`, {
                accountId,
                occurredAt: today,
              })
            }
          >
            {/* ⚠️ KISMİ ÖDEME YOK: tahsil edilen tutar HER ZAMAN siparişin
                tam bedelidir. Tutarı düğmeye yazmak, kullanıcının kısmi
                tahsilat yapabildiğini sanmasını önler. */}
            {busy ? '…' : open === 'tahsil' ? `${saleLabel} tahsil et` : `${costLabel} gider yaz`}
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => { setOpen(null); setError(null) }}
          >
            Vazgeç
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label="Sipariş durumu"
        value={status}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.value as ManualOrderStatus
          void send(`/api/v1/admin/kasa/siparisler/${id}/durum`, { status: next })
        }}
        className="rounded-[--radius-control] border border-ink-200 bg-white px-2 py-1.5 text-caption text-ink-700"
      >
        {ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
        ))}
      </select>

      {!isPaid && status !== 'IPTAL' && (
        <button type="button" className={btn} onClick={() => setOpen('tahsil')}>
          Tahsil et
        </button>
      )}
      {canRecordCost && (
        <button
          type="button"
          className={btn}
          onClick={() => setOpen('maliyet')}
          title="Maliyeti gerçek kasa çıkışına dönüştür"
        >
          Gideri işle
        </button>
      )}

      {canDelete ? (
        <button
          type="button"
          className={`${btn} text-danger-600 hover:bg-danger-50`}
          disabled={busy}
          onClick={() => {
            // ⚠️ Silme geri alınamaz ve satır tamamen gider. Tek tıkla
            //    gitmesi, günde onlarca satır giren biri için fazla kolay
            //    olurdu.
            if (!window.confirm('Bu sipariş kaydı tamamen silinsin mi? Geri alınamaz.')) return
            void send(`/api/v1/admin/kasa/siparisler/${id}`, undefined, 'DELETE')
          }}
        >
          Sil
        </button>
      ) : (
        /**
         * ⚠️ DÜĞMEYİ GİZLEMEK YERİNE SEBEBİNİ YAZIYORUZ. Gizleseydik
         * kullanıcı silme özelliğinin bozuk olduğunu sanırdı; oysa kural
         * bilinçli: kasaya hareket yazılmış bir siparişi silmek o parayı
         * öksüz bırakır.
         */
        <span
          className="text-caption text-ink-400"
          title="Bu siparişten kasaya gelir veya gider hareketi yazılmış. Silmek, o parayı hangi işe ait olduğu bilinmeyen bir hareket hâline getirirdi."
        >
          Kasaya işlendi · silinemez
        </span>
      )}

      {error && <p role="alert" className="w-full text-caption text-danger-600">{error}</p>}
    </div>
  )
}
