import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Money } from '@/components/primitives/Money'
import { ProgressBar } from '@/components/primitives/ProgressBar'
import { StatusBadge } from '@/components/primitives/StatusBadge'
import { buttonVariants } from '@/components/ui/button'
import { withUnit } from '@/lib/units'
import { getSessionUser } from '@/server/auth'
import { listOrdersForUser } from '@/server/orders/lookup'
import { ClaimBanner } from './ClaimBanner'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Hesabım',
  robots: { index: false, follow: false },
}

/**
 * /hesabim — MÜŞTERİ PANELİ
 *
 * ⚠️ IDOR: Sipariş listesi `listOrdersForUser(userId)` ile alınır; kullanıcı
 * kapsamı SORGUNUN İÇİNDEDİR. URL üzerinden başka kullanıcının siparişine
 * ulaşmanın yolu yoktur.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/giris?next=/hesabim')

  const { claim } = await searchParams
  const orders = await listOrdersForUser(user.id)
  const active = orders.filter((o) => o.isActive)
  const past = orders.filter((o) => !o.isActive)

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">Siparişlerim</h1>
          <p className="mt-2 text-small text-ink-600">{user.email}</p>
        </div>
        <Link href="/" className={buttonVariants({ variant: 'primary' })}>
          Yeni Sipariş
        </Link>
      </div>

      {/* Misafirken verilen siparişleri hesaba bağlama — e-posta eşleşmesi
          TEK BAŞINA yeterli değildir; doğrulanmış bağlantı gerekir. */}
      <div className="mt-6">
        <ClaimBanner token={typeof claim === 'string' ? claim : null} />
      </div>

      {orders.length === 0 ? (
        <div className="mt-10 rounded-[--radius-card] border border-dashed border-ink-200 bg-white p-10 text-center">
          <p className="text-body text-ink-700">Henüz siparişiniz yok.</p>
          <p className="mt-1 text-small text-ink-500">
            İlk siparişinizi oluşturmak için platform ve hizmet seçin.
          </p>
          <Link href="/" className={`${buttonVariants({ size: 'lg' })} mt-6`}>
            Sipariş Oluştur
          </Link>
        </div>
      ) : (
        <div className="mt-10 flex flex-col gap-10">
          {active.length > 0 && <OrderGroup title="Aktif siparişler" orders={active} />}
          {past.length > 0 && <OrderGroup title="Geçmiş siparişler" orders={past} />}
        </div>
      )}
    </div>
  )
}

type OrderRow = Awaited<ReturnType<typeof listOrdersForUser>>[number]

function OrderGroup({ title, orders }: { title: string; orders: OrderRow[] }) {
  return (
    <section>
      <h2 className="text-h3 text-ink-900">{title}</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {orders.map((o) => (
          <li key={o.orderNo}>
            <Link
              href={`/siparisler/${o.orderNo}`}
              className="block rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card] transition-shadow hover:shadow-[--shadow-lifted]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-body font-semibold text-ink-900">
                    {o.platformName} · {o.serviceName}
                  </p>
                  <p className="mt-0.5 text-small text-ink-600">
                    {withUnit(o.quantity, o.unitLabel)}
                    {o.targetHandle ? ` · @${o.targetHandle}` : ''}
                  </p>
                  <p className="mt-1 font-mono text-caption text-ink-400">{o.orderNo}</p>
                </div>
                <div className="text-right">
                  <StatusBadge status={o.status} />
                  <p className="mt-2 text-body font-semibold text-ink-900">
                    <Money minor={o.totalMinor} />
                  </p>
                </div>
              </div>

              {o.status === 'PENDING_PAYMENT' && (
                <p className="mt-3 text-caption text-warning-700">
                  Ödeme bekleniyor — tamamlamak için siparişi açın.
                </p>
              )}

              {o.deliveredQuantity > 0 && (
                <div className="mt-4">
                  <ProgressBar
                    quantity={o.quantity}
                    deliveredQuantity={o.deliveredQuantity}
                    showLabels={false}
                  />
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
