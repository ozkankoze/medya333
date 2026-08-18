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
 */
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/giris?next=/yonetim/fulfillment')
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL.SUPPORT) redirect('/hesabim')

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-200 pb-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-h2 text-ink-900">Operasyon</h1>
          <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-caption font-medium text-ink-600">
            {user.role}
          </span>
        </div>
        <nav className="flex items-center gap-1 text-small">
          <Link
            href="/yonetim/fulfillment"
            className="rounded-[--radius-control] px-3 py-2 text-ink-700 hover:bg-ink-100"
          >
            İş Kuyruğu
          </Link>
          <Link
            href="/yonetim/katalog"
            className="rounded-[--radius-control] px-3 py-2 text-ink-700 hover:bg-ink-100"
          >
            Katalog
          </Link>
          <Link
            href="/hesabim"
            className="rounded-[--radius-control] px-3 py-2 text-ink-600 hover:bg-ink-100"
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
