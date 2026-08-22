import { env } from '@/env'
import { supportWhatsappNumber } from '@/lib/support'

/**
 * CANLI DESTEK DÜĞMESİ — sağ altta sabit WhatsApp bağlantısı
 *
 * ⚠️ ÖDEME BAYRAĞINDAN BAĞIMSIZDIR. `NEXT_PUBLIC_MANUAL_PAYMENT_ENABLED`
 * kapanınca (PayTR bağlanınca) destek düğmesi KAYBOLMAMALIDIR; ikisi ayrı
 * ihtiyaçlar. Tek koşul: geçerli bir numaranın tanımlı olması.
 *
 * ⚠️ SUNUCU BİLEŞENİ. Sadece bir `<a>`; hiçbir client bundle eklemez,
 * hiçbir üçüncü taraf "canlı sohbet" scripti yüklemez. Bu tür widget'lar
 * genelde 100 KB+ JS ve bir izleme çerezi getirir; burada ikisi de yok.
 *
 * ⚠️ MOBİLDE SABİT FİYAT ÇUBUĞUYLA ÇAKIŞMAZ. Sihirbaz sayfasında ekranın
 * altına yapışan bir tutar çubuğu var (`.sticky-price-bar`, z-40). Düğme
 * hem ONUN ALTINDA bir katmanda (z-30) hem de mobilde daha yukarıda
 * konumlanır; böylece `:has()` gibi kırılgan bir seçiciye ihtiyaç kalmadan
 * her sayfada doğru durur. `lg`'de çubuk zaten gizlidir, düğme aşağı iner.
 */

export function SupportFab() {
  const phone = supportWhatsappNumber()
  // Numara yoksa düğme HİÇ render edilmez — bozuk bağlantı gösterilmez.
  if (!phone) return null

  const text = `Merhaba, ${env.NEXT_PUBLIC_SITE_NAME} hakkında bilgi almak istiyorum.`
  const href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`

  return (
    <a
      href={href}
      target="_blank"
      // ⚠️ `noreferrer`: müşterinin hangi sayfadan yazdığı WhatsApp'a
      //    Referer olarak gitmesin. `noopener`: yeni sekme bu sayfayı
      //    yönlendiremesin.
      rel="noopener noreferrer"
      aria-label="WhatsApp ile destek hattına yazın"
      data-testid="support-fab"
      className={
        'group fixed right-4 bottom-28 z-30 flex items-center gap-2.5 sm:right-6 lg:bottom-6 ' +
        // 56px daire — WCAG 2.5.8'in istediği 44px'in üstünde
        'size-14 justify-center rounded-full ' +
        'bg-[#25D366] text-white shadow-[0_8px_24px_-6px_rgb(16_24_40/0.35)] ' +
        'ring-1 ring-black/5 transition-transform duration-[--duration-base] ease-[--ease-out-soft] ' +
        'hover:scale-105 active:scale-95 ' +
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ' +
        // Hareketi kapatmış kullanıcıda büyüme animasyonu yok
        'motion-reduce:transition-none motion-reduce:hover:scale-100'
      }
    >
      <WhatsappGlyph />
      <span className="sr-only">WhatsApp destek</span>
    </a>
  )
}

function WhatsappGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03 0 1.2.87 2.35.99 2.51.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  )
}
