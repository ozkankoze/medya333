'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'

/**
 * TAKİPÇİ KONTROL IZGARASI
 *
 * Solda sabit iki sütun (kullanıcı adı, bitiş sayısı), sağda gün sütunları.
 * Her hücre o gün bakılıp bakılmadığını tutar.
 *
 * ⚠️ İŞARET ANINDA GÖRÜNÜR (iyimser güncelleme). Sunucunun cevabını
 * beklemek, elli hesaplık bir listede her tıkta yarım saniyelik bir
 * duraksama demekti; istek başarısız olursa işaret geri alınır ve sebep
 * yazılır.
 *
 * ⚠️ GELECEK GÜN KUTUSU KAPALIDIR. "Yarın baktım" kaydı, listenin tek
 * anlamını ortadan kaldırırdı. Sunucu da aynı kuralı ayrıca uygular —
 * tarayıcıdaki kilit tek başına kural değildir.
 */

export interface IzgaraSatiri {
  id: string
  username: string
  endCount: number
  note: string | null
  isaretliGunler: string[]
  toplamKontrol: number
  /** Sunucunun bildiği son kontrol günü — `2026-10-21`. */
  sonKontrolAnahtar: string | null
  sonKontrolEtiket: string | null
}

export interface IzgaraGunu {
  /** `2026-10-23` */
  anahtar: string
  /** `23.10` */
  etiket: string
  /** `Cum` */
  gunAdi: string
  bugun: boolean
  gelecek: boolean
}

