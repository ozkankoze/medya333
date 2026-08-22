import { buttonVariants } from '@/components/ui/button'
import {
  manualPaymentNumber,
  whatsappConversionSendTo,
  whatsappPaymentHref,
} from '@/lib/support'
import { WhatsappConversionLink } from '@/components/analytics/WhatsappConversionLink'
import { cn } from '@/lib/utils'

export { manualPaymentNumber }

/**
 * MANUEL ÖDEME — WHATSAPP'A YÖNLENDİRME
 *
 * PayTR onayı gelene kadar tahsilat elden yürüyor. Müşteri "Ödemeye Geç"e
 * bastığında sipariş numarası hazır yazılmış bir WhatsApp mesajı açılır.
 *
 * ⚠️ BU BİR ÖDEME SAĞLAYICISI DEĞİLDİR ve öyleymiş gibi davranmaz.
 *  · Sipariş `PENDING_PAYMENT` olarak KALIR. Bu düğmeye basmak hiçbir
 *    durumu ilerletmez, hiçbir tahsilat kaydı açmaz.
 *  · Siparişi "ödendi" yapan tek yer, operatörün yönetim panelinden
 *    yaptığı elle onaydır.
 *  · Bu yüzden çevredeki metinler "ödemeniz tamamlanınca OTOMATİK işleme
 *    alınır" DEMEZ — manuel akışta bu yalan olurdu.
 *
 * ⚠️ MEVCUT ÖDEME MİMARİSİNE DOKUNULMADI. PayTR/iyzico sağlayıcıları,
 * webhook doğrulaması ve `PayButton` yerinde duruyor. Geri dönüş bir kod
 * değişikliği değil, `NEXT_PUBLIC_MANUAL_PAYMENT_ENABLED=false` ayarıdır.
 *
 * ⚠️ Numara ve bağlantı üretimi `lib/support` içindedir — destek düğmesiyle
 * AYNI kaynaktan gelir (bkz. oradaki not).
 */

export function WhatsappPayButton({
  orderNo,
  label = 'Ödemeye Geç',
  className,
}: {
  orderNo: string
  label?: string
  className?: string
}) {
  const phone = manualPaymentNumber()
  if (!phone) return null

  return (
    <WhatsappConversionLink
      href={whatsappPaymentHref(orderNo, phone)}
      // Destek düğmesiyle AYNI dönüşüm eylemi: ikisi de "müşteri WhatsApp'tan
      // bize ulaştı" demektir; Ads tarafında ayrıştırmaya gerek duyulmadı.
      sendTo={whatsappConversionSendTo()}
      className={cn(buttonVariants({ size: 'lg', block: true }), className)}
      testId="whatsapp-pay"
    >
      <WhatsappIcon />
      {label}
    </WhatsappConversionLink>
  )
}

function WhatsappIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03 0 1.2.87 2.35.99 2.51.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  )
}
