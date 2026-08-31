import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Logo } from '@/components/brand/Logo'
import { LogoutButton } from '@/components/layout/LogoutButton'
import { ROLE_LEVEL } from '@/lib/enums'
import { getSessionUser } from '@/server/auth'
import { StaffLoginForm } from './StaffLoginForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Yönetim Girişi',
  robots: { index: false, follow: false },
}

/**
 * /admin/giris — PERSONEL KAPISI
 *
 * ⚠️ BU SAYFA `(panel)` GRUBUNUN DIŞINDADIR ve bu bir zorunluluktur.
 * `src/app/admin/(panel)/layout.tsx` oturum yoksa BU sayfaya yönlendirir.
 * Giriş sayfası da o düzenin içinde olsaydı, kendi kendine yönlendiren
 * sonsuz bir döngü doğardı: /admin/giris → oturum yok → /admin/giris.
 *
 * Rota grubu URL'i DEĞİŞTİRMEZ; /admin/fulfillment hâlâ aynı adrestir.
 * Tek yaptığı, düzeni yalnızca panel sayfalarına uygulamaktır.
 *
 * ⚠️ MÜŞTERİ GİRİŞ SAYFASI (`/giris`) BURAYA KARIŞMAZ. İkisi ayrı kapılar:
 * müşteri kapısında kayıt bağlantısı ve misafir akışı vardır, burada YOKTUR.
 * Aynı oturum tablosunu ve aynı çerezi paylaşırlar — bu bilinçli, çünkü iki
 * ayrı oturum modeli tutmak, birinin iptal edilip diğerinin canlı kalmasına
 * yol açardı.
 */
export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const user = await getSessionUser()

  const { next } = await searchParams
  /**
   * ⚠️ AÇIK YÖNLENDİRME (open redirect) ENGELİ. Yalnızca /admin altındaki
   * site içi yollar kabul edilir. Müşteri giriş sayfasındaki kural site
   * genelinde herhangi bir yola izin verir; burada daha dardır çünkü bu
   * kapıdan geçen kişinin gideceği yer tanımı gereği paneldir.
   */
  const safeNext =
    typeof next === 'string' && /^\/admin\/[a-zA-Z0-9\-/_]*$/.test(next) && next !== '/admin/giris'
      ? next
      : '/admin/fulfillment'

  // Zaten yetkili bir oturum varsa form gösterilmez.
  if (user && ROLE_LEVEL[user.role] >= ROLE_LEVEL.SUPPORT) redirect(safeNext)

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-16">
      {/* ⚠️ `plate` şart: altın logo açık zeminde okunmaz (bkz. Logo.tsx). */}
      <div className="mb-6 flex justify-center">
        <Logo plate />
      </div>

      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-7 shadow-[--shadow-card]">
        {user ? (
          /**
           * ⚠️ OTURUMU AÇIK AMA YETKİSİZ KULLANICI SESSİZCE YÖNLENDİRİLMEZ.
           * Yönlendirilseydi, panelin bozuk olduğunu sanırdı. Burada durumu
           * açıkça görür ve doğru hesapla girebilmesi için çıkış yolu vardır.
           */
          <>
            <h1 className="text-h2 text-ink-900">Yetkiniz yok</h1>
            <p className="mt-2 text-small leading-relaxed text-ink-600">
              <strong>{user.email}</strong> hesabının yönetim paneline erişimi bulunmuyor. Panel
              hesabıyla girmek için önce bu oturumu kapatın.
            </p>
            <div className="mt-5 border-t border-ink-200 pt-4">
              <LogoutButton />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-h2 text-ink-900">Yönetim girişi</h1>
            <p className="mt-2 mb-6 text-small leading-relaxed text-ink-600">
              Bu alan Medya 333 ekibine ayrılmıştır.
            </p>
            <StaffLoginForm next={safeNext} />
          </>
        )}
      </div>

      {/*
        ⚠️ BURADA KAYIT BAĞLANTISI YOKTUR ve olmamalıdır. Panel hesapları
        kendi kendine açılmaz; bir SUPERADMIN tarafından /admin/kullanicilar
        üzerinden verilir. Müşteri giriş sayfasındaki misafir/kayıt
        hatırlatmaları da burada bilinçli olarak bulunmaz.
      */}
      <p className="mt-6 text-center text-caption leading-relaxed text-ink-500">
        Müşteri hesabınıza mı girmek istiyorsunuz? Bu sayfa müşteri girişi değildir.
      </p>
    </div>
  )
}