export function TakipciIzgara({
  gunler,
  satirlar,
  arsiv,
}: {
  gunler: readonly IzgaraGunu[]
  satirlar: readonly IzgaraSatiri[]
  arsiv: boolean
}) {
  const router = useRouter()
  const [isaretler, setIsaretler] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {}
    for (const s of satirlar) m[s.id] = new Set(s.isaretliGunler)
    return m
  })
  const [hata, setHata] = useState<string | null>(null)
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null)

  const pencereKumesi = new Set(gunler.map((g) => g.anahtar))
  const tarihBicim = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  /**
   * "Son kontrol" ve sayaç, işaret konur konmaz güncellenir.
   *
   * ⚠️ SUNUCUYU BEKLEMEZ ama UYDURMAZ: penceredeki işaretler istemcide
   * bilindiği için sayı tam hesaplanır (sunucu toplamı eksi penceredeki
   * eski işaretler artı şimdiki işaretler). Pencere dışında kalan eski bir
   * kontrol varsa ve pencerede hiç işaret kalmadıysa, sunucunun bildiği
   * etiket gösterilmeye devam eder.
   */
  const ozet = (s: IzgaraSatiri, kume: Set<string>) => {
    const toplam = s.toplamKontrol - s.isaretliGunler.length + kume.size
    const enYeni = [...kume].sort().pop()
    if (enYeni) {
      return { toplam, etiket: tarihBicim.format(new Date(`${enYeni}T00:00:00.000Z`)) }
    }
    const sunucuPencereDisinda =
      s.sonKontrolAnahtar && !pencereKumesi.has(s.sonKontrolAnahtar) ? s.sonKontrolEtiket : null
    return { toplam, etiket: sunucuPencereDisinda }
  }

  async function cevir(satirId: string, gun: string, suAnIsaretli: boolean) {
    setHata(null)
    const yeni = !suAnIsaretli
    setIsaretler((o) => {
      const k = new Set(o[satirId] ?? [])
      if (yeni) k.add(gun)
      else k.delete(gun)
      return { ...o, [satirId]: k }
    })

    const res = await postJson(`/api/v1/admin/kasa/takipci/${satirId}/kontrol`, {
      gun,
      isaretli: yeni,
    })

    if (!res.ok) {
      // ⚠️ GERİ ALMA ŞART. Yarım kalmış bir işaret, "baktım" sanılan ama
      //    kaydedilmemiş bir gün demektir.
      setIsaretler((o) => {
        const k = new Set(o[satirId] ?? [])
        if (yeni) k.delete(gun)
        else k.add(gun)
        return { ...o, [satirId]: k }
      })
      setHata(res.message)
    }
  }

  if (satirlar.length === 0) {
    return (
      <div className="rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-8 text-center">
        <p className="text-body text-ink-700">
          {arsiv ? 'Arşivde kayıt yok.' : 'Takip listesi boş.'}
        </p>
        {!arsiv && (
          <p className="mt-1 text-small text-ink-500">
            Yukarıdaki formdan kullanıcı adı ve bitiş sayısı girerek ekle.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {hata && (
        <p role="alert" className="text-small text-danger-600">
          {hata}
        </p>
      )}

      <div className="overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
        <table className="w-full border-collapse text-small">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50 text-caption uppercase tracking-wide text-ink-500">
              {/* ⚠️ İLK İKİ SÜTUN YAPIŞKAN: on dört gün sağa kaydırılırken
                  hangi hesaba baktığın kaybolmamalı. */}
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[11rem] bg-ink-50 px-3 py-2 text-left font-semibold"
              >
                Kullanıcı adı
              </th>
              <th scope="col" className="min-w-[6.5rem] px-3 py-2 text-right font-semibold">
                Bitiş sayısı
              </th>
              {gunler.map((g) => (
                <th
                  key={g.anahtar}
                  scope="col"
                  className={
                    'w-12 px-1 py-2 text-center font-semibold ' +
                    (g.bugun ? 'bg-brand-100 text-brand-700' : '')
                  }
                >
                  <span className="tabular block leading-tight">{g.etiket}</span>
                  <span className="block text-[10px] font-normal normal-case">{g.gunAdi}</span>
                </th>
              ))}
              <th scope="col" className="min-w-[7rem] px-3 py-2 text-left font-semibold">
                Son kontrol
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                İşlem
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-ink-100">
            {satirlar.map((s) => {
              const kume = isaretler[s.id] ?? new Set<string>()
              const o = ozet(s, kume)
              return (
                <tr key={s.id} className="odd:bg-white even:bg-ink-50">
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium text-ink-900">
                    <span className="block truncate" title={s.username}>
                      {s.username}
                    </span>
                    {s.note && (
                      <span className="block truncate text-caption text-ink-500" title={s.note}>
                        {s.note}
                      </span>
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-900">
                    {s.endCount.toLocaleString('tr-TR')}
                  </td>

                  {gunler.map((g) => {
                    const isaretli = kume.has(g.anahtar)
                    return (
                      <td
                        key={g.anahtar}
                        className={'px-1 py-2 text-center ' + (g.bugun ? 'bg-brand-50' : '')}
                      >
                        <label className="inline-flex cursor-pointer items-center justify-center p-1">
                          <span className="sr-only">
                            {s.username} · {g.etiket} kontrolü
                          </span>
                          <input
                            type="checkbox"
                            checked={isaretli}
                            disabled={g.gelecek}
                            onChange={() => cevir(s.id, g.anahtar, isaretli)}
                            className="size-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-30"
                          />
                        </label>
                      </td>
                    )
                  })}

                  <td className="whitespace-nowrap px-3 py-2 text-caption text-ink-600">
                    {o.etiket ?? <span className="text-ink-400">hiç bakılmadı</span>}
                    <span className="block text-ink-400">{o.toplam} kez</span>
                  </td>

                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setDuzenlenen(duzenlenen === s.id ? null : s.id)}
                      className="rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1 text-caption text-ink-700 hover:bg-ink-50"
                    >
                      {duzenlenen === s.id ? 'Kapat' : 'Düzenle'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {duzenlenen && (
        <SatirDuzenle
          satir={satirlar.find((s) => s.id === duzenlenen)!}
          arsiv={arsiv}
          kapat={() => setDuzenlenen(null)}
          bitti={() => {
            setDuzenlenen(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Satır düzenleme kutusu.
 *
 * ⚠️ ARŞİVLEME SİLMEDEN ÖNCE SUNULUR ve düğmesi daha görünürdür: işi biten
 * bir hesabı silmek, o hesaba kaç gün bakıldığını da siler.
 */
function SatirDuzenle({
  satir,
  arsiv,
  kapat,
  bitti,
}: {
  satir: IzgaraSatiri
  arsiv: boolean
  kapat: () => void
  bitti: () => void
}) {
  const [username, setUsername] = useState(satir.username)
  const [endCount, setEndCount] = useState(String(satir.endCount))
  const [note, setNote] = useState(satir.note ?? '')
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  const alan =
    'rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-900 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

  async function gonder(govde: Record<string, unknown>) {
    setBusy(true)
    setHata(null)
    const res = await postJson(`/api/v1/admin/kasa/takipci/${satir.id}`, govde)
    setBusy(false)
    if (!res.ok) {
      setHata(res.message)
      return
    }
    bitti()
  }

  async function sil() {
    if (!window.confirm(`${satir.username} satırı ve bütün kontrol geçmişi silinsin mi?`)) return
    setBusy(true)
    setHata(null)
    const res = await fetch(`/api/v1/admin/kasa/takipci/${satir.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      setHata('Satır silinemedi.')
      return
    }
    bitti()
  }

  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-4 shadow-[--shadow-card]">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink-600">Kullanıcı adı</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={alan} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink-600">Bitiş sayısı</span>
          <input
            value={endCount}
            inputMode="numeric"
            onChange={(e) => setEndCount(e.target.value)}
            className={`${alan} tabular w-32`}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-caption font-medium text-ink-600">Not</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={alan} />
        </label>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const sayi = Number(endCount.replace(/[^\d]/g, ''))
            if (!Number.isInteger(sayi)) {
              setHata('Bitiş sayısı rakam olmalı.')
              return
            }
            gonder({ username, endCount: sayi, note: note || null })
          }}
          className="rounded-[--radius-control] bg-ink-900 px-3 py-2 text-small font-semibold text-white disabled:opacity-50"
        >
          Kaydet
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => gonder({ isArchived: !arsiv })}
          className="rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-700 hover:bg-ink-50 disabled:opacity-50"
        >
          {arsiv ? 'Listeye geri al' : 'Arşivle'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={sil}
          className="rounded-[--radius-control] border border-danger-100 bg-white px-3 py-2 text-small text-danger-600 hover:bg-danger-100/40 disabled:opacity-50"
        >
          Sil
        </button>
        <button
          type="button"
          onClick={kapat}
          className="text-small text-ink-500 underline-offset-2 hover:underline"
        >
          Vazgeç
        </button>
      </div>
      {hata && (
        <p role="alert" className="mt-2 text-small text-danger-600">
          {hata}
        </p>
      )}
    </div>
  )
}
