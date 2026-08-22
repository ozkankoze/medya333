'use client'

import { useCallback, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * WHATSAPP BAĞLANTISI + GOOGLE ADS TIKLAMA DÖNÜŞÜMÜ
 *
 * Sitedeki HER WhatsApp düğmesi bu bileşenden geçer (destek düğmesi ve
 * ödeme köprüsü). Tek geçit olması, "bir düğmeye event bağlamayı unutmak"
 * ihtimalini yapısal olarak ortadan kaldırır.
 *
 * ⚠️ BAĞLANTIYI ENGELLEMEZ. `preventDefault` YOK: tıklama normal seyrinde
 * devam eder ve WhatsApp açılır. Dönüşüm ölçümü, kullanıcının yapmak
 * istediği şeyin önüne asla geçmemelidir.
 *
 * ⚠️ `event_callback` KULLANILMADI ve buna İHTİYAÇ YOK. Bağlantılar
 * `target="_blank"` ile yeni sekmede açılır; mevcut sayfa yaşamaya devam
 * ettiği için gtag işaretçisinin tamamlanacak zamanı vardır. Aynı sekmede
 * gezinen bir bağlantı olsaydı işaretçi yarıda kesilebilirdi ve o zaman
 * `event_callback` + `preventDefault` gerekirdi — ki o da tıklamayı
 * geciktirirdi.
 *
 * ⚠️ TIKLAMA BAŞINA TEK OLAY. `gtag` senkron çağrılır ve tek bir `onClick`
 * içinde tetiklenir. Ayrıca çok hızlı çift tıklamada (çift tıklama, dokunmatik
 * "ghost click") ikinci olayı düşüren kısa bir kilit vardır: kullanıcının
 * NİYETİ tek bir temastır, iki dönüşüm değil.
 *
 * ⚠️ `gtag` YOKSA SESSİZCE GEÇER. Reklam engelleyici, ağ hatası ya da
 * kimliğin tanımsız olması durumunda `window.gtag` bulunmaz. Burada hata
 * fırlatmak, ölçüm yüzünden müşteriyi WhatsApp'a gidemez hâle getirirdi.
 */

/** Aynı temasın iki olay üretmesini önleyen pencere (ms). */
const DOUBLE_CLICK_GUARD_MS = 800

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

export function WhatsappConversionLink({
  href,
  sendTo,
  className,
  ariaLabel,
  testId,
  children,
}: {
  href: string
  /** `AW-…/etiket` — null ise dönüşüm gönderilmez, bağlantı yine çalışır. */
  sendTo: string | null
  className?: string
  ariaLabel?: string
  testId?: string
  children: ReactNode
}) {
  const lastSentAt = useRef(0)

  const onClick = useCallback(() => {
    if (!sendTo) return

    const now = Date.now()
    if (now - lastSentAt.current < DOUBLE_CLICK_GUARD_MS) return
    lastSentAt.current = now

    try {
      window.gtag?.('event', 'conversion', { send_to: sendTo })
    } catch {
      /* Ölçüm ASLA tıklamayı bozmaz — sessizce yut. */
    }
  }, [sendTo])

  return (
    <a
      href={href}
      target="_blank"
      // ⚠️ `noopener`: yeni sekme `window.opener` üzerinden bu sayfayı
      //    yönlendirebilirdi. `noreferrer` adresi WhatsApp'a Referer olarak
      //    sızdırmaz (sipariş numaralı bağlantılarda bu önemlidir).
      rel="noopener noreferrer"
      className={className}
      onClick={onClick}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </a>
  )
}
