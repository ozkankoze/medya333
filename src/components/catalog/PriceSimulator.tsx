'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMinor, formatQuantity } from '@/lib/money'

/**
 * FİYAT SİMÜLATÖRÜ
 *
 * ⚠️ Müşterinin göreceği motorun BİREBİR AYNISINI çağırır
 * (`/api/v1/admin/pricing/simulate` → `resolvePrice` → `calculatePrice`).
 * Ayrı bir "admin hesabı" yoktur; olsaydı iki kod yolu arasında sapma
 * oluşabilir ve panelde doğru görünen fiyat müşteride farklı çıkabilirdi.
 */

interface SimResult {
  quantity: number
  ok: boolean
  pricingMode?: string
  packagePrice?: number | null
  unitPrice?: number
  unitLabel?: string
  total?: number
  taxAmount?: number
  subtotal?: number
  code?: string
  error?: string
}

export function PriceSimulator({
  variantId,
  suggested,
}: {
  variantId: string
  suggested: number[]
}) {
  const [input, setInput] = useState(suggested.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SimResult[] | null>(null)

  async function run() {
    const quantities = input
      .split(/[,\s]+/)
      .map((s) => Number(s.replace(/\./g, '')))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 20)

    if (quantities.length === 0) {
      setError('En az bir geçerli miktar girin.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/pricing/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceVariantId: variantId, quantities }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error?.message ?? 'Simülasyon çalıştırılamadı.')
        return
      }
      setResults(json.results as SimResult[])
    } catch {
      setError('Bağlantı kurulamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[--radius-card] border border-ink-200 bg-white">
      <header className="border-b border-ink-200 px-5 py-3">
        <h3 className="text-small font-semibold text-ink-900">Fiyat simülatörü</h3>
        <p className="mt-0.5 text-caption text-ink-500">
          Müşterinin göreceği fiyat motorunun aynısı çalışır.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 px-5 py-4">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="sim-input" className="text-caption text-ink-600">
            Miktarlar (virgülle)
          </label>
          <Input
            id="sim-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mt-1 h-10"
            data-testid="simulator-input"
          />
        </div>
        <Button onClick={run} disabled={busy} data-testid="simulator-run">
          {busy ? 'Hesaplanıyor…' : 'Hesapla'}
        </Button>
      </div>

      {error && <p className="px-5 pb-4 text-caption text-danger-700">{error}</p>}

      {results && (
        <div className="overflow-x-auto border-t border-ink-100">
        <table className="w-full min-w-[30rem] text-small" data-testid="simulator-results">
          <thead>
            <tr className="text-left text-caption text-ink-500">
              <th className="px-5 py-2 font-medium">Miktar</th>
              <th className="px-5 py-2 font-medium">Toplam (KDV dahil)</th>
              <th className="px-5 py-2 font-medium">Matrah</th>
              <th className="px-5 py-2 font-medium">KDV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {results.map((r) => (
              <tr key={r.quantity} data-testid={`sim-${r.quantity}`}>
                <td className="tabular px-5 py-2 text-ink-900">{formatQuantity(r.quantity)}</td>
                {r.ok ? (
                  <>
                    <td className="tabular px-5 py-2 font-medium text-ink-900">
                      {formatMinor(r.total ?? 0)}
                    </td>
                    <td className="tabular px-5 py-2 text-ink-600">{formatMinor(r.subtotal ?? 0)}</td>
                    <td className="tabular px-5 py-2 text-ink-600">
                      {formatMinor(r.taxAmount ?? 0)}
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-5 py-2 text-caption text-danger-700">
                    {r.error}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  )
}
