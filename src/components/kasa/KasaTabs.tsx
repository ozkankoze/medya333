import Link from 'next/link'

/**
 * KASA MODÜLÜ SEKMELERİ
 *
 * ⚠️ SUNUCU BİLEŞENİDİR ve öyle kalmalı. `usePathname` ile istemcide aktif
 * sekmeyi bulmak cazipti; ama bu, üç kasa sayfasının tamamına gereksiz bir
 * istemci paketi eklerdi. Aktif sekme, sayfanın kendisi tarafından
 * `active` ile bildirilir — sayfa zaten hangi sayfa olduğunu bilir.
 *
 * ⚠️ SIRALAMA BİLİNÇLİ: Siparişler → Aylık Paketler → Kasa. Günlük iş en
 * sık girilen kayıttır ve önde durur; Kasa (defterin tamamı) sondadır.
 * Yönetim menüsündeki "Kasa" bağlantısı yine /admin/kasa'ya gider, yani
 * defter görünümüne — diğer ikisi oradan bir tık uzaktadır.
 */
const TABS = [
  { key: 'siparisler', href: '/admin/kasa/siparisler', label: 'Siparişler' },
  { key: 'paketler', href: '/admin/kasa/paketler', label: 'Aylık Paketler' },
  { key: 'kasa', href: '/admin/kasa', label: 'Kasa' },
] as const

export type KasaTabKey = (typeof TABS)[number]['key']

export function KasaTabs({ active }: { active: KasaTabKey }) {
  return (
    <nav aria-label="Kasa bölümleri" className="-mx-1 flex flex-wrap gap-1 border-b border-ink-200">
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            href={t.href}
            // ⚠️ `aria-current` şart: aktif sekmeyi yalnızca renkle
            //    belirtmek, ekran okuyucu ve renk körlüğü için yetersizdir.
            aria-current={isActive ? 'page' : undefined}
            className={
              'rounded-t-[--radius-control] px-3 py-2.5 text-small transition-colors ' +
              (isActive
                ? 'border-b-2 border-brand-600 font-semibold text-ink-900'
                : 'border-b-2 border-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900')
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
