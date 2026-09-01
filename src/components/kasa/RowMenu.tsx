'use client'

import { useEffect, useState } from 'react'

/**
 * ⭐ SATIR İŞLEM MENÜSÜ — tablo satırını kısa tutan tek düğme
 *
 * ⚠️ SEBEP ÖLÇÜLDÜ: paket listesinde her satırda üç işlem düğmesi alt alta
 * diziliyordu. Dar sütunda hepsi ikişer satıra sarıyor, tek bir tablo satırı
 * 100 pikselden uzun bir bloğa dönüşüyordu. Tablo, tablo gibi değil
 * paragraf gibi okunuyordu; ekrana dört paket sığıyordu.
 *
 * Kapalıyken tek bir "⋯" düğmesi durur, satır tek satırlık yüksekliğe iner.
 *
 * ⚠️⚠️ MENÜ AÇILIR KUTU (POPOVER) DEĞİL, SATIRIN İÇİNDE AÇILIR.
 *
 * Tablo `overflow-x-auto` bir kabın içinde. Mutlak konumlanmış bir panel o
 * kabın kenarında KIRPILIRDI — özellikle son sütunda, yani tam da işlem
 * sütununda. Kırpılma dar ekranda ortaya çıkar, geniş ekranda çıkmaz; yani
 * geliştirirken görünmez, kullanırken görünür. Satır içinde açmak bu sınıf
 * hatayı tamamen ortadan kaldırır: z-index yok, portal yok, kırpılma yok.
 *
 * ⚠️ İÇERİK KAPALIYKEN HİÇ RENDER EDİLMEZ. Her satırda üç ayrı form
 * bileşenini boşuna kurmak, 50 paketlik bir listede 150 gereksiz React
 * ağacı demekti.
 */
export function RowMenu({
  children,
  label = 'İşlemler',
}: {
  children: React.ReactNode
  label?: string
}) {
  const [open, setOpen] = useState(false)

  // ⚠️ ESC ile kapanır. Klavyeyle açan birinin menüden çıkmak için fareye
  //    uzanması gerekmemeli.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const btn =
    'rounded-[--radius-control] border border-ink-200 bg-white px-2 py-1 text-caption ' +
    'text-ink-700 hover:bg-ink-50'

  if (!open) {
    return (
      <button
        type="button"
        className={`${btn} leading-none`}
        aria-label={label}
        aria-expanded={false}
        title={label}
        onClick={() => setOpen(true)}
      >
        ⋯
      </button>
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-caption font-medium text-ink-600">{label}</span>
        <button
          type="button"
          className={btn}
          aria-expanded
          onClick={() => setOpen(false)}
        >
          Kapat
        </button>
      </div>
      {children}
    </div>
  )
}
