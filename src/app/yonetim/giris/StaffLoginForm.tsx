'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FieldError, Input, Label } from '@/components/ui/input'

/**
 * PERSONEL GİRİŞ FORMU
 *
 * ⚠️ BU FORM MÜŞTERİ FORMUNUN KOPYASI DEĞİL, KASITLI OLARAK DAHA AZIDIR.
 * Burada BULUNMAYANLAR ve nedenleri:
 *
 *   · "Kayıt olun" bağlantısı — panel hesapları kendi kendine açılmaz;
 *     bir SUPERADMIN tarafından verilir. Bağlantıyı koymak, var olmayan
 *     bir akışı vaat etmek olurdu.
 *   · "Misafir sipariş takibi" / "hesap açmadan sipariş" — bunlar müşteri
 *     akışıdır ve personel kapısında yeri yoktur.
 *   · Google ile giriş — panel erişimi rolle verilir; OAuth ile gelen
 *     yeni bir hesabın rolü CUSTOMER olur ve kapıya zaten takılır.
 *     Düğmeyi göstermek, çalışmayacak bir yolu göstermektir.
 *
 * ⚠️ `next` SUNUCUDA TEMİZLENİR (bkz. page.tsx). Buraya gelen değer zaten
 * site içi bir yoldur; istemcide tekrar doğrulanmaz çünkü istemci tarafı
 * doğrulama bir güvenlik sınırı değildir.
 */
export function StaffLoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/auth/yonetim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        // ⚠️ Sunucu üç başarısızlığı ayırt etmez; istemci de etmemeli.
        setError(json?.error?.message ?? 'E-posta veya şifre hatalı.')
        return
      }
      router.push(next)
      router.refresh()
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="staff-email">E-posta</Label>
        <Input
          id="staff-email"
          type="email"
          autoComplete="email"
          className="mt-1.5"
          value={email}
          invalid={!!error}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="staff-password">Şifre</Label>
        <Input
          id="staff-password"
          type="password"
          autoComplete="current-password"
          className="mt-1.5"
          value={password}
          invalid={!!error}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && <FieldError>{error}</FieldError>}

      <Button type="submit" size="lg" block disabled={busy || !email || !password}>
        {busy ? 'Giriş yapılıyor…' : 'Panele Giriş'}
      </Button>
    </form>
  )
}
