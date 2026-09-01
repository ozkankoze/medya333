'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'
import { parseMajorToMinor } from '@/lib/money'

/**
 * ⚠️ DÜZENLEME KUTUSUNA PARA BİRİMİ SEMBOLÜ YAZILMAZ.
 *
 * İlk hâli `formatMinor()` çıktısından "₺" işaretini regex ile siliyordu.
 * O çıktı sembolden önce KIRILMAZ BOŞLUK (U+00A0) kullanıyor; kırpma
 * kuralının bunu yakalaması tesadüfe bağlıydı ve sembol kutuya sızsaydı
 * `parseMajorToMinor` girdiyi reddedip kullanıcıya "sayı olmalı" derdi —
 * hiç dokunmadığı bir alan yüzünden.
 *
 * Biçimi doğrudan üretmek bu bağı tamamen koparır.
 */
const EDIT_NUMBER = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const minorToInput = (minor: number) => EDIT_NUMBER.format(minor / 100)

/**
 * ⭐ SATIR İÇİ DÜZENLEME — panelin dört kayıt türü için TEK bileşen
 *
 * Kasa hareketi, aylık paket, elle sipariş ve alacak/borç kayıtlarının
 * hepsi aynı düzenleme davranışına ihtiyaç duyuyor. Dört ayrı bileşen
 * yazmak, birinde yapılan düzeltmenin diğer üçünde unutulmasıyla biterdi —
 * bu oturumda üç formda birden bulunan `currentTarget` hatası tam olarak
 * öyle çoğalmıştı.
 *
 * ⚠️⚠️ DONMUŞ ALAN GİZLENMEZ, KİLİTLİ GÖSTERİLİR VE SEBEBİ YAZILIR.
 *
 * Kasaya hareket yazılmış bir kaydın tutarı değiştirilemez (bkz.
 * `src/server/kasa/edit.ts`). Alanı ekrandan kaldırmak kullanıcıya
 * "düzenleme bozuk" hissi verirdi; kilitli gösterip sebebini yazmak kuralı
 * öğretir. Donmuş alan istekte HİÇ GÖNDERİLMEZ, böylece sunucu tarafında
 * gereksiz bir ret üretmez.
 *
 * ⚠️ PARA ALANLARI KURUŞA BURADA ÇEVRİLİR. Sunucu yalnızca tam sayı kuruş
 * kabul eder; "1.500,00" gibi bir metni sunucuya yollamak kayan nokta
 * yuvarlamasına kapı açardı.
 */

export type EditField =
  | {
      kind: 'text'
      name: string
      label: string
      value: string
      required?: boolean
      placeholder?: string
      /** Doluysa alan kilitlenir ve bu metin sebep olarak gösterilir. */
      frozen?: string
    }
  | {
      kind: 'date'
      name: string
      label: string
      /** ISO gün — "2026-08-31" */
      value: string
      required?: boolean
      frozen?: string
    }
  | {
      kind: 'money'
      name: string
      label: string
      /** Kuruş cinsinden mevcut değer. */
      valueMinor: number | null
      required?: boolean
      frozen?: string
    }
  | {
      kind: 'select'
      name: string
      label: string
      value: string
      options: ReadonlyArray<{ value: string; label: string }>
      frozen?: string
    }

