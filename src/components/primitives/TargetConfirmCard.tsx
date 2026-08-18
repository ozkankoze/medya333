'use client'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { PlatformMark } from '@/components/wizard/PlatformMark'
import { cn } from '@/lib/utils'
import { formatQuantity } from '@/lib/money'
import type { TargetStatus } from '@/lib/enums'

/**
 * HEDEF ÖNİZLEME / ONAY KARTI
 *
 * Dört durumu tek bileşen yönetir (Faz 0 kararı #2):
 *
 *  VERIFIED    → avatar, isim, @handle, takipçi sayısı + "Doğrulandı" rozeti
 *  UNVERIFIED  → kanonik URL büyük ve net + "Bu hedef doğru" ONAY KUTUSU (zorunlu)
 *  PRIVATE     → hizmet verilemez, akış durur
 *  INVALID     → format hatası + örnek, akış durur
 *
 * UNVERIFIED akışı sipariş vermeyi ENGELLEMEZ — Instagram'da olağan durumdur.
 * Onay kutusu hem UX hem kayıt amaçlıdır: onay `TARGET_CONFIRMED` olayına yazılır.
 */

export interface TargetPreviewData {
  /** Sunucudaki Target kaydının kimliği. Sipariş BU kayda bağlanır.
   *  Çözümleme isteği başarısız olursa (offline fallback) tanımsızdır ve
   *  sipariş oluşturulamaz — kullanıcıdan tekrar denemesi istenir. */
  targetId?: string
  status: TargetStatus
  normalized: string
  canonicalUrl: string
  displayName?: string | null
  handle?: string | null
  avatarUrl?: string | null
  thumbnailUrl?: string | null
  followerCount?: number | null
  message?: string | null
  example?: string | null
}

export function TargetConfirmCard({
  data,
  confirmed,
  onConfirmChange,
  platformName,
  platformSlug,
  brandColor,
}: {
  data: TargetPreviewData
  confirmed: boolean
  onConfirmChange: (v: boolean) => void
  platformName: string
  platformSlug: string
  brandColor?: string | null
}) {
  if (data.status === 'INVALID') {
    return (
      <Card className="border-danger-600/40 bg-danger-100/40 p-4">
        <p className="text-small font-medium text-danger-700">
          {data.message ?? 'Girilen hedef geçersiz.'}
        </p>
        {data.example && (
          <p className="mt-1 text-caption text-ink-600">
            Örnek: <span className="font-mono">{data.example}</span>
          </p>
        )}
      </Card>
    )
  }

  if (data.status === 'PRIVATE') {
    return (
      <Card className="border-danger-600/40 bg-danger-100/40 p-4">
        <p className="text-small font-medium text-danger-700">
          Bu hesap gizli. Hizmet verebilmemiz için hesabın herkese açık olması gerekir.
        </p>
      </Card>
    )
  }

  if (data.status === 'NOT_FOUND') {
    return (
      <Card className="border-danger-600/40 bg-danger-100/40 p-4">
        <p className="text-small font-medium text-danger-700">
          Bu hedef bulunamadı. Bağlantıyı kontrol edip tekrar deneyin.
        </p>
      </Card>
    )
  }

  const isVerified = data.status === 'VERIFIED'

  return (
    <Card
      className={cn(
        'p-4',
        isVerified ? 'border-success-600/30 bg-success-100/25' : 'border-warning-600/30 bg-warning-100/25',
      )}
    >
      <div className="flex items-start gap-3.5">
        {/* Avatar yalnızca doğrulanmış hedefte gelir; yoksa platform markası
            gösterilir — baş harf monogramı "ucuz panel" hissi veriyordu. */}
        <div
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-[--shadow-card]"
          aria-hidden
        >
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <PlatformMark
              slug={platformSlug}
              name={platformName}
              brandColor={brandColor}
              size={22}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body font-semibold text-ink-900">
              {data.displayName ?? (data.handle ? `@${data.handle}` : data.normalized)}
            </span>
            {isVerified ? (
              <Badge tone="success">Doğrulandı</Badge>
            ) : (
              <Badge tone="warning">Doğrulanamadı</Badge>
            )}
          </div>

          {data.handle && data.displayName && (
            <p className="truncate text-small text-ink-600">@{data.handle}</p>
          )}

          {/* Doğrulanamasa bile kullanıcı NEYİ hedeflediğini net görür */}
          <p className="mt-0.5 truncate font-mono text-caption text-ink-500">
            {data.canonicalUrl}
          </p>

          {typeof data.followerCount === 'number' && (
            <p className="mt-1 text-small text-ink-700">
              <span className="tabular font-medium">{formatQuantity(data.followerCount)}</span> takipçi
            </p>
          )}

          {!isVerified && (
            <>
              <p className="mt-2 text-small text-ink-700">
                {data.message ??
                  'Bu platform için otomatik doğrulama yapılamıyor. Hedefin doğru olduğunu kontrol edin.'}
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => onConfirmChange(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:outline-brand-500"
                />
                <span className="text-small font-medium text-ink-800">
                  Bu hedefin doğru olduğunu onaylıyorum
                </span>
              </label>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
