'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHint, Input, Label } from '@/components/ui/input'
import { OrderView } from '@/components/orders/OrderView'
import type { PublicOrderView } from '@/server/orders/lookup'

/**
 * MİSAFİR SİPARİŞ TAKİBİ
 *
 * Sipariş numarası + e-posta İKİSİ BİRDEN gerekir. Sunucu, sipariş bulunamadı
 * ile e-posta eşleşmedi durumları için AYNI mesajı döner — sipariş numarasının
 * varlığı sızmaz.
 */
export function TrackForm({ initialOrderNo = '' }: { initialOrderNo?: string }) {
  const [orderNo, setOrderNo] = useState(initialOrderNo)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<PublicOrderView | null>(null)
  const [linkSent, setLinkSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/orders/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderNo: orderNo.trim().toUpperCase(), email: email.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error?.message ?? 'Sipariş bulunamadı.')
        setOrder(null)
        return
      }
      setOrder(json as PublicOrderView)
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  async function sendLink() {
    setLinkSent(true)
    try {
      await fetch(`/api/v1/orders/${encodeURIComponent(orderNo.trim().toUpperCase())}/send-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
    } catch {
      /* cevap her durumda aynı — sessizce geçilir */
    }
  }

  if (order) {
    return (
      <div className="flex flex-col gap-6">
        <OrderView order={order} />
        <Button
          variant="ghost"
          onClick={() => {
            setOrder(null)
            setLinkSent(false)
          }}
        >
          Başka bir sipariş sorgula
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]"
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="track-orderno">Sipariş numarası</Label>
          <Input
            id="track-orderno"
            className="mt-1.5 font-mono uppercase"
            placeholder="M333-XXXXXXXX"
            autoComplete="off"
            value={orderNo}
            invalid={!!error}
            onChange={(e) => setOrderNo(e.target.value.toUpperCase())}
          />
          <FieldHint className="mt-1.5">Sipariş e-postanızda yer alır.</FieldHint>
        </div>

        <div>
          <Label htmlFor="track-email">E-posta</Label>
          <Input
            id="track-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            className="mt-1.5"
            value={email}
            invalid={!!error}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {error && (
          <div>
            <FieldError>{error}</FieldError>
            {!linkSent ? (
              <button
                type="button"
                onClick={() => void sendLink()}
                className="mt-2 text-caption font-medium text-brand-700 underline underline-offset-2"
              >
                Takip bağlantısını e-postama gönder
              </button>
            ) : (
              <FieldHint className="mt-2">
                Sipariş kayıtlarımızda bulunursa takip bağlantısı e-posta adresinize gönderildi.
              </FieldHint>
            )}
          </div>
        )}

        <Button type="submit" size="lg" block disabled={loading || !orderNo.trim() || !email.trim()}>
          {loading ? 'Sorgulanıyor…' : 'Siparişimi Sorgula'}
        </Button>

        <p className="text-caption leading-relaxed text-ink-500">
          Güvenliğiniz için sorgulama sayısı sınırlıdır. Sipariş numarası tek başına siparişinize
          erişim sağlamaz.
        </p>
      </div>
    </form>
  )
}
