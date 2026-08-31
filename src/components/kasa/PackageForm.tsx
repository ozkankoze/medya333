'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatMinor, parseMajorToMinor } from '@/lib/money'

/**
 * AYLIK PAKET GİRİŞ FORMU
 *
 * ⚠️ NET KÂR YAZILMAZ, HESAPLANIR. Kullanıcı satış ve maliyeti girer;
 * kâr anında türetilir. Ayrı bir alan olsaydı üçü birbiriyle çelişebilirdi.
 *
 * ⚠️ BU FORM KASAYA DOKUNMAZ. Kaydetmek banka bakiyesini DEĞİŞTİRMEZ;
 * paket bir satış sözüdür, para henüz gelmemiştir. Gelir hareketi ancak
 * listedeki "Tahsil et" işlemiyle oluşur. Bu, ekranda da yazılıdır —
 * kullanıcının bakiyenin neden artmadığını merak etmemesi için.
 */
export function PackageForm() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [sale, setSale] = useState('')
  const [cost, setCost] = useState('')

  /** Canlı net kâr önizlemesi — girdiler bozuksa gösterilmez. */
  let netPreview: string | null = null
  try {
    if (sale.trim()) {
      const s = parseMajorToMinor(sale)
      const c = cost.trim() ? parseMajorToMinor(cost) : 0
      netPreview = formatMinor(s - c)
    }
  } catch {
    netPreview = null
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setOk(false)
    const form = new FormData(e.currentTarget)

    let salePriceMinor: number
    let costMinor: number
    try {
      salePriceMinor = parseMajorToMinor(String(form.get('sale') ?? ''))
      const c = String(form.get('cost') ?? '').trim()
      costMinor = c ? parseMajorToMinor(c) : 0
    } catch {
      setError('Tutarları sayı olarak girin (örn. 15.000,00).')
      return
    }
    if (salePriceMinor < 0 || costMinor < 0) {
      setError('Tutarlar negatif olamaz.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/v1/admin/kasa/paketler', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerName: form.get('customerName'),
          serviceName: form.get('serviceName'),
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          salePriceMinor,
          costMinor,
          note: String(form.get('note') ?? '').trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(body?.error?.message ?? 'Paket eklenemedi.')
        return
      }
      e.currentTarget.reset()
      setSale('')
      setCost('')
      setOk(true)
      router.refresh()
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-900 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
  const label = 'block text-caption font-medium text-ink-600'
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card]"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label} htmlFor="p-customer">Müşteri adı</label>
          <input id="p-customer" name="customerName" required maxLength={200}
            placeholder="X Firma" className={`${field} mt-1`} />
        </div>
        <div>
          <label className={label} htmlFor="p-service">Paket / hizmet adı</label>
          <input id="p-service" name="serviceName" required maxLength={200}
            placeholder="Sosyal Medya Yönetimi" className={`${field} mt-1`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="p-start">Başlangıç</label>
            <input id="p-start" name="startDate" type="date" required defaultValue={today}
              className={`${field} mt-1`} />
          </div>
          <div>
            <label className={label} htmlFor="p-end">Bitiş</label>
            <input id="p-end" name="endDate" type="date" required className={`${field} mt-1`} />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="p-sale">Satış ücreti (₺)</label>
          <input id="p-sale" name="sale" inputMode="decimal" required placeholder="15.000,00"
            value={sale} onChange={(ev) => setSale(ev.target.value)}
            className={`${field} mt-1 tabular`} />
        </div>
        <div>
          <label className={label} htmlFor="p-cost">Maliyet (₺)</label>
          <input id="p-cost" name="cost" inputMode="decimal" placeholder="4.000,00"
            value={cost} onChange={(ev) => setCost(ev.target.value)}
            className={`${field} mt-1 tabular`} />
        </div>
        <div>
          <span className={label}>Net kâr</span>
          {/* ⚠️ Girilmez, hesaplanır. */}
          <p className="tabular mt-1 rounded-[--radius-control] border border-dashed border-ink-300 bg-ink-50 px-3 py-2 text-small font-semibold text-ink-900">
            {netPreview ?? '—'}
          </p>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label} htmlFor="p-note">Not</label>
          <input id="p-note" name="note" maxLength={1000} className={`${field} mt-1`} />
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-small text-danger-600">{error}</p>}
      {ok && !error && <p role="status" className="mt-4 text-small text-success-700">Paket eklendi.</p>}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="submit" loading={busy} disabled={busy}>Paketi Kaydet</Button>
        <p className="text-caption text-ink-500">
          Kaydetmek banka bakiyesini <strong>değiştirmez</strong>. Para geldiğinde listeden
          “Tahsil et” deyin.
        </p>
      </div>
    </form>
  )
}
