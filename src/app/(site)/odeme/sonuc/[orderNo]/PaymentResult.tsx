'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { PayButton } from '@/components/payments/PayButton'
import { Money } from '@/components/primitives/Money'
import { cn } from '@/lib/utils'

/**
 * ⚠️ TARAYICI DÖNÜŞÜ KANIT DEĞİLDİR.
 *
 * Sağlayıcı kullanıcıyı "başarılı" URL'ine yollamış olabilir; biz yine de
 * sunucuya sorarız. Kesin ifade ("Ödemeniz alındı") YALNIZCA sipariş PAID
 * olduğunda çıkar. O ana kadar ekran "Ödemeniz doğrulanıyor" der.
 *
 * Yoklama: 2 sn aralıkla, en fazla 90 sn. Sonra kullanıcı elle yenileyebilir.
 */

interface StatusResponse {
  orderNo: string
  orderStatus: string
  orderStatusLabel: string
  paid: boolean
  totalMinor: number
  payment: {
    status: string
    label: string | null
    description: string | null
    retryable: boolean
    failureMessage: string | null
  } | null
}

const POLL_MS = 2000
const MAX_POLLS = 45

export function PaymentResult({
  orderNo,
  trackingToken,
  providerSaysFailed,
}: {
  orderNo: string
  trackingToken: string | null
  providerSaysFailed: boolean
}) {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [polls, setPolls] = useState(0)
  const [notFound, setNotFound] = useState(false)
  const stopped = useRef(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    async function tick(count: number) {
      if (stopped.current) return
      try {
        const url = `/api/v1/payments/${encodeURIComponent(orderNo)}/status${
          trackingToken ? `?t=${encodeURIComponent(trackingToken)}` : ''
        }`
        const res = await fetch(url, { cache: 'no-store' })
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        const json = (await res.json()) as StatusResponse
        setData(json)

        const settled = json.paid || json.payment?.retryable === true
        if (settled) return // sonuç kesinleşti, yoklamayı bırak
      } catch {
        /* geçici hata — yoklamaya devam */
      }

      if (count + 1 >= MAX_POLLS) return
      setPolls(count + 1)
      timer = setTimeout(() => void tick(count + 1), POLL_MS)
    }

    void tick(0)
    return () => {
      stopped.current = true
      clearTimeout(timer)
    }
  }, [orderNo, trackingToken])

  if (notFound) {
    return (
      <Shell>
        <h1 className="text-h2 text-ink-900">Sipariş bulunamadı</h1>
        <p className="mt-3 text-body text-ink-600">
          Bu sipariş için ödeme durumunu görüntüleme yetkiniz yok.
        </p>
        <Link href="/siparis-takip" className={cn(buttonVariants({ size: 'lg' }), 'mt-7')}>
          Sipariş Takibi
        </Link>
      </Shell>
    )
  }

  // --- KESİN BAŞARI: yalnızca sipariş PAID olduğunda ------------------------
  if (data?.paid) {
    return (
      <Shell>
        <Icon tone="success" />
        <h1 className="mt-5 text-h2 text-ink-900" data-testid="payment-success">
          Ödemeniz alındı
        </h1>
        <p className="mt-2 text-body text-ink-600">Siparişiniz işleme hazır.</p>

        <Field label="Sipariş No" value={<span className="font-mono">{orderNo}</span>} />
        <Field label="Durum" value={<strong>{data.orderStatusLabel}</strong>} />
        <Field label="Tutar" value={<Money minor={data.totalMinor} />} />

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          {/* Token URL'e konmaz: misafir sahipliği ödeme dönüş çerezinden
              doğrulanır (server/payments/return-cookie.ts). */}
          <Link
            href={
              trackingToken
                ? `/siparisler/${orderNo}?t=${encodeURIComponent(trackingToken)}`
                : `/siparisler/${orderNo}`
            }
            className={cn(buttonVariants({ size: 'lg', block: true }), 'sm:flex-1')}
          >
            Siparişimi Görüntüle
          </Link>
          <Link
            href="/#siparis"
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'lg', block: true }),
              'sm:flex-1',
            )}
          >
            Yeni Sipariş
          </Link>
        </div>

        {/* Misafir kullanıcı da buraya gidebilir: giriş ekranı siparişi
            hesaba bağlamanın yoludur. */}
        <p className="mt-5 text-center text-small text-ink-500">
          <Link href="/hesabim" className="text-brand-600 underline underline-offset-2">
            Hesabıma git
          </Link>
        </p>
      </Shell>
    )
  }

  // --- KESİN BAŞARISIZLIK: ödeme tekrar denenebilir durumda -----------------
  const failed = data?.payment?.retryable === true
  if (failed) {
    return (
      <Shell>
        <Icon tone="danger" />
        <h1 className="mt-5 text-h2 text-ink-900" data-testid="payment-failed">
          Ödeme tamamlanamadı
        </h1>
        <p className="mt-2 text-body text-ink-600">
          {data?.payment?.failureMessage ?? data?.payment?.description ?? 'Ödeme alınamadı.'}
        </p>
        <p className="mt-3 text-small text-ink-600">
          Siparişiniz <strong>silinmedi</strong>; ödeme bekliyor. Dilediğiniz zaman tekrar
          deneyebilirsiniz.
        </p>

        <Field label="Sipariş No" value={<span className="font-mono">{orderNo}</span>} />

        <div className="mt-7">
          <PayButton orderNo={orderNo} trackingToken={trackingToken} label="Tekrar Öde" retry />
        </div>
      </Shell>
    )
  }

  // --- BELİRSİZ: doğrulanıyor ------------------------------------------------
  const timedOut = polls + 1 >= MAX_POLLS
  return (
    <Shell>
      <Icon tone="progress" />
      <h1 className="mt-5 text-h2 text-ink-900" data-testid="payment-verifying">
        Ödemeniz doğrulanıyor…
      </h1>
      <p className="mt-2 text-body leading-relaxed text-ink-600">
        {providerSaysFailed
          ? 'Ödeme sağlayıcısından dönüş alındı. Sonucu bankadan teyit ediyoruz.'
          : 'Ödemenizin bankadan onaylandığını teyit ediyoruz. Bu işlem birkaç saniye sürebilir.'}
      </p>
      <p className="mt-3 text-caption leading-relaxed text-ink-500">
        Bu sayfayı kapatabilirsiniz — sonuç kesinleştiğinde siparişiniz otomatik güncellenir ve
        size e-posta gönderilir.
      </p>

      <Field label="Sipariş No" value={<span className="font-mono">{orderNo}</span>} />

      {timedOut && (
        <div className="mt-6 rounded-[--radius-control] border border-ink-200 bg-ink-50 p-4 text-left">
          <p className="text-small text-ink-700">
            Sonuç hâlâ gelmedi. Ödemeniz alındıysa siparişiniz kısa süre içinde güncellenecek.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 text-caption font-medium text-brand-700 underline underline-offset-2"
          >
            Durumu yeniden kontrol et
          </button>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-8 text-center shadow-[--shadow-card]">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-baseline justify-between rounded-[--radius-control] border border-ink-200 px-5 py-3 text-left">
      <span className="text-small text-ink-600">{label}</span>
      <span className="text-small text-ink-900">{value}</span>
    </div>
  )
}

function Icon({ tone }: { tone: 'success' | 'danger' | 'progress' }) {
  const cls = {
    success: 'bg-success-100 text-success-700',
    danger: 'bg-danger-100 text-danger-700',
    progress: 'bg-brand-100 text-brand-700',
  }[tone]

  return (
    <div className={cn('mx-auto flex size-14 items-center justify-center rounded-full', cls)} aria-hidden>
      {tone === 'success' && (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {tone === 'danger' && (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      )}
      {tone === 'progress' && (
        <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}
