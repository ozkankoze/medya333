'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMinor, formatQuantity } from '@/lib/money'
import type { PricingMode } from '@/lib/enums'

/**
 * FİYAT KADEMESİ DÜZENLEYİCİ
 *
 * ⚠️ Fiyatlar KDV DAHİL kuruş cinsinden saklanır. Arayüz TL girişi alır ve
 * yalnızca gösterim için çevirir; sunucuya her zaman tam sayı kuruş gider.
 * `1349,90` → `134990`. Kayan noktalı aritmetik yapılmaz: metin ayrıştırılır.
 *
 * ⚠️ PACKAGE modunda birim fiyat YOKTUR — `packagePriceMinor` sabit toplamdır.
 */

export interface EditableRule {
  id: string
  mode: PricingMode
  minQuantity: number
  maxQuantity: number | null
  unitPriceMinor: number
  packagePriceMinor: number | null
  setupFeeMinor: number
  isActive: boolean
}

/** "1.349,90" / "1349,90" / "1349.90" → 134990 kuruş. Yuvarlama hatası yok. */
export function parseLiraToMinor(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole = '0', frac = ''] = cleaned.split('.')
  const kurus = (frac + '00').slice(0, 2)
  return Number(whole) * 100 + Number(kurus)
}

function minorToLira(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',')
}

export function PricingEditor({
  variantId,
  rules,
  canWrite,
  unitLabel,
}: {
  variantId: string
  rules: EditableRule[]
  canWrite: boolean
  unitLabel: string
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rules.map((r) => [
        r.id,
        minorToLira(r.mode === 'PACKAGE' ? (r.packagePriceMinor ?? 0) : r.unitPriceMinor),
      ]),
    ),
  )

  async function save(rule: EditableRule) {
    const minor = parseLiraToMinor(drafts[rule.id] ?? '')
    if (minor === null || minor <= 0) {
      setError('Fiyat "1349,90" biçiminde ve sıfırdan büyük olmalıdır.')
      return
    }
    setBusyId(rule.id)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/pricing-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          rule.mode === 'PACKAGE' ? { packagePriceMinor: minor } : { unitPriceMinor: minor },
        ),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error?.message ?? 'Fiyat kaydedilemedi.')
        return
      }
      router.refresh()
    } catch {
      setError('Bağlantı kurulamadı.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="rounded-[--radius-card] border border-ink-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-5 py-3">
        <h3 className="text-small font-semibold text-ink-900">Fiyatlar</h3>
        <span className="text-caption text-ink-500">
          Tüm fiyatlar <strong>KDV DAHİL</strong> müşteri satış fiyatıdır.
        </span>
      </header>

      {error && (
        <p className="border-b border-danger-600/20 bg-danger-100 px-5 py-2 text-caption text-danger-700">
          {error}
        </p>
      )}

      {/* Dar ekranda tablo taşmasın diye yatay kaydırma; hücreler kırpılmaz. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-small">
        <thead>
          <tr className="border-b border-ink-100 text-left text-caption text-ink-500">
            <th className="px-5 py-2 font-medium">Miktar</th>
            <th className="px-5 py-2 font-medium">Model</th>
            <th className="px-5 py-2 font-medium">Fiyat (₺)</th>
            <th className="px-5 py-2 font-medium">Kayıtlı</th>
            {canWrite && <th className="px-5 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rules.map((rule) => {
            const stored = rule.mode === 'PACKAGE' ? (rule.packagePriceMinor ?? 0) : rule.unitPriceMinor
            return (
              <tr key={rule.id} data-testid={`rule-${rule.minQuantity}`} className={rule.isActive ? '' : 'opacity-50'}>
                <td className="tabular px-5 py-2.5 text-ink-900">
                  {formatQuantity(rule.minQuantity)}
                  {rule.maxQuantity !== null && rule.maxQuantity !== rule.minQuantity
                    ? `–${formatQuantity(rule.maxQuantity)}`
                    : ''}{' '}
                  <span className="text-caption text-ink-500">{unitLabel}</span>
                </td>
                <td className="px-5 py-2.5 text-caption text-ink-600">
                  {rule.mode === 'PACKAGE' ? 'Sabit paket' : rule.mode}
                </td>
                <td className="px-5 py-2.5">
                  {canWrite ? (
                    <Input
                      value={drafts[rule.id] ?? ''}
                      onChange={(e) => setDrafts({ ...drafts, [rule.id]: e.target.value })}
                      className="tabular h-9 w-32 text-right"
                      inputMode="decimal"
                      data-testid={`price-input-${rule.minQuantity}`}
                      aria-label={`${rule.minQuantity} için fiyat`}
                    />
                  ) : (
                    <span className="tabular">{minorToLira(stored)}</span>
                  )}
                </td>
                <td
                  className="tabular px-5 py-2.5 text-ink-700"
                  data-testid={`stored-price-${rule.minQuantity}`}
                >
                  {formatMinor(stored)}
                </td>
                {canWrite && (
                  <td className="px-5 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === rule.id}
                      onClick={() => save(rule)}
                      data-testid={`save-price-${rule.minQuantity}`}
                    >
                      {busyId === rule.id ? '…' : 'Kaydet'}
                    </Button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </section>
  )
}
