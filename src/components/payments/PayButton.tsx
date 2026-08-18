'use client'

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * ÖDEME BAŞLAT
 *
 * Tutar GÖNDERMEZ. Sunucu tutarı `Order.totalMinor`'dan okur; bu bileşen
 * yalnızca sipariş numarasını ve (misafirse) takip token'ını iletir.
 *
 * Çift tıklama: `Idempotency-Key` sabit tutulur, buton anında kilitlenir.
 * Aynı anahtarla ikinci istek yeni ödeme AÇMAZ, mevcut checkout'u döndürür.
 */

function newKey(orderNo: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `pay-${orderNo}-${rnd}`.slice(0, 128)
}

export function PayButton({
  orderNo,
  trackingToken,
  label = 'Ödemeye Geç',
  retry = false,
}: {
  orderNo: string
  trackingToken?: string | null
  label?: string
  retry?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idemKey] = useState(() => newKey(orderNo))

  const start = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/payments/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idemKey },
        body: JSON.stringify({
          orderNo,
          ...(trackingToken ? { trackingToken } : {}),
        }),
      })
      const json = await res.json()

      if (!res.ok || !json.checkoutUrl) {
        setError(json?.error?.message ?? 'Ödeme başlatılamadı. Lütfen tekrar deneyin.')
        setBusy(false)
        return
      }

      // Sağlayıcı sayfasına git. Dönüş `/odeme/sonuc/[orderNo]` adresine olur;
      // orada sonuç SUNUCUDAN doğrulanır, tarayıcı dönüşüne güvenilmez.
      window.location.href = json.checkoutUrl as string
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
      setBusy(false)
    }
  }, [orderNo, trackingToken, idemKey])

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        block
        variant={retry ? 'secondary' : 'primary'}
        disabled={busy}
        data-testid={retry ? 'retry-payment' : 'start-payment'}
        onClick={() => void start()}
      >
        {busy ? 'Ödeme sayfası hazırlanıyor…' : label}
      </Button>
      {error && (
        <p role="alert" className="text-caption text-danger-700">
          {error}
        </p>
      )}
    </div>
  )
}
