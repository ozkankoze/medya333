import type { Metadata } from 'next'
import { TrackForm } from './TrackForm'

export const metadata: Metadata = {
  title: 'Sipariş Takibi',
  description:
    'Medya 333 siparişinizi sipariş numaranız ve e-posta adresinizle takip edin. Hesap açmanıza gerek yok.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/siparis-takip' },
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

      <div className="mt-8 rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card]">
        <h2 className="text-small font-semibold text-ink-900">
          Sipariş numaranızı bulamıyor musunuz?
        </h2>
        <p className="mt-1.5 text-small leading-relaxed text-ink-600">
          Sipariş numarası <span className="font-mono">M333-</span> ile başlar ve sipariş
          oluşturduğunuzda ekranda gösterilir. Ayrıca sipariş e-postanızda yer alır.
        </p>
        <p className="mt-3 text-caption leading-relaxed text-ink-500">
          Güvenlik gereği sipariş numarası tek başına yeterli değildir; sipariş sırasında
          kullandığınız e-posta adresi de gerekir.
        </p>
      </div>
    </div>
  )
}
