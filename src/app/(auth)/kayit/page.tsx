import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth'
import { RegisterForm } from '../AuthForms'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Kayıt',
  robots: { index: false, follow: false },
}

export default async function RegisterPage() {
  const user = await getSessionUser()
  if (user) redirect('/hesabim')

  return (
    <>
      <h1 className="text-h2 text-ink-900">Hesap oluşturun</h1>
      <p className="mt-2 mb-6 text-small text-ink-600">
        Hesap açmak zorunlu değildir — misafir olarak da sipariş verebilirsiniz.
      </p>
      <RegisterForm />
    </>
  )
}
