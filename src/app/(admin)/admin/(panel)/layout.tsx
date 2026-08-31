import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AdminNav, type AdminNavItem } from '@/components/admin/AdminNav'
import { Logo } from '@/components/brand/Logo'
import { LogoutButton } from '@/components/layout/LogoutButton'
import { ROLE_LEVEL } from '@/lib/enums'
import { getSessionUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

/**
 * OPERASYON PANELİ KABUĞU
 *
 * ⚠️ Üçüncü yetki kapısı. middleware yalnızca oturum çerezinin VARLIĞINA
 * bakar (Edge runtime, DB yok); gerçek rol kontrolü burada ve ayrıca her
 * API ucunda yapılır.
 *
 * Minimum rol: SUPPORT (okuma). Yazma yetkisi uç bazında ayrıca kontrol edilir.
 *
 * ⚠️ BU DOSYA `(panel)` ROTA GRUBUNDADIR. Grup URL'e HİÇBİR ŞEY EKLEMEZ —
 * /admin/fulfillment hâlâ aynı adrestir. Tek amacı, /admin/giris'i bu düzenin
 * DIŞINDA bırakmaktır: giriş sayfası oturum isteyen bir düzenin içinde
 * olsaydı kendi kendini tetikleyen bir yönlendirme döngüsü doğardı.
 *
 * ⚠️ MÜŞTERİ SİTESİNİN KABUĞU BURAYA GELMEZ. Üstteki kök düzen
 * (`src/app/(admin)/layout.tsx`) müşteri başlığını, altbilgisini, WhatsApp
 * düğmesini ve Google Ads etiketini taşımaz — sebepleri orada yazılı.
 */
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/giris?next=/admin/fulfillment')
  /**
   * ⚠️ YETKİSİZ KULLANICI /hesabim'e DEĞİL, PERSONEL KAPISINA GÖNDERİLİR.
   * Eskiden müşteri hesap sayfasına atılıyordu; panele girmeye çalışan
   * personel yanlış hesapla giriş yaptığında hiçbir açıklama görmeden
   * müşteri ekranında buluyordu kendini. /admin/giris o durumu adıyla
   * söyler ve çıkış yolunu gösterir. (Döngü yok: o sayfa bu düzenin
   * dışındadır.)
   */
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL.SUPPORT) redirect('/admin/giris')

  /**
   * ⚠️ MENÜ VERİ OLARAK TANIMLANIR, JSX OLARAK DEĞİL. Rol filtresi tek
   * satırda okunabilir kalsın diye: bağlantılar JSX içinde koşullu
   * yazıldığında hangi rolün neyi gördüğü altı ayrı yere dağılıyordu.
   */
  /**
   * ⚠️ "KATALOG" SEKMESİ BİLEREK YOK — kaldırıldı, unutulmadı.
   *
   * Platform / hizmet / varyant / fiyat kademesi ekranları panelden
   * çıkarıldı. VERİ VE API UÇLARI DURUYOR (`/api/v1/admin/platforms`,
   * `/services`, `/variants`, `/pricing-rules`); silinmedi, çünkü müşteri
   * sitesi katalogdan besleniyor ve uçlar kaldırılsa fiyat değiştirmenin
   * hiçbir yolu kalmazdı.
   *
   * ⚠️ SONUÇ: fiyat değişikliği artık arayüzden YAPILAMAZ. API'ye doğrudan
   * istek atmak ya da veritabanında güncellemek gerekir. Sekmeyi geri
   * isteyen olursa ekranlar git geçmişinde duruyor.
   */
  const items: AdminNavItem[] = [
    { href: '/admin/fulfillment', label: 'İş Kuyruğu', match: '/admin/fulfillment' },
    { href: '/admin/notifications', label: 'Bildirimler', match: '/admin/notifications' },
  ]
  // ⚠️ Kullanıcı yönetimi yalnızca ADMIN+ — SUPPORT/OPERATOR görmez.
  if (ROLE_LEVEL[user.role] >= ROLE_LEVEL.ADMIN) {
    items.push({ href: '/admin/kullanicilar', label: 'Kullanıcılar', match: '/admin/kullanicilar' })
  }
  /**
   * ⚠️ KASA YALNIZCA SUPERADMIN. Banka bakiyesi, borç ve alacak verisi
   * ADMIN'e bile açılmaz — bağlantıyı gizlemek yetki mekanizması değildir,
   * asıl kapı sayfada ve API ucundadır.
   */
  if (user.role === 'SUPERADMIN') {
    items.push({ href: '/admin/kasa', label: 'Kasa', match: '/admin/kasa' })
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        ⚠️ KOYU ÜST ÇUBUK — müşteri sitesinin beyaz başlığından KASITLI
        olarak farklı. Amaç estetik değil, yön duygusu: hangi uygulamada
        olduğun bir bakışta belli olmalı. İkisi aynı görünseydi, canlı
        müşteri verisiyle çalışırken yanlış sekmede olduğunu fark etmek
        zorlaşırdı.
      */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-5">
          {/*
            ⚠️ `href={null}` ŞART: `Logo` varsayılan olarak kendini bir
            `<Link href="/">` içine sarar. Burada zaten bir bağlantının
            içindeyiz; sarmalasaydı iç içe `<a>` doğardı — geçersiz HTML,
            tarayıcılar bunu sessizce ve tutarsız biçimde onarır.

            ⚠️ `plate` DA YOK: koyu çubukta çıplak altın logo doğru
            kullanımdır (bkz. Logo.tsx). Plaka açık zeminler içindir.
          */}
          <Link href="/admin/fulfillment" className="flex shrink-0 items-center gap-2.5">
            <Logo href={null} />
            <span className="border-l border-white/20 pl-2.5 text-small font-semibold tracking-wide text-white/90">
              Yönetim
            </span>
          </Link>

          {/*
            ⚠️ `flex-wrap` ŞART. Faz 9'da menüye iki bağlantı eklendiğinde
            390px'te satır 45px taşıyor ve tüm panel yana kayıyordu.
            Sarmalama, bağlantı sayısı arttıkça sessizce bozulmayan tek
            çözümdür.
          */}
          <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
            <AdminNav items={items} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span
              className="hidden rounded-full bg-white/10 px-2.5 py-0.5 text-caption font-medium text-white/80 md:inline"
              title={user.email}
            >
              {user.role}
            </span>
            {/*
              ⚠️ "Hesabım" MÜŞTERİ SİTESİNE ÇIKAR. Bağlantı korunuyor çünkü
              istendi, ama paneli TERK ETTİĞİ ok işaretiyle söyleniyor —
              yoksa tıklayan kişi kendini müşteri sitesinde bulup panelin
              bozulduğunu sanardı.
            */}
            <Link
              href="/hesabim"
              className="rounded-[--radius-control] px-2.5 py-2 text-small text-white/70 hover:bg-white/10 hover:text-white sm:px-3"
            >
              Hesabım ↗
            </Link>
            <LogoutButton onDark />
          </div>
        </div>
      </header>

      <main id="panel-icerik" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-5">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-5">
        <p className="border-t border-ink-200 pt-5 text-caption leading-relaxed text-ink-500">
          Tüm hizmetler gerçek kişiler tarafından <strong>manuel</strong> gerçekleştirilir. Bu panel
          yalnızca yapılan işin kaydını tutar; hiçbir otomatik etkileşim, bot veya scraping
          çalıştırmaz.
        </p>
      </footer>
    </div>
  )
}
