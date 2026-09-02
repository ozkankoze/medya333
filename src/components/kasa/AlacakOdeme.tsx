'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'
import { odemeCozumle, type HesapSecenegi } from '@/lib/kasa/odeme-alani'

/**
 * ⭐ ANA SAYFADAKİ ALACAK SATIRINDA "ÖDEME ALINDI"
 *
 * ⚠️ SEBEP: alacak listesi salt okunurdu. Müşteri parayı yatırdığında
 * kullanıcı bu ekranda hiçbir şey yapamıyor, Siparişler sayfasına gidip
 * satırı bulmak zorunda kalıyordu. Alacağın görüldüğü yer ile kapatıldığı
 * yer aynı olmalı; olmayınca kayıt ertelenir ve liste gerçeği göstermez.
 *
 * ⚠️⚠️ KUTU SİPARİŞ DEFTERİNDEKİYLE AYNI DİLİ KONUŞUR:
 *     "yapıkredi"   → para geldi, o hesaba gelir yazılır, bakiye ARTAR
 *     "12.09.2026"  → beklenen tarih değişir, kasaya hiçbir şey yazılmaz
 * İki ekranda iki farklı kural olsaydı, hangisinin ne yaptığı ezberlenmek
 * zorunda kalırdı.
 *
 * ⚠️ İKİ KAYNAK, İKİ UÇ — ama tek arayüz:
 *   sipariş → ham metin sunucuya gider, ORADA çözülür (tek doğruluk kaynağı)
 *   alacak  → aynı saf işlevle burada çözülür, sonra ilgili uca gider
 *   Alacak ucu serbest metin kabul etmiyor; hesap kimliği bekliyor.
 */

/**
 * ⚠️ Form elemanı olayın senkron anında yakalanır — `await`ten sonra
 * `currentTarget` boşalır ve bu proje o hatayı bir kez "Bağlantı hatası"
 * diye görmüştü.
 */
function withForm(fn: (form: HTMLFormElement) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    fn(e.currentTarget)
  }
}

export function AlacakOdeme({
  source,
  id,
  hesaplar,
}: {
  source: 'siparis' | 'alacak'
  id: string
  hesaplar: readonly HesapSecenegi[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function kaydet(formEl: HTMLFormElement) {
    const value = String(new FormData(formEl).get('odeme') ?? '').trim()
    setError(null)
    if (!value) {
      setError('Hesap adı ya da tarih yaz.')
      return
    }

    setBusy(true)
    let res
    if (source === 'siparis') {
      // ⚠️ Ham metin sunucuya gider; çözümleme orada yapılır.
      res = await postJson(`/api/v1/admin/kasa/siparisler/${id}/odeme`, { odeme: value })
    } else {
      const girdi = odemeCozumle(value, hesaplar)
      if (girdi.kind === 'gecersiz') {
        setBusy(false)
        setError(girdi.message)
        return
      }
      if (girdi.kind === 'bos') {
        setBusy(false)
        setError('Hesap adı ya da tarih yaz.')
        return
      }
      res =
        girdi.kind === 'hesap'
          ? await postJson(`/api/v1/admin/kasa/alacaklar/${id}/tahsil`, {
              accountId: girdi.accountId,
              occurredAt: new Date().toISOString().slice(0, 10),
            })
          : await postJson(
              `/api/v1/admin/kasa/alacaklar/${id}`,
              { kind: 'alacak', dueDate: girdi.date.toISOString().slice(0, 10) },
              'PATCH',
            )
    }
    setBusy(false)

    if (!res.ok) {
      setError(res.message)
      return
    }
    setOpen(false)
    router.refresh()
  }

  const btn =
    'rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1 text-caption ' +
    'text-ink-700 hover:bg-ink-50 disabled:opacity-50'

  if (!open) {
    return (
      <button type="button" className={btn} onClick={() => setOpen(true)}>
        Ödeme alındı
      </button>
    )
  }

  return (
    <form onSubmit={withForm((form) => void kaydet(form))} className="flex min-w-[12rem] flex-col gap-1">
      <input
        name="odeme"
        autoFocus
        maxLength={60}
        placeholder="Yapıkredi / 12.09.2026"
        className="w-full rounded-[--radius-control] border border-ink-300 bg-white px-2 py-1 text-caption text-ink-900"
      />
      <div className="flex gap-1">
        <button type="submit" className={btn} disabled={busy}>{busy ? '…' : 'Kaydet'}</button>
        <button type="button" className={btn} disabled={busy}
          onClick={() => { setOpen(false); setError(null) }}>
          Vazgeç
        </button>
      </div>
      {/* ⚠️ HESAP ADLARI GÖZ ÖNÜNDE — ezberden yazılması beklenseydi
          yanlış yazımlar sürekli "anlaşılmadı" hatası üretirdi. */}
      <p className="text-left text-caption leading-snug text-ink-500">
        Hesap → gelir yazılır ({hesaplar.map((h) => h.name).join(', ') || 'hesap yok'}) · Tarih →
        vade değişir
      </p>
      {error && <p role="alert" className="text-left text-caption text-danger-600">{error}</p>}
    </form>
  )
}
