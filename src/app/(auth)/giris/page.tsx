import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth'
import { LoginForm } from '../AuthForms'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Giriş',
  robots: { index: false, follow: false },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const user = await getSessionUser()
  if (user) redirect('/hesabim')

  const { next } = await searchParams
  // Açık yönlendirme (open redirect) engeli: yalnızca site içi yollar kabul edilir.
  const safeNext = typeof next === 'string' && /^\/[a-zA-Z0-9\-/_]*$/.test(next) ? next : '/hesabim'

  return (
    <>
      <h1 className="text-h2 text-ink-900">Giriş yapın</h1>
      <p className="mt-2 mb-6 text-small text-ink-600">
        Siparişlerinizi tek yerden takip edin.
      </p>
      <LoginForm next={safeNext} />
    </>
  )
}
