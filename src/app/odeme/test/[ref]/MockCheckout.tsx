'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Money } from '@/components/primitives/Money'

/**
 * Mock sağlayıcının ödeme ekranı.
 *
 * "Ödemeyi tamamla" düğmesi, gerçek bir sağlayıcının yapacağı gibi
 * SUNUCUDAN SUNUCUYA imzalı bildirim gönderilmesini tetikler
 * (POST /api/v1/payments/test/notify → webhook ucu).
 *
 * ⚠️ Bu ekran hiçbir şeyi PAID yapmaz; yalnızca bildirimi tetikler.
 * Sonucu webhook işleyicisi belirler ve sonuç sayfası sunucudan okur.
 */
export function MockCheckout({
  providerRef,
  orderNo,
  amountMinor,
  currency,
  expired,
}: {
  providerRef: string
  orderNo: string
  amountMinor: number
  currency: string
  expired: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'success' | 'failure' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function complete(outcome: 'success' | 'failure') {
    setBusy(outcome)
    setError(null)
    try {
      const res = await fetch('/api/v1/payments/test/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerRef, outcome }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error?.message ?? 'Bildirim gönderilemedi.')
        setBusy(null)
        return
      }
      router.push(`/odeme/sonuc/${orderNo}${outcome === 'failure' ? '?durum=basarisiz' : ''}`)
    } catch {
      setError('Bağlantı kurulamadı.')
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-[--radius-card] border-2 border-dashed border-ink-300 bg-white p-7">
        <p className="inline-flex items-center gap-2 rounded-full bg-warning-100 px-3 py-1 text-caption font-medium text-warning-700">
          TEST ORTAMI
        </p>
        <h1 className="mt-4 text-h3 text-ink-900">Test ödeme sayfası</h1>
        <p className="mt-2 text-small leading-relaxed text-ink-600">
          Gerçek bir ödeme sağlayıcısı bağlı değil. Bu ekran, sağlayıcının yapacağı{' '}
          <strong>imzalı sunucu bildirimini</strong> tetikler; sipariş yalnızca o bildirim
          doğrulanırsa ödenmiş sayılır.
        </p>

        <dl className="mt-6 divide-y divide-ink-200 border-y border-ink-200">
          <Row label="Sipariş" value={<span className="font-mono text-caption">{orderNo}</span>} />
          <Row
            label="Tutar"
            value={
              <span className="font-semibold">
                <Money minor={amountMinor} /> {currency}
              </span>
            }
          />
        </dl>

        {expired ? (
          <p role="alert" className="mt-6 text-small text-danger-700">
            Bu ödeme oturumunun süresi doldu. Sipariş sayfasından yeniden başlatın.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <Button
              size="lg"
              block
              disabled={busy !== null}
              data-testid="mock-pay-success"
              onClick={() => void complete('success')}
            >
              {busy === 'success' ? 'Gönderiliyor…' : 'Ödemeyi Tamamla (başarılı)'}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              disabled={busy !== null}
              data-testid="mock-pay-failure"
              onClick={() => void complete('failure')}
            >
              {busy === 'failure' ? 'Gönderiliyor…' : 'Ödemeyi Reddet (başarısız)'}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-caption text-danger-700">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-3">
      <dt className="text-small text-ink-600">{label}</dt>
      <dd className="text-small text-ink-900">{value}</dd>
    </div>
  )
}
