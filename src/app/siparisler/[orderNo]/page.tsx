import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { OrderView } from '@/components/orders/OrderView'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth'
import { readPaymentReturnToken } from '@/server/payments/return-cookie'
import {
  getOrderForUser,
  lookupOrderByToken,
  OrderAccessDeniedError,
  type PublicOrderView,
} from '@/server/orders/lookup'

export const dynamic = 'force-dynamic'

/** Sipariş sayfaları ARAMA MOTORLARINA KAPALIDIR. */
export const metadata: Metadata = {
  title: 'Sipariş Detayı',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * /siparisler/[orderNo]
 *
 * ⚠️ SİPARİŞ NUMARASI TEK BAŞINA YETMEZ.
 * Erişim iki yoldan biriyle olur:
 *   • `?t=<takip token'ı>` — e-posta ile gönderilen imzalı bağlantı
 *   • Oturum — sorgu `userId` ile kapsamlanır
 *   • Ödeme dönüş çerezi — sağlayıcıdan dönen misafir için, token URL'e
 *     girmeden sahiplik kanıtı (bkz. server/payments/return-cookie.ts)
 *
 * Hiçbiri yoksa 404 döner: siparişin var olup olmadığı bile sızdırılmaz.
 */
export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { orderNo } = await params
  const { t } = await searchParams

  const effectiveToken = t ?? (await readPaymentReturnToken(orderNo))

  let order: PublicOrderView
  try {
    if (effectiveToken) {
      order = await lookupOrderByToken(orderNo, effectiveToken)
    } else {
      const user = await getSessionUser()
      if (!user) notFound()
      order = await getOrderForUser(orderNo, user.id)
    }
  } catch (err) {
    if (err instanceof OrderAccessDeniedError) notFound()
    throw err
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="sr-only">Sipariş {order.orderNo}</h1>
      <OrderView order={order} trackingToken={t ?? null} />

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/hesabim" className={buttonVariants({ variant: 'secondary' })}>
          Siparişlerim
        </Link>
        <Link href="/" className={buttonVariants({ variant: 'ghost' })}>
          Yeni sipariş oluştur
        </Link>
      </div>

      <p className="mt-8 text-caption leading-relaxed text-ink-500">
        Bu bağlantı size özeldir; başkasıyla paylaşmayın. Paylaşırsanız bağlantıyı alan kişi
        siparişinizin durumunu görebilir.
      </p>
    </div>
  )
}
