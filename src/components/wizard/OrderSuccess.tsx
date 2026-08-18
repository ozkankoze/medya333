'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { Money } from '@/components/primitives/Money'
import { cn } from '@/lib/utils'

/**
 * SİPARİŞ OLUŞTU EKRANI
 *
 * ⚠️ Bu ekran "işleme alındı" DEMEZ. Sipariş `PENDING_PAYMENT` durumundadır ve
 * ödeme tamamlanana kadar HİÇBİR işlem başlamaz. Bu, ekranda açıkça yazar —
 * müşterinin "sipariş verdim, başladı" sanmasının önüne geçer.
 *
 * İKİ CTA:
 *   1. Siparişimi takip et → /siparisler/[orderNo]?t=<token>
 *   2. Yeni sipariş oluştur
 */

export function OrderSuccess({
  orderNo,
  totalMinor,
  trackingToken,
  email,
  summary,
  onNewOrder,
}: {
  orderNo: string
  totalMinor: number
  trackingToken: string | null
  email: string
  summary: string
  onNewOrder: () => void
}) {
  const [copied, setCopied] = useState(false)

  const trackHref = trackingToken
    ? `/siparisler/${orderNo}?t=${encodeURIComponent(trackingToken)}`
    : `/siparis-takip?o=${encodeURIComponent(orderNo)}`

  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-8 text-center shadow-[--shadow-card]">
        <div
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-100 text-success-700"
          aria-hidden
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 className="mt-5 text-h2 text-ink-900">Siparişiniz oluşturuldu</h1>
        <p className="mt-2 text-body text-ink-600">{summary}</p>

        {/* --------------------------- Sipariş numarası --------------------------- */}
        <div className="mt-7 rounded-[--radius-control] border border-ink-200 bg-ink-50 p-5">
          <p className="text-caption uppercase tracking-wide text-ink-500">Sipariş numaranız</p>
          <p className="mt-1 font-mono text-h2 tracking-[0.06em] text-ink-900" data-testid="order-no">
            {orderNo}
          </p>
          <button
            type="button"
            className="mt-2 text-caption font-medium text-brand-700 underline underline-offset-2"
            onClick={() => {
              void navigator.clipboard?.writeText(orderNo).then(
                () => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                },
                () => undefined,
              )
            }}
          >
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>
        </div>

        {/* ------------------------ ÖDEME BEKLENİYOR uyarısı ---------------------- */}
        <div
          className="mt-5 rounded-[--radius-control] border border-warning-600/30 bg-warning-100 p-5 text-left"
          data-testid="pending-payment-notice"
        >
          <p className="flex items-center gap-2 text-body font-semibold text-warning-700">
            <span
              className="inline-block size-2 shrink-0 rounded-full bg-warning-600"
              aria-hidden
            />
            Durum: Ödeme bekleniyor
          </p>
          <p className="mt-1.5 text-small leading-relaxed text-warning-700/90">
            Siparişiniz <strong>ödeme tamamlanana kadar işleme alınmaz</strong>. Ödeme adımı
            yakında devreye girecek; o ana kadar siparişiniz kayıtlıdır ve dilediğiniz zaman
            iptal edebilirsiniz.
          </p>
        </div>

        <div className="mt-5 flex items-baseline justify-between rounded-[--radius-control] border border-ink-200 px-5 py-4 text-left">
          <span className="text-small text-ink-600">Toplam</span>
          <span className="text-h3 text-ink-900">
            <Money minor={totalMinor} />{' '}
            <span className="text-caption font-normal text-ink-500">KDV dahil</span>
          </span>
        </div>

        <p className="mt-5 text-small text-ink-600">
          Sipariş özeti ve takip bağlantısı <strong>{email}</strong> adresine gönderildi.
        </p>

        {/* ------------------------------- İKİ CTA ------------------------------- */}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            href={trackHref}
            className={cn(buttonVariants({ size: 'lg', block: true }), 'sm:flex-1')}
            data-testid="cta-track"
          >
            Siparişimi Takip Et
          </Link>
          <Button
            variant="secondary"
            size="lg"
            block
            className="sm:flex-1"
            data-testid="cta-new-order"
            onClick={onNewOrder}
          >
            Yeni Sipariş Oluştur
          </Button>
        </div>

        <p className="mt-6 text-caption leading-relaxed text-ink-500">
          Hizmetlerimiz gerçek kullanıcılar tarafından manuel olarak gerçekleştirilir. Bot, sahte
          hesap veya otomatik etkileşim sistemi kullanılmaz.
        </p>
      </div>
    </div>
  )
}
