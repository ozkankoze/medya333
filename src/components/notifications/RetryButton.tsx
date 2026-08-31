'use client'

import { Button } from '@/components/ui/button'
import { useAdminMutation } from '@/components/admin/admin-client'

/**
 * BAŞARISIZ BİLDİRİMİ ELLE YENİDEN GÖNDER
 *
 * ⚠️ TEK TIK = TEK DENEME. Otomatik tekrar döngüsü yoktur: sağlayıcı
 * yapılandırılmamışken çalışan bir retry kuyruğu, saatte binlerce başarısız
 * denemeden başka bir şey üretmez.
 *
 * ⚠️ Sunucu yalnızca `FAILED` kayıtlarda çalışır ve yeni bildirim satırı
 * AÇMAZ — idempotency kısıtı yeniden denemeden sonra da geçerlidir.
 */
export function RetryButton({ id, orderNo }: { id: string; orderNo: string }) {
  const m = useAdminMutation()

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={m.busy}
        data-testid={`retry-${orderNo}`}
        onClick={() => void m.send(`/api/v1/admin/notifications/${id}/retry`, 'POST')}
      >
        {m.busy ? 'Deneniyor…' : 'Yeniden gönder'}
      </Button>
      {m.error && <span className="text-caption text-danger-700">{m.error}</span>}
    </div>
  )
}
