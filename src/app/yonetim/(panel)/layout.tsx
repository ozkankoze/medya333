import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ROLE_LEVEL } from '@/lib/enums'
import { getSessionUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

/**
 * OPERASYON PANELİ DÜZENİ
 *
 * ⚠️ Üçüncü yetki kapısı. middleware yalnızca oturum çerezinin VARLIĞINA
 * bakar (Edge runtime, DB yok); gerçek rol kontrolü burada ve ayrıca her
 * API ucunda yapılır.
 *
 * Minimum rol: SUPPORT (okuma). Yazma yetkisi uç bazında ayrıca kontrol edilir.
 *
 * ⚠️ BU DOSYA `(panel)` ROTA GRUBUNDADIR. Grup URL'e HİÇBİR ŞEY EKLEMEZ —
 * /yonetim/fulfillment hâlâ aynı adrestir. Tek amacı, /yonetim/giris'i bu
 * düzenin DIŞINDA bırakmaktır: giriş sayfası oturum isteyen bir düzenin
 * içinde olsaydı kendi kendini tetikleyen bir yönlendirme döngüsü doğardı.
 */
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/yonetim/giris?next=/yonetim/fulfillment')
  /**
   * ⚠️ YETKİSİZ KULLANICI /hesabim'e DEĞİL, PERSONEL KAPISINA GÖNDERİLİR.
   * Eskiden müşteri hesap sayfasına atılıyordu; panele girmeye çalışan
   * personel yanlış hesapla giriş yaptığında hiçbir açıklama görmeden
   * müşteri ekranında buluyordu kendini. /yonetim/giris o durumu adıyla
   * söyler ve çıkış yolunu gösterir. (Döngü yok: o sayfa bu düzenin
   * dışındadır.)
   */
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL.SUPPORT) redirect('/yonetim/giris')

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-200 pb-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-h2 text-ink-900">Operasyon</h1>
          <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-caption font-medium text-ink-600">
            {user.role}
          </span>
        </div>
        {/*
          ⚠️ `flex-wrap` ŞART. Faz 9'da menüye iki bağlantı daha eklendi
          (Bildirimler, Kullanıcılar) ve 390px'te satır 45px taşıyordu —
          tüm panel yana kaydı. Sarmalama, bağlantı sayısı arttıkça
          sessizce bozulmayan tek çözümdür.
          `-mx-1` negatif kenar boşluğu, düğmelerin iç dolgusunun kenara
          hizalanmasını sağlar; taşma üretmez.
        */}
        <nav className="-mx-1 flex flex-wrap items-center gap-x-0.5 gap-y-1 text-small">
          <Link
            href="/yonetim/fulfillment"
            className="rounded-[--radius-control] px-2.5 py-2 text-ink-700 hover:bg-ink-100 sm:px-3"
          >
            İş Kuyruğu
          </Link>
          <Link
            href="/yonetim/katalog"
            className="rounded-[--radius-control] px-2.5 py-2 text-ink-700 hover:bg-ink-100 sm:px-3"
          >
            Katalog
          </Link>
          <Link
            href="/yonetim/notifications"
            className="rounded-[--radius-control] px-2.5 py-2 text-ink-700 hover:bg-ink-100 sm:px-3"
          >
            Bildirimler
          </Link>
          {/* ⚠️ Kullanıcı yönetimi yalnızca ADMIN+ — SUPPORT/OPERATOR görmez. */}
          {ROLE_LEVEL[user.role] >= ROLE_LEVEL.ADMIN && (
            <Link
              href="/yonetim/kullanicilar"
              className="rounded-[--radius-control] px-2.5 py-2 text-ink-700 hover:bg-ink-100 sm:px-3"
            >
              Kullanıcılar
            </Link>
          )}
          {/**
           * ⚠️ KASA YALNIZCA SUPERADMIN. Banka bakiyesi, borç ve alacak
           * verisi ADMIN'e bile açılmaz — bağlantıyı gizlemek yetki
           * mekanizması değildir, asıl kapı sayfada ve API ucundadır.
           */}
          {user.role === 'SUPERADMIN' && (
            <Link
              href="/yonetim/kasa"
              className="rounded-[--radius-control] px-2.5 py-2 text-ink-700 hover:bg-ink-100 sm:px-3"
            >
              Kasa
            </Link>
          )}
          <Link
            href="/hesabim"
            className="rounded-[--radius-control] px-2.5 py-2 text-ink-600 hover:bg-ink-100 sm:px-3"
          >
            Hesabım
          </Link>
        </nav>
      </div>

      <div className="pt-6">{children}</div>

      <p className="mt-10 border-t border-ink-200 pt-5 text-caption leading-relaxed text-ink-500">
        Tüm hizmetler gerçek kişiler tarafından <strong>manuel</strong> gerçekleştirilir. Bu panel
        yalnızca yapılan işin kaydını tutar; hiçbir otomatik etkileşim, bot veya scraping
        çalıştırmaz.
      </p>
    </div>
  )
}
