'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * DEFTER ARAÇ ÇUBUĞU — arama, süzgeçler, Excel çıkışı
 *
 * ⚠️ ARAMA VE SÜZGEÇ ADRESTE TAŞINIR (`?q=`, `?f=`). İstemci durumunda
 * tutulsaydı sayfa yenilendiğinde kaybolur, link paylaşılamaz ve geri
 * tuşu beklenmedik davranırdı. Sunucu zaten o ayın satırlarını okuyor;
 * süzme orada yapılır, ikinci bir sorgu açılmaz.
 *
 * ⚠️ EXCEL ÇIKIŞI SUNUCUDA DEĞİL, BURADA ÜRETİLİR. Yeni bir API ucu
 * açmak, kâr ve müşteri verisini taşıyan bir adres daha demekti; ekrandaki
 * satırlar zaten istemcide olduğu için dosyayı tarayıcı yazabilir.
 */

export interface DisaAktarSatiri {
  tarih: string
  musteri: string
  islem: string
  fiyat: string
  maliyet: string
  net: string
  durum: string
  odeme: string
}

const SUZGECLER = [
  { key: '', label: 'Hepsi' },
  { key: 'yeni', label: 'Yeni müşteri' },
  { key: 'odenmedi', label: 'Tahsil edilmemiş' },
  { key: 'gecikmis', label: 'Gecikmiş' },
  { key: 'iptal', label: 'İptaller' },
] as const

export function SiparisAraclari({
  temelHref,
  year,
  month1,
  gun,
  q,
  f,
  satirlar,
  dosyaAdi,
}: {
  temelHref: string
  year: number
  month1: number
  gun: number | null
  q: string
  f: string
  satirlar: readonly DisaAktarSatiri[]
  dosyaAdi: string
}) {
  const router = useRouter()
  const [metin, setMetin] = useState(q)
  const ilk = useRef(true)

  const adres = (yeniQ: string, yeniF: string) => {
    const p = new URLSearchParams()
    p.set('y', String(year))
    p.set('m', String(month1))
    if (gun !== null) p.set('g', String(gun))
    if (yeniQ.trim()) p.set('q', yeniQ.trim())
    if (yeniF) p.set('f', yeniF)
    return `${temelHref}?${p.toString()}`
  }

  /**
   * ⚠️ ARAMA GECİKMELİ (350 ms). Her harfte sunucuya gitmek, üç harflik
   * bir aramada üç sayfa yüklemesi demekti.
   */
  useEffect(() => {
    if (ilk.current) {
      ilk.current = false
      return
    }
    const t = setTimeout(() => {
      if (metin.trim() !== q) router.push(adres(metin, f))
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metin])

  useEffect(() => setMetin(q), [q])

  function indir() {
    const basliklar = ['Tarih', 'Kullanıcı adı', 'İşlem', 'Fiyat', 'Maliyet', 'Net kâr', 'Durum', 'Ödeme']
    const kacir = (d: string) => `"${String(d ?? '').replace(/"/g, '""')}"`
    const satir = (s: DisaAktarSatiri) =>
      [s.tarih, s.musteri, s.islem, s.fiyat, s.maliyet, s.net, s.durum, s.odeme].map(kacir).join(';')
    /**
     * ⚠️ AYIRICI NOKTALI VİRGÜL ve başta BOM.
     * Türkçe Windows'ta Excel, virgülle ayrılmış dosyayı tek sütuna yığar
     * ve BOM olmadan Türkçe harfleri bozuk gösterir. İkisi de dosyayı
     * "çift tıkla açılır" hâle getirmek içindir.
     */
    const icerik = '﻿' + [basliklar.map(kacir).join(';'), ...satirlar.map(satir)].join('\r\n')
    const url = URL.createObjectURL(new Blob([icerik], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${dosyaAdi}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <span className="sr-only">Defterde ara</span>
        <input
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          placeholder="Müşteri ya da işlem ara"
          className="w-56 rounded-[--radius-control] border border-ink-200 bg-white px-3 py-1.5 text-small text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
      </label>

      <div className="flex flex-wrap gap-1">
        {SUZGECLER.map((s) => {
          const aktif = f === s.key
          return (
            <button
              key={s.key || 'hepsi'}
              type="button"
              aria-pressed={aktif}
              onClick={() => router.push(adres(metin, s.key))}
              className={
                'rounded-full px-3 py-1.5 text-caption transition-colors ' +
                (aktif
                  ? 'bg-ink-900 font-semibold text-white'
                  : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50')
              }
            >
              {s.label}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={indir}
        disabled={satirlar.length === 0}
        className="rounded-[--radius-control] border border-ink-200 bg-white px-3 py-1.5 text-caption text-ink-700 hover:bg-ink-50 disabled:opacity-50"
      >
        ⤓ Excel’e aktar
      </button>
    </div>
  )
}
