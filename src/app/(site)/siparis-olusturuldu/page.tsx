import type { Metadata } from 'next'
import { OrderCreatedScreen } from './OrderCreatedScreen'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Siparişiniz oluşturuldu',
  robots: { index: false, follow: false },
}

/**
 * SİPARİŞ OLUŞTU EKRANI — kendi rotası
 *
 * Neden ayrı sayfa? Sihirbazın içinde gösterildiğinde pazarlama hero'su ve
 * "neden biz" bölümleri ekranın üstünde kalıyor, kullanıcı siparişinin
 * oluştuğunu görmek için aşağı kaydırmak zorunda kalıyordu.
 *
 * ⚠️ Takip token'ı URL'e KOYULMAZ. Sihirbaz onu `sessionStorage`'a yazar;
 * bu sayfa oradan okur. Böylece token tarayıcı geçmişine, sunucu erişim
 * kayıtlarına ve `Referer` başlığına düşmez.
 */
export default function OrderCreatedPage() {
  return <OrderCreatedScreen />
}
