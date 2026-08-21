'use client'

import { useState } from 'react'
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
    <TargetCardBody
      data={data}
      isVerified={isVerified}
      confirmed={confirmed}
      onConfirmChange={onConfirmChange}
      platformName={platformName}
      platformSlug={platformSlug}
      {...(brandColor !== undefined ? { brandColor } : {})}
    />
  )
}

/**
 * ⚠️ AYRI BİLEŞEN — `useState` erken `return`'lerden SONRA çağrılamaz.
 *
 * INVALID/PRIVATE/NOT_FOUND dalları yukarıda erken dönüyor; görsel hata
 * durumunu tutan hook'u orada tanımlamak React'in hook sırası kuralını
 * ihlal ederdi. Gövde ayrı bir bileşene alınarak hook koşulsuz hâle geldi.
 */
function TargetCardBody({
  data,
  isVerified,
  confirmed,
  onConfirmChange,
  platformName,
  platformSlug,
  brandColor,
}: {
  data: TargetPreviewData
  isVerified: boolean
  confirmed: boolean
  onConfirmChange: (v: boolean) => void
  platformName: string
  platformSlug: string
  brandColor?: string | null
}) {
  /**
   * Görseller media-proxy'den gelir ve orada TTL'i dolmuş olabilir (404).
   * Kırık `<img>` ikonu göstermek yerine sessizce marka logosuna /
   * placeholder'a düşeriz — hedefin DOĞRULUĞU görselden bağımsızdır.
   */
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [postBroken, setPostBroken] = useState(false)

  const showAvatar = Boolean(data.avatarUrl) && !avatarBroken
  const showPost = Boolean(data.thumbnailUrl) && !postBroken

  return (
    <Card
      className={cn(
        'p-4',
        isVerified ? 'border-success-600/30 bg-success-100/25' : 'border-warning-600/30 bg-warning-100/25',
      )}
    >
      <div className="flex items-start gap-3.5">
        {/* Avatar yalnızca doğrulanmış hedefte gelir; yoksa platform markası
            gösterilir — baş harf monogramı "ucuz panel" hissi veriyordu.

            ⚠️ ADRES HER ZAMAN KENDİ MEDIA-PROXY'MİZDİR. Instagram CDN adresi
            buraya asla ulaşmaz (bkz. server/media/avatar-store.ts): imzalı
            adres hem süresi dolunca kırılır hem müşteri IP'sini Meta'ya
            sızdırırdı. */}
        <div
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-[--shadow-card] sm:size-20"
          aria-hidden
        >
          {showAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatarUrl ?? ''}
              alt=""
              width={80}
              height={80}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="size-full object-cover"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <PlatformMark
              slug={platformSlug}
              name={platformName}
              brandColor={brandColor}
              size={30}
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

      {/* ================= GÖNDERİ GÖRSELİ ================= */}
      {showPost && (
        <figure className="mt-3.5">
          <div className="relative w-full max-w-[280px] overflow-hidden rounded-xl bg-ink-100 shadow-[--shadow-card]">
            {/**
             * ⚠️ ORAN KORUNUR. Instagram gönderileri kare, dikey (4:5) veya
             * yatay olabilir; sabit yükseklik vermek görseli ezerdi.
             * `aspect-square` + `object-cover` kırpar ama BOZMAZ.
             */}
            <div className="aspect-square w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.thumbnailUrl ?? ''}
                alt="Gönderi önizlemesi"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="size-full object-cover"
                onError={() => setPostBroken(true)}
              />
            </div>
          </div>
        </figure>
      )}

      {/**
       * ⚠️ GÖRSEL YOKSA KIRIK `<img>` GÖSTERİLMEZ.
       *
       * Yalnızca gönderi/video hedeflerinde ve görsel gerçekten alınamadığında
       * nötr bir yer tutucu çıkar. Bu, hedefin GEÇERSİZ olduğu anlamına
       * gelmez — önizleme ayrı, doğrulama ayrıdır.
       */}
      {!showPost && data.thumbnailUrl === null && isPostLike(data.canonicalUrl) && (
        <div className="mt-3.5 flex w-full max-w-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 bg-ink-50 px-4 py-6 text-center">
          <PlatformMark
            slug={platformSlug}
            name={platformName}
            brandColor={brandColor}
            size={24}
          />
          <p className="text-caption text-ink-500">
            Gönderi önizlemesi alınamıyor. Bağlantının doğru olduğunu kontrol edin.
          </p>
        </div>
      )}
    </Card>
  )
}

/** Kanonik adres bir gönderi/reel/video mu? (yer tutucu yalnızca onlarda) */
function isPostLike(canonicalUrl: string): boolean {
  return /\/(p|reel|reels|tv|video|shorts|status)\//.test(canonicalUrl)
}