export function InlineEdit({
  endpoint,
  method = 'PATCH',
  extra,
  fields,
  remove,
  label = 'Düzenle',
}: {
  endpoint: string
  method?: 'PATCH' | 'POST'
  /** İstekle birlikte her zaman gönderilen sabit alanlar (örn. `kind`). */
  extra?: Record<string, unknown>
  fields: readonly EditField[]
  /**
   * Silme desteği — yoksa düğme çıkmaz.
   *
   * ⚠️ "ENGELLİ" DURUMU KALDIRILDI. Eskiden `blocked` verilince yerinde
   * "🔒 silinemez" yazıyordu. Kural değişti: kasaya bağlı hareketler de
   * silinebiliyor, silinince kaynak kayıt "tahsil edilmedi" durumuna
   * dönüyor. Alanı burada bırakmak, bir gün yeniden kullanılıp kullanıcıya
   * artık doğru olmayan bir "silinemez" göstermesine kapı açardı.
   */
  remove?: { endpoint: string; body?: Record<string, unknown>; confirm: string }
  label?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const btn =
    'rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1 text-caption ' +
    'text-ink-700 hover:bg-ink-50 disabled:opacity-50'

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // ⚠️ Form elemanı `await`ten ÖNCE yakalanır — React sentetik olayın
    //    `currentTarget`ini senkron bölüm bitince temizler.
    const formEl = e.currentTarget
    const data = new FormData(formEl)
    setError(null)

    const payload: Record<string, unknown> = { ...extra }
    for (const f of fields) {
      // ⚠️ Donmuş alan hiç gönderilmez.
      if (f.frozen) continue
      const raw = String(data.get(f.name) ?? '')
      if (f.kind === 'money') {
        const t = raw.trim()
        if (!t) {
          if (f.required) {
            setError(`${f.label} boş bırakılamaz.`)
            return
          }
          payload[f.name] = null
          continue
        }
        try {
          payload[f.name] = parseMajorToMinor(t)
        } catch {
          setError(`${f.label} sayı olmalı (örn. 1.500,00).`)
          return
        }
      } else {
        const t = raw.trim()
        // ⚠️ `select` alanında `required` yoktur — açılır listede zaten
        //    bir değer seçilidir, boş kalması mümkün değildir.
        if (!t && f.kind !== 'select' && f.required) {
          setError(`${f.label} boş bırakılamaz.`)
          return
        }
        payload[f.name] = t || (f.kind === 'text' ? null : t)
      }
    }

    setBusy(true)
    const res = await postJson(endpoint, payload, method)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setOpen(false)
    router.refresh()
  }

  async function doRemove() {
    if (!remove) return
    if (!window.confirm(remove.confirm)) return
    setBusy(true)
    setError(null)
    const res = await postJson(remove.endpoint, remove.body, 'DELETE')
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
      <button type="button" className={btn} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  const input =
    'w-full rounded-[--radius-control] border border-ink-200 bg-white px-2 py-1 text-caption ' +
    'text-ink-900 disabled:bg-ink-100 disabled:text-ink-500'

  return (
    <form onSubmit={submit} className="flex min-w-[22rem] flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="block">
            <span className="block text-caption font-medium text-ink-600">{f.label}</span>

            {f.kind === 'select' ? (
              <select
                name={f.name}
                defaultValue={f.value}
                disabled={Boolean(f.frozen)}
                className={`${input} mt-0.5`}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                type={f.kind === 'date' ? 'date' : 'text'}
                inputMode={f.kind === 'money' ? 'decimal' : undefined}
                defaultValue={
                  f.kind === 'money'
                    ? f.valueMinor == null
                      ? ''
                      : minorToInput(f.valueMinor)
                    : f.value
                }
                placeholder={f.kind === 'text' ? f.placeholder : undefined}
                disabled={Boolean(f.frozen)}
                className={`${input} mt-0.5 ${f.kind === 'money' ? 'tabular' : ''}`}
              />
            )}

            {/* ⚠️ Kilidin SEBEBİ yazılır — alan gizlenmez. */}
            {f.frozen && (
              <span className="mt-0.5 block text-caption leading-snug text-warning-700">
                🔒 {f.frozen}
              </span>
            )}
          </label>
        ))}
      </div>

      {error && <p role="alert" className="text-caption text-danger-600">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        <button type="submit" className={btn} disabled={busy}>
          {busy ? '…' : 'Kaydet'}
        </button>
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => { setOpen(false); setError(null) }}
        >
          Vazgeç
        </button>
        {remove && (
          <button
            type="button"
            className={`${btn} text-danger-600 hover:bg-danger-50`}
            disabled={busy}
            onClick={() => void doRemove()}
          >
            Sil
          </button>
        )}
      </div>
    </form>
  )
}
