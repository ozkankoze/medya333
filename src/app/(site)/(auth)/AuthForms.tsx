'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHint, Input, Label } from '@/components/ui/input'
import { LEGAL_DOCUMENTS } from '@/lib/legal'

/**
 * GİRİŞ / KAYIT FORMLARI
 *
 * Giriş ve kayıt kendi API uçlarımıza gider. E-posta/şifre girişi Auth.js
 * Credentials sağlayıcısını KULLANMAZ — o sağlayıcı veritabanı oturumuyla
 * çalışmıyor (bkz. src/server/auth/session.ts). Oturum satırı sunucuda
 * yazılır; Google girişi Auth.js akışında kalır.
 *
 * ⚠️ Kullanıcı numaralandırma engeli: hem giriş hem kayıt, e-postanın kayıtlı
 * olup olmadığını ELE VERMEYEN mesajlar döndürür.
 */

export function LoginForm({ next = '/hesabim' }: { next?: string }) {
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
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        // Aynı mesaj: e-posta yok mu, şifre mi yanlış — ayırt edilemez.
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
        <Label htmlFor="login-email">E-posta</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          className="mt-1.5"
          value={email}
          invalid={!!error}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="login-password">Şifre</Label>
        <Input
          id="login-password"
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
        {busy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
      </Button>

      <p className="text-center text-small text-ink-600">
        Hesabınız yok mu?{' '}
        <Link href="/kayit" className="font-medium text-brand-700 underline underline-offset-2">
          Kayıt olun
        </Link>
      </p>
      <p className="text-center text-caption text-ink-500">
        Sipariş vermek için hesap açmanız gerekmez.{' '}
        <Link href="/siparis-takip" className="underline underline-offset-2">
          Misafir sipariş takibi
        </Link>
      </p>
    </form>
  )
}

export function RegisterForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
          acceptedTerms: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error?.message ?? 'Kayıt tamamlanamadı.')
        return
      }
      setDone(true)
      // Kayıt sonrası otomatik giriş denenir; başarısız olursa giriş sayfası.
      const signed = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      router.push(signed.ok ? '/hesabim' : '/giris')
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
        <Label htmlFor="reg-name">
          Ad Soyad <span className="font-normal text-ink-500">(isteğe bağlı)</span>
        </Label>
        <Input
          id="reg-name"
          autoComplete="name"
          className="mt-1.5"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="reg-email">E-posta</Label>
        <Input
          id="reg-email"
          type="email"
          autoComplete="email"
          className="mt-1.5"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="reg-password">Şifre</Label>
        <Input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          className="mt-1.5"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FieldHint className="mt-1.5">En az 10 karakter, harf ve rakam içermeli.</FieldHint>
      </div>

      <div className="flex items-start gap-3">
        <input
          id="reg-terms"
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-[6px] border border-ink-300 accent-brand-600"
        />
        <label htmlFor="reg-terms" className="cursor-pointer text-small leading-relaxed text-ink-700">
          <Link
            href={LEGAL_DOCUMENTS.terms.href}
            target="_blank"
            className="font-medium text-brand-700 underline underline-offset-2"
          >
            {LEGAL_DOCUMENTS.terms.title}
          </Link>
          {' ve '}
          <Link
            href={LEGAL_DOCUMENTS.privacy.href}
            target="_blank"
            className="font-medium text-brand-700 underline underline-offset-2"
          >
            {LEGAL_DOCUMENTS.privacy.title}
          </Link>
          ’ni okudum, kabul ediyorum.
        </label>
      </div>

      {error && <FieldError>{error}</FieldError>}

      <Button type="submit" size="lg" block disabled={busy || done || !accepted || !email || !password}>
        {busy ? 'Hesap oluşturuluyor…' : 'Hesap Oluştur'}
      </Button>

      <p className="text-center text-caption leading-relaxed text-ink-500">
        Misafirken verdiğiniz siparişler otomatik olarak hesabınıza bağlanmaz. Güvenlik gereği
        e-postanıza gönderilecek bağlantıyla onaylamanız gerekir.
      </p>
    </form>
  )
}
