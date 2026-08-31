import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { env } from '@/env'
import { db } from '@/server/db'
import { MockCheckout } from './MockCheckout'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Test ödeme sayfası',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * /odeme/test/[ref] — MOCK SAĞLAYICI ÖDEME SAYFASI
 *
 * Gerçek merchant bilgisi olmadan tüm zinciri (checkout → bildirim →
 * doğrulama → PAID) uçtan uca çalıştırabilmek için var.
 *
 * ⚠️ GERÇEK PARA ORTAMINDA ERİŞİLEMEZ — `PAYMENT_ENVIRONMENT=production` iken 404.
 * ⚠️ Bu sayfa siparişi PAID YAPMAZ. Yalnızca sağlayıcının yapacağı gibi
 * İMZALI bir bildirim gönderir; kararı webhook işleyicisi verir.
 */
export default async function MockCheckoutPage({
  params,
}: {
  params: Promise<{ ref: string }>
}) {
  // Kapı gerçek para ortamıdır; sandbox/staging üretim derlemesiyle çalışır.
  if (env.PAYMENT_ENVIRONMENT === 'production') notFound()

  const { ref } = await params
  const payment = await db.payment.findUnique({
    where: { providerRef: ref },
    select: {
      provider: true,
      status: true,
      amountMinor: true,
      currency: true,
      orderNoSnapshot: true,
      checkoutExpiresAt: true,
    },
  })

  if (!payment || payment.provider !== 'mock') notFound()

  const expired = payment.checkoutExpiresAt ? payment.checkoutExpiresAt < new Date() : false

  return (
    <MockCheckout
      providerRef={ref}
      orderNo={payment.orderNoSnapshot ?? ''}
      amountMinor={payment.amountMinor}
      currency={payment.currency}
      expired={expired}
    />
  )
}
