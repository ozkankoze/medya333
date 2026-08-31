import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/inter'
import '../globals.css'

/**
 * ⭐ YÖNETİM PANELİ — KENDİ KÖK DÜZENİ
 *
 * ⚠️⚠️ BU BİR **KÖK** DÜZENDİR (`<html>` ve `<body>` burada başlar).
 *
 * Next.js App Router'da her üst düzey rota grubu kendi kök düzenine sahip
 * olabilir. `src/app/layout.tsx` KALDIRILDI ve yerine iki kök düzen geldi:
 *
 *   (site)/layout.tsx   → müşteri sitesi (başlık, altbilgi, WhatsApp, reklam)
 *   (admin)/layout.tsx  → burası (hiçbiri yok)
 *
 * Rota grupları adrese hiçbir şey eklemez: `/admin/kasa` hâlâ `/admin/kasa`.
 * Tek yaptıkları, iki uygulamanın birbirinin kabuğunu MİRAS ALMAMASINI
 * sağlamaktır.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ÖNCEDEN NE OLUYORDU — VE NEDEN SADECE "GÖRÜNÜM" MESELESİ DEĞİLDİ:
 *
 * Panel, müşteri sitesinin kök düzeninin İÇİNDE render ediliyordu. Yani
 * yönetim ekranlarında şunlar da vardı:
 *
 *   · Müşteri başlığı ve menüsü ("Hizmetler", "Yeni Sipariş"…)
 *   · Müşteri altbilgisi
 *   · Sağ alttaki WhatsApp destek düğmesi — kendi paneline destek talebi
 *     açmaya davet eden bir düğme
 *   · **Google Ads dönüşüm etiketi** — kendi panelini her açışında
 *     Google'a olay gönderiliyordu. Bu, reklam verisini kirleten ve
 *     kimsenin fark etmeyeceği bir sızıntıydı.
 *   · Müşteri sitesinin OG/canonical meta verisi
 *
 * Bunların hiçbiri panelde işe yaramıyordu; sonuncusu ise ölçüm verisini
 * bozuyordu. Ayırmanın asıl kazancı budur, estetik ikincil.
 *
 * ⚠️ `globals.css` HER İKİ KABUKTA DA YÜKLENİR ve öyle kalmalıdır. Tailwind
 * temel katmanı ile tasarım belirteçleri (renk, yarıçap, gölge) ortaktır;
 * panele ayrı bir stil dosyası yazmak, iki yerde ayrışan iki tema üretirdi.
 * Panele özgü kurallar `data-shell="admin"` altında yazılır — bu seçici
 * müşteri sitesinde hiçbir zaman eşleşmez.
 */

export const metadata: Metadata = {
  title: {
    default: 'Yönetim · Medya 333',
    template: '%s · Yönetim',
  },
  /**
   * ⚠️ TÜM PANEL ARAMA MOTORLARINA KAPALI — TEK YERDEN.
   * Eskiden her sayfa kendi `robots: { index: false }` satırını taşıyordu ve
   * yeni bir sayfa eklendiğinde unutulması işten değildi. Kök düzende
   * tanımlanınca yeni sayfa otomatik kapsanır.
   *
   * ⚠️ Bu, yetkilendirmenin YERİNE GEÇMEZ. `robots` yalnızca dürüst
   * tarayıcılara bir ricadır; erişimi middleware, düzen ve API uçlarındaki
   * rol kontrolleri engeller.
   */
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = {
  themeColor: '#0b0b0c',
  width: 'device-width',
  initialScale: 1,
}

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr-TR" data-shell="admin">
      {/*
        ⚠️ BURADA `GoogleAdsTag` YOKTUR ve eklenmemelidir. Panel kullanımı
        bir müşteri dönüşümü değildir; etiketi buraya koymak reklam
        ölçümünü sessizce kirletir.

        ⚠️ `SupportFab` de yoktur: kendi paneline WhatsApp destek düğmesi
        koymanın bir anlamı yok.
      */}
      <body className="min-h-dvh bg-ink-50 antialiased">
        <a
          href="#panel-icerik"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[--radius-control] focus:bg-white focus:px-4 focus:py-2 focus:text-small focus:shadow-[--shadow-lifted]"
        >
          İçeriğe geç
        </a>
        {children}
      </body>
    </html>
  )
}
