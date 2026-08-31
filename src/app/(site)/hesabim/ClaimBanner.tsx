'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * MİSAFİR SİPARİŞLERİNİ HESABA BAĞLAMA
 *
 * ⚠️ Yalnızca e-posta eşleşmesi YETMEZ. Devralma iki koşuldan biriyle olur:
 *   • Kullanıcının e-postası doğrulanmış, veya
 *   • E-postaya gönderilen tek kullanımlık bağlantıdaki token
 *
 * URL'de `?claim=<token>` varsa otomatik denenir.
 */
export function ClaimBanner({ token }: { token: string | null }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function claim(withToken: string | null) {
    setState('busy')
    try {
      const res = await fetch('/api/v1/me/claim-guest-orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: withToken }),
      })
      const json = await res.json()
      if (!res.ok) {
        setState('error')
        setMessage(json?.error?.message ?? 'Siparişler bağlanamadı.')
        return
      }
      setState('done')
      setMessage(`${json.claimedOrders} sipariş hesabınıza bağlandı.`)
      router.refresh()
    } catch {
      setState('error')
      setMessage('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    }
  }

  useEffect(() => {
    if (token) void claim(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (state === 'idle' && !token) {
    return (
      <details className="rounded-[--radius-card] border border-ink-200 bg-white p-5">
        <summary className="cursor-pointer text-small font-medium text-ink-800">
          Hesap açmadan önce sipariş verdiyseniz
        </summary>
        <p className="mt-3 text-small leading-relaxed text-ink-600">
          Güvenlik gereği geçmiş siparişler yalnızca <strong>doğrulanmış e-posta</strong> ya da
          e-postanıza gönderdiğimiz tek kullanımlık bağlantıyla hesabınıza bağlanır. Sadece aynı
          e-posta adresini kullanmak yeterli değildir.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => void claim(null)}
          disabled={state !== 'idle'}
        >
          Siparişlerimi bağla
        </Button>
      </details>
    )
  }

  if (state === 'done') {
    return (
      <div className="rounded-[--radius-card] border border-success-600/30 bg-success-100 p-4 text-small text-success-700">
        {message}
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div
        role="alert"
        className="rounded-[--radius-card] border border-danger-600/30 bg-danger-100 p-4 text-small text-danger-700"
      >
        {message}
      </div>
    )
  }

  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-4 text-small text-ink-600">
      Siparişleriniz hesabınıza bağlanıyor…
    </div>
  )
}
