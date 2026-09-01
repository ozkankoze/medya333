'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'
import { parseMajorToMinor } from '@/lib/money'

/**
 * ⭐ HESAP BAKİYELERİ — ELLE DÜZELTİLEBİLİR
 *
 * ⚠️⚠️ BAKİYE DOĞRUDAN YAZILMAZ, ÇÜNKÜ SAKLANMIYOR. Bakiye açılış bakiyesi
 * artı bütün hareketlerden HESAPLANIYOR. Buraya yazılan sayı, sunucuda
 * aradaki FARK kadar bir DÜZELTME hareketine dönüşür.
 *
 * Sonuç kullanıcı açısından aynıdır — bakiye istediği sayıya gelir — ama
 * defterde her kuruşun karşılığında hâlâ bir satır kalır. Bu, üç ay sonra
 * "bu 3.000 TL nereden çıktı?" sorusunun cevabının bulunabilmesi demektir.
 *
 * ⚠️ EKRANDA DA YAZILI. Kullanıcı bir hareket oluşacağını bilmeseydi,
 * kasa dökümünde beklemediği bir satır görüp onu hatalı sanabilirdi.
 */
const EDIT_NUMBER = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const minorToInput = (minor: number) => EDIT_NUMBER.format(minor / 100)

/**
 * ⚠️⚠️ FORM ELEMANI OLAYIN SENKRON ANINDA YAKALANIR — TEK YER BURASI.
 *
 * React sentetik olayın `currentTarget` alanını, işleyicinin senkron
 * bölümü bitince temizler. Bu oturumda üç ayrı formda aynı hata bulundu:
 * `await`ten sonra `e.currentTarget.reset()` çağrılıyor, `TypeError`
 * düşüyor ve kullanıcı "bağlantı hatası" görüyordu — kayıt ise aslında
 * oluşmuştu.
 *
 * Bu sarmalayıcı hatayı YAPISAL OLARAK imkânsız kılar: aşağıdaki async
 * işlevler `e`yi hiç görmez, yalnızca hazır bir `HTMLFormElement` alır.
 */
function withForm(fn: (form: HTMLFormElement) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    fn(e.currentTarget)
  }
}

export interface HesapSatiri {
  id: string
  name: string
  owner: string
  balanceMinor: number
}

