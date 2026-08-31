'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'

/**
 * İŞ KUYRUĞU SATIR İŞLEMLERİ — arşivle / geri al / sil
 *
 * ⚠️⚠️ BURADAKİ KAYITLAR GERÇEK MÜŞTERİ SİPARİŞLERİDİR.
 * Kasa'daki elle tutulan defterle karıştırılmamalı: bunlara ödeme kaydı,
 * iade kaydı, sözleşme onayı ve müşterinin takip linki bağlıdır.
 *
 * ⚠️ İKİ İŞLEM, İKİ FARKLI AĞIRLIK:
 *
 *   ARŞİVLE → kayıt durur, yalnızca kuyruktan kalkar. GERİ ALINABİLİR.
 *             Tek tık, onay yok — geri alınabilir bir işlem için onay
 *             istemek, onayları anlamsızlaştırır.
 *   SİL     → geri alınamaz. Sipariş numarasını YAZDIRARAK onaylatıyoruz.
 *             `window.confirm` yeterli değil: kuyrukta hızla ilerleyen biri
 *             onay kutusunu okumadan kapatır. Numarayı yazmak, doğru satırda
 *             olduğunu fiilen doğrulamayı zorunlu kılar.
 */
export function OrderRowActions({
  orderNo,
  archived,
  deletable,
}: {
  orderNo: string
  archived: boolean
  /**
   * Ödeme/iade kaydı yoksa true. ⚠️ Bu bir GÖRÜNÜM ipucudur, koruma değil:
   * asıl engel API ucunda ve nihayetinde veritabanının RESTRICT kısıtında.
   */
  deletable: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  const btn =
    'rounded-[--radius-control] border border-ink-200 bg-white px-2 py-1 text-caption ' +
    'text-ink-700 hover:bg-ink-50 disabled:opacity-50'

  async function toggleArchive() {
    setBusy(true)
    setError(null)
    const res = await postJson(`/api/v1/admin/orders/${orderNo}/arsiv`, { archived: !archived })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    router.refresh()
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const res = await postJson(`/api/v1/admin/orders/${orderNo}`, undefined, 'DELETE')
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setConfirming(false)
    setTyped('')
    router.refresh()
  }

  if (confirming) {
    return (
      <div className="flex min-w-[15rem] flex-col gap-1.5">
        <p className="text-caption leading-snug text-danger-700">
          Kalıcı olarak silinecek. Onaylamak için <strong>{orderNo}</strong> yazın.
        </p>
        <input
          aria-label="Onay için sipariş numarası"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="rounded-[--radius-control] border border-ink-300 px-2 py-1 font-mono text-caption"
        />
        {error && <p role="alert" className="text-caption text-danger-600">{error}</p>}
        <div className="flex gap-1.5">
          <button
            type="button"
            className={`${btn} border-danger-300 text-danger-700 hover:bg-danger-50`}
            /* ⚠️ Tam eşleşme aranır — büyük/küçük harf farkı bile kabul edilmez. */
            disabled={busy || typed !== orderNo}
            onClick={() => void remove()}
          >
            {busy ? '…' : 'Kalıcı sil'}
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => {
              setConfirming(false)
              setTyped('')
              setError(null)
            }}
          >
            Vazgeç
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={btn} disabled={busy} onClick={() => void toggleArchive()}>
        {busy ? '…' : archived ? 'Geri al' : 'Arşivle'}
      </button>

      {deletable ? (
        <button
          type="button"
          className={`${btn} text-danger-600 hover:bg-danger-50`}
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Sil
        </button>
      ) : (
        /**
         * ⚠️ DÜĞMEYİ GİZLEMEK YERİNE SEBEBİNİ YAZIYORUZ. Gizleseydik
         * kullanıcı silme özelliğinin bozuk olduğunu sanırdı; oysa kural
         * bilinçli ve veritabanı seviyesinde: ödeme kaydı olan sipariş
         * silinemez, para izi yok edilemez.
         */
        <span
          className="text-caption text-ink-400"
          title="Bu siparişin ödeme kaydı var. Ödeme ve iade kayıtları sipariş silinerek yok edilemez — kuyruktan kaldırmak için arşivleyin."
        >
          Ödemeli · silinemez
        </span>
      )}

      {error && <p role="alert" className="w-full text-caption text-danger-600">{error}</p>}
    </div>
  )
}
