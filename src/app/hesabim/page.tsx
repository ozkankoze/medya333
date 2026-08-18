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
  const completed = past.filter((o) => o.status === 'COMPLETED')
  const other = past.filter((o) => o.status !== 'COMPLETED')

  const greeting = user.name?.trim() ? user.name.split(' ')[0] : null

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">
            {greeting ? `Hoş geldiniz, ${greeting}` : 'Hoş geldiniz'}
          </h1>
          <p className="mt-2 text-small text-ink-600">
            Siparişlerinizi buradan takip edebilirsiniz.
          </p>
        </div>
        <Link href="/#siparis" className={buttonVariants({ variant: 'primary' })}>
          Yeni Sipariş
        </Link>
      </div>

      {/* --------------------------- Özet sayaçları --------------------------- */}
      {orders.length > 0 && (
        <dl className="mt-8 grid grid-cols-3 gap-3" data-testid="account-summary">
          <SummaryTile label="Aktif" value={active.length} />
          <SummaryTile label="Tamamlanan" value={completed.length} />
          <SummaryTile label="Toplam" value={orders.length} />
        </dl>
      )}

      {/* Misafirken verilen siparişleri hesaba bağlama — e-posta eşleşmesi
          TEK BAŞINA yeterli değildir; doğrulanmış bağlantı gerekir. */}
      <div className="mt-6">
        <ClaimBanner token={typeof claim === 'string' ? claim : null} />
      </div>

      {/* ---------------------------- Hesap bilgileri --------------------------- */}
      <section aria-labelledby="hesap-bilgileri" className="mt-8">
        <h2 id="hesap-bilgileri" className="text-h3 text-ink-900">
          Hesap bilgileri
        </h2>
        <dl className="mt-3 divide-y divide-ink-200 rounded-[--radius-card] border border-ink-200 bg-white px-5 shadow-[--shadow-card]">
          <InfoRow label="E-posta" value={user.email} />
          {user.name?.trim() ? <InfoRow label="Ad Soyad" value={user.name} /> : null}
        </dl>
      </section>

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
          {completed.length > 0 && <OrderGroup title="Tamamlanan siparişler" orders={completed} />}
          {other.length > 0 && <OrderGroup title="Sipariş geçmişi" orders={other} />}
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

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-4 shadow-[--shadow-card]">
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="tabular mt-1 text-h2 leading-none text-ink-900">{value}</dd>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-3.5">
      <dt className="text-small text-ink-600">{label}</dt>
      <dd className="text-small font-medium text-ink-900">{value}</dd>
    </div>
  )
}
