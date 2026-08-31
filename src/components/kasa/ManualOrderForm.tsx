'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ORDER_STATUSES, ORDER_STATUS_LABEL } from '@/lib/kasa/orders'
import { formatMinor, parseMajorToMinor } from '@/lib/money'

/**
 * SİPARİŞ GİRİŞ FORMU (elle defter)
 *
 * ⚠️ NET KÂR YAZILMAZ, HESAPLANIR. Kullanıcı tutar ve maliyeti girer; kâr
 * anında türetilir. Ayrı bir alan olsaydı üçü birbiriyle çelişebilirdi.
 *
 * ⚠️ ÖDEME DURUMU BU FORMDA YOKTUR ve bilinçli olarak yoktur. Buradan
 * "ödendi" seçilebilseydi, kasaya hiçbir hareket yazılmadan sipariş
 * "tahsil edildi" görünürdü — yani bakiye ile defter ayrışırdı. Ödeme,
 * listedeki "Tahsil et" işlemiyle ve bir hesap seçilerek yapılır.
 *
 * ⚠️ BU FORM KASAYA DOKUNMAZ. Kaydetmek banka bakiyesini DEĞİŞTİRMEZ.
 * Bu, ekranda da yazılıdır — kullanıcının bakiyenin neden artmadığını
 * merak etmemesi için.
 */
export function ManualOrderForm() {
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
    const form = e.currentTarget
    const data = new FormData(form)

    let salePriceMinor: number
    let costMinor: number
    try {
      salePriceMinor = parseMajorToMinor(String(data.get('sale') ?? ''))
      const c = String(data.get('cost') ?? '').trim()
      costMinor = c ? parseMajorToMinor(c) : 0
    } catch {
      setError('Tutarları sayı olarak girin (örn. 1.250,00).')
      return
    }
    if (salePriceMinor < 0 || costMinor < 0) {
      setError('Tutarlar negatif olamaz.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/v1/admin/kasa/siparisler', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerName: data.get('customerName'),
          occurredAt: data.get('occurredAt'),
          salePriceMinor,
          costMinor,
          status: data.get('status'),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(body?.error?.message ?? 'Sipariş eklenemedi.')
        return
      }
      form.reset()
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
          <label className={label} htmlFor="o-customer">Kullanıcı adı</label>
          <input id="o-customer" name="customerName" required maxLength={200}
            placeholder="@kullaniciadi" className={`${field} mt-1`} />
        </div>
        <div>
          <label className={label} htmlFor="o-date">Tarih</label>
          <input id="o-date" name="occurredAt" type="date" required defaultValue={today}
            className={`${field} mt-1`} />
        </div>
        <div>
          <label className={label} htmlFor="o-status">Sipariş durumu</label>
          <select id="o-status" name="status" defaultValue="BEKLIYOR" className={`${field} mt-1`}>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="o-sale">Sipariş tutarı (₺)</label>
          <input id="o-sale" name="sale" inputMode="decimal" required placeholder="1.250,00"
            value={sale} onChange={(ev) => setSale(ev.target.value)}
            className={`${field} mt-1 tabular`} />
        </div>
        <div>
          <label className={label} htmlFor="o-cost">Maliyet (₺)</label>
          <input id="o-cost" name="cost" inputMode="decimal" placeholder="400,00"
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
      </div>

      {error && <p role="alert" className="mt-4 text-small text-danger-600">{error}</p>}
      {ok && !error && (
        <p role="status" className="mt-4 text-small text-success-700">Sipariş eklendi.</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="submit" loading={busy} disabled={busy}>Siparişi Kaydet</Button>
        <p className="text-caption text-ink-500">
          Kaydetmek banka bakiyesini <strong>değiştirmez</strong>. Para geldiğinde listeden
          “Tahsil et” deyin.
        </p>
      </div>
    </form>
  )
}
