'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * YÖNETİM PANELİ NAVİGASYONU
 *
 * ⚠️ İSTEMCİ BİLEŞENİ OLMASI BİLİNÇLİ. Sunucu bileşeni `pathname` göremez,
 * dolayısıyla aktif bölüm işaretlenemezdi. Gerçek bir backoffice'te "şu an
 * neredeyim?" sorusunun cevabı ekranda durmalıdır; altı bağlantılık bir
 * menü için bu, istemci paketine değecek tek şeydir.
 *
 * ⚠️ HANGİ BAĞLANTININ GÖRÜNECEĞİ ROLE BAĞLIDIR ama bu bir YETKİ
 * MEKANİZMASI DEĞİLDİR. Bağlantıyı gizlemek yalnızca yanlışlıkla
 * tıklamayı önler; asıl kapı sayfanın kendisinde ve API ucundadır.
 */

export interface AdminNavItem {
  href: string
  label: string
  /** Alt yolları da aynı bölüm sayılır (örn. /admin/kasa/paketler). */
  match: string
}

export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Panel bölümleri" className="-mx-1 flex flex-wrap items-center gap-x-0.5 gap-y-1">
      {items.map((item) => {
        /**
         * ⚠️ `startsWith` ama SINIR KONTROLLÜ. Düz `startsWith` ile
         * `/admin/kasa` bağlantısı `/admin/kasalar` gibi bir yolda da aktif
         * görünürdü. Ya tam eşleşme ya da eğik çizgiyle devam etmeli.
         */
        const active = pathname === item.match || pathname.startsWith(`${item.match}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={
              'rounded-[--radius-control] px-2.5 py-2 text-small transition-colors sm:px-3 ' +
              (active
                ? 'bg-white/15 font-semibold text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white')
            }
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