export function AccountBalances({
  accounts,
  formatted,
}: {
  accounts: readonly HesapSatiri[]
  /** Sunucuda biçimlenmiş bakiyeler — id → "1.500,00 ₺" */
  formatted: Record<string, string>
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const btn =
    'rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1 text-caption ' +
    'text-ink-700 hover:bg-ink-50 disabled:opacity-50'
  const input =
    'w-full rounded-[--radius-control] border border-ink-200 bg-white px-2 py-1 text-small text-ink-900'

  async function duzelt(formEl: HTMLFormElement, accountId: string) {
    const data = new FormData(formEl)
    setError(null)
    setInfo(null)

    let targetMinor: number
    try {
      targetMinor = parseMajorToMinor(String(data.get('hedef') ?? ''))
    } catch {
      setError('Bakiye sayı olmalı (örn. 12.500,00).')
      return
    }

    setBusy(true)
    const res = await postJson('/api/v1/admin/kasa/hesaplar', {
      kind: 'duzelt',
      accountId,
      targetMinor,
      note: String(data.get('note') ?? '') || undefined,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }

    const body = res.data as { changed: boolean; diffMinor: number }
    setInfo(
      body.changed
        ? `Bakiye güncellendi — deftere ${minorToInput(Math.abs(body.diffMinor))} ₺ düzeltme hareketi yazıldı.`
        : 'Bakiye zaten bu değerdeydi; hareket yazılmadı.',
    )
    setEditing(null)
    router.refresh()
  }

  async function hesapEkle(formEl: HTMLFormElement) {
    const data = new FormData(formEl)
    setError(null)
    setInfo(null)

    let openingBalanceMinor: number
    const acilis = String(data.get('acilis') ?? '').trim()
    try {
      openingBalanceMinor = acilis ? parseMajorToMinor(acilis) : 0
    } catch {
      setError('Açılış bakiyesi sayı olmalı.')
      return
    }

    setBusy(true)
    const res = await postJson('/api/v1/admin/kasa/hesaplar', {
      kind: 'ekle',
      owner: data.get('owner'),
      name: data.get('name'),
      openingBalanceMinor,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    formEl.reset()
    setAdding(false)
    setInfo('Hesap eklendi.')
    router.refresh()
  }

  return (
    <div className="overflow-hidden rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
      <table className="w-full border-collapse text-small">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
            <th scope="col" className="px-3 py-2 font-semibold">Hesap</th>
            <th scope="col" className="px-3 py-2 font-semibold">Sahibi</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Bakiye</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">İşlem</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {accounts.map((a) => (
            <tr key={a.id} className="align-middle odd:bg-white even:bg-ink-50">
              <td className="px-3 py-2 font-medium text-ink-900">{a.name}</td>
              <td className="px-3 py-2 text-ink-600">{a.owner}</td>
              <td className="tabular whitespace-nowrap px-3 py-2 text-right font-semibold text-ink-900">
                {formatted[a.id] ?? '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {editing === a.id ? (
                  <form onSubmit={withForm((form) => void duzelt(form, a.id))} className="flex flex-col gap-1.5">
                    <label className="text-left text-caption text-ink-600">
                      Bakiye şu olsun (₺)
                      <input
                        name="hedef"
                        inputMode="decimal"
                        defaultValue={minorToInput(a.balanceMinor)}
                        className={`${input} tabular mt-0.5`}
                      />
                    </label>
                    <label className="text-left text-caption text-ink-600">
                      Sebep (dökümde görünür)
                      <input name="note" maxLength={200} placeholder="banka mutabakatı"
                        className={`${input} mt-0.5`} />
                    </label>
                    <div className="flex gap-1.5">
                      <button type="submit" className={btn} disabled={busy}>
                        {busy ? '…' : 'Kaydet'}
                      </button>
                      <button type="button" className={btn} disabled={busy}
                        onClick={() => { setEditing(null); setError(null) }}>
                        Vazgeç
                      </button>
                    </div>
                    {/* ⚠️ NE OLACAĞI ÖNCEDEN YAZILI — sürpriz hareket olmasın. */}
                    <p className="text-left text-caption leading-snug text-ink-500">
                      Aradaki fark kadar bir <strong>düzeltme hareketi</strong> yazılır.
                    </p>
                  </form>
                ) : (
                  <button type="button" className={btn} onClick={() => setEditing(a.id)}>
                    Bakiyeyi düzelt
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-ink-100 bg-ink-50 px-3 py-2">
        {adding ? (
          <form onSubmit={withForm((form) => void hesapEkle(form))} className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-600">
              Sahibi
              <input name="owner" required maxLength={120} placeholder="Özkan Köse"
                className={`${input} mt-0.5 w-40`} />
            </label>
            <label className="text-caption text-ink-600">
              Hesap adı
              <input name="name" required maxLength={120} placeholder="Shopier"
                className={`${input} mt-0.5 w-40`} />
            </label>
            <label className="text-caption text-ink-600">
              Açılış bakiyesi (₺)
              <input name="acilis" inputMode="decimal" placeholder="0,00"
                className={`${input} tabular mt-0.5 w-32`} />
            </label>
            <button type="submit" className={btn} disabled={busy}>{busy ? '…' : 'Ekle'}</button>
            <button type="button" className={btn} disabled={busy} onClick={() => setAdding(false)}>
              Vazgeç
            </button>
          </form>
        ) : (
          <button type="button" className={btn} onClick={() => setAdding(true)}>
            + Hesap ekle
          </button>
        )}
      </div>

      {error && <p role="alert" className="px-3 py-2 text-caption text-danger-600">{error}</p>}
      {info && <p role="status" className="px-3 py-2 text-caption text-success-700">{info}</p>}
    </div>
  )
}
