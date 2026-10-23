'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'

/**
 * TAKİP LİSTESİNE SATIR EKLEME
 *
 * ⚠️ TEK SATIRLIK FORM, BİLİNÇLİ. Takip satırı günde birkaç kez ve hızlıca
 * girilir; alan sayısı arttıkça giriş yavaşlar. Zorunlu olan yalnızca iki
 * alandır: kullanıcı adı ve bitiş sayısı.
 *
 * ⚠️ BİTİŞ SAYISI ADETTİR. Para alanı değildir, kuruşa çevrilmez;
 * "10.000" yazılırsa noktalar temizlenip 10000 gönderilir.
 */
export function TakipciEkle() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [endCount, setEndCount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const alan =
    'rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-900 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

  async function gonder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setHata(null)
    setOk(false)

    const sayi = Number(endCount.replace(/[^\d]/g, ''))
    if (!username.trim()) {
      setHata('Kullanıcı adı gerekli.')
      return
    }
    if (!Number.isInteger(sayi) || sayi < 0) {
      setHata('Bitiş sayısı rakam olmalı.')
      return
    }

    setBusy(true)
    const res = await postJson('/api/v1/admin/kasa/takipci', {
      username: username.trim(),
      endCount: sayi,
      note: note.trim() || null,
    })
    setBusy(false)

    if (!res.ok) {
      setHata(res.message)
      return
    }
    setUsername('')
    setEndCount('')
    setNote('')
    setOk(true)
    router.refresh()
  }

  return (
    <form
      onSubmit={gonder}
      className="rounded-[--radius-card] border border-ink-200 bg-white p-4 shadow-[--shadow-card]"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink-600">Kullanıcı adı</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@kullaniciadi"
            maxLength={120}
            className={`${alan} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink-600">Bitiş sayısı</span>
          <input
            value={endCount}
            onChange={(e) => setEndCount(e.target.value)}
            inputMode="numeric"
            placeholder="10.000"
            className={`${alan} tabular w-36`}
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-caption font-medium text-ink-600">Not (isteğe bağlı)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="hangi paket, hangi müşteri"
            maxLength={300}
            className={alan}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-[--radius-control] bg-ink-900 px-4 py-2 text-small font-semibold text-white disabled:opacity-50"
        >
          Listeye ekle
        </button>
      </div>

      {hata && (
        <p role="alert" className="mt-3 text-small text-danger-600">
          {hata}
        </p>
      )}
      {ok && !hata && (
        <p role="status" className="mt-3 text-small text-success-700">
          Eklendi.
        </p>
      )}
    </form>
  )
}
