import type { Metadata } from 'next'
import { TrackForm } from './TrackForm'

export const metadata: Metadata = {
  title: 'Sipariş Takibi',
  description: 'Sipariş numaranız ve e-posta adresinizle siparişinizi takip edin.',
  robots: { index: true, follow: true },
}

export const dynamic = 'force-dynamic'

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ o?: string }>
}) {
  const { o } = await searchParams

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="text-h1 text-ink-900">Sipariş Takibi</h1>
      <p className="mt-3 text-body leading-relaxed text-ink-600">
        Hesap açmanıza gerek yok. Sipariş numaranız ve sipariş sırasında kullandığınız e-posta
        adresiyle siparişinizin durumunu görebilirsiniz.
      </p>

      <div className="mt-8">
        <TrackForm initialOrderNo={typeof o === 'string' ? o.slice(0, 20).toUpperCase() : ''} />
      </div>
    </div>
  )
}
