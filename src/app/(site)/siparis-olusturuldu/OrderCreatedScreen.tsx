'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { OrderSuccess } from '@/components/wizard/OrderSuccess'

export const ORDER_CREATED_STORAGE_KEY = 'medya333:son-siparis'

export interface CreatedOrderPayload {
  orderNo: string
  totalMinor: number
  trackingToken: string | null
  email: string
  summary: string
  /** ⚠️ Sunucu e-postayı GERÇEKTEN gönderebildi mi? Ekran iddiasını buna kurar. */
  emailSent?: boolean
}

export function OrderCreatedScreen() {
  const router = useRouter()
  const [data, setData] = useState<CreatedOrderPayload | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ORDER_CREATED_STORAGE_KEY)
      if (raw) setData(JSON.parse(raw) as CreatedOrderPayload)
    } catch {
      /* bozuk kayıt → aşağıdaki yönlendirme devreye girer */
    }
    setReady(true)
  }, [])

  // Doğrudan URL ile gelinirse gösterilecek sipariş yoktur.
  useEffect(() => {
    if (ready && !data) router.replace('/siparis-takip')
  }, [ready, data, router])

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20 text-center text-small text-ink-500">
        Yönlendiriliyorsunuz…
      </div>
    )
  }

  return (
    <OrderSuccess
      orderNo={data.orderNo}
      totalMinor={data.totalMinor}
      trackingToken={data.trackingToken}
      email={data.email}
      summary={data.summary}
      emailSent={data.emailSent ?? false}
      onNewOrder={() => {
        try {
          sessionStorage.removeItem(ORDER_CREATED_STORAGE_KEY)
        } catch {
          /* yoksay */
        }
        router.push('/')
      }}
    />
  )
}
