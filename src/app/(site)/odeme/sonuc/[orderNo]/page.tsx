import type { Metadata } from 'next'
import { PaymentResult } from './PaymentResult'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ödeme sonucu',
  robots: { index: false, follow: false },
}

/**
 * /odeme/sonuc/[orderNo] — sağlayıcıdan dönüş ekranı
 *
 * ⚠️ Bu sayfaya gelinmiş olması ödeme başarılı demek DEĞİLDİR.
 * Sağlayıcı kullanıcıyı success URL'e yönlendirmiş olabilir ama sunucudan
 * sunucuya bildirim henüz gelmemiş/doğrulanmamış olabilir. Bu yüzden ekran
 * "Ödemeniz doğrulanıyor" durumunda başlar ve durumu SUNUCUDAN yoklar.
 *
 * "Ödemeniz alındı" ifadesi YALNIZCA sipariş PAID olduğunda gösterilir.
 */
export default async function PaymentResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>
  searchParams: Promise<{ t?: string; durum?: string }>
}) {
  const { orderNo } = await params
  const { t, durum } = await searchParams

  return (
    <PaymentResult
      orderNo={orderNo}
      trackingToken={typeof t === 'string' ? t : null}
      providerSaysFailed={durum === 'basarisiz'}
    />
  )
}
