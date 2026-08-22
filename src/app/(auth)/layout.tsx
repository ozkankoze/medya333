import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'

/**
 * GİRİŞ / KAYIT DÜZENİ
 *
 * Sade, tek odaklı kart. ⚠️ Misafir sipariş akışı burada KAYBOLMAZ:
 * kartın altında "hesap açmadan sipariş" hatırlatması vardır.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-16">
      {/* ⚠️ `plate` şart: altın logo açık zeminde okunmaz (bkz. Logo.tsx). */}
      <div className="mb-6 flex justify-center">
        <Logo plate />
      </div>

      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-7 shadow-[--shadow-card]">
        {children}
      </div>

      <p className="mt-6 text-center text-caption leading-relaxed text-ink-500">
        Sipariş vermek için hesap açmanız gerekmez.{' '}
        <Link href="/#siparis" className="text-brand-600 underline underline-offset-2">
          Misafir olarak devam edin
        </Link>{' '}
        veya{' '}
        <Link href="/siparis-takip" className="text-brand-600 underline underline-offset-2">
          siparişinizi takip edin
        </Link>
        .
      </p>
    </div>
  )
}
