'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/lib/http/post-json'
import { parseMajorToMinor } from '@/lib/money'

/**
 * ⭐ HIZLI GELİR / GİDER GİRİŞİ — "latte aldım, 120 ₺"
 *
 * ⚠️ TASARIM AMACI: TEK SATIRDA BİTMESİ. Günlük küçük harcamalar,
 * girilmesi zahmetliyse hiç girilmez; girilmeyen gider de ay sonunda
 * "para nereye gitti?" sorusunu cevapsız bırakır. Bu yüzden form dört
 * alandan ibaret: ne, ne kadar, hangi hesap, gelir mi gider mi.
 *
 * ⚠️⚠️ HESAP SEÇİMİ ZORUNLU VE VARSAYILANI YOK. "İlk hesabı seç" gibi bir
 * kolaylık, paranın yanlış bankadan düşmesine yol açar ve bu hata ancak
 * ay sonu mutabakatında fark edilir — o zamana kadar bakiye yanlıştır.
 *
 * ⚠️ KATEGORİ AÇIKTA DURUR. Gizlenip hep "GIDER" yazılsaydı tedarikçi
 * ödemesi (MALIYET) ile kahve (GIDER) aynı kutuya girer, kâr hesabında
 * satışın maliyeti ile işletme gideri ayrılamaz hale gelirdi.
 */

/**
 * ⚠️ FORM ELEMANI OLAYIN SENKRON ANINDA YAKALANIR.
 * React sentetik olayın `currentTarget`ini işleyicinin senkron bölümü
 * bitince temizler; `await`ten sonra kullanmak `TypeError` üretir ve bu
 * hata bu projede "Bağlantı hatası" diye görünüp kaydın oluştuğunu
 * gizlemişti.
 */
function withForm(fn: (form: HTMLFormElement) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    fn(e.currentTarget)
  }
}

const GIDER_KATEGORI = [
  { value: 'GIDER', label: 'Gider (kahve, ulaşım, fatura…)' },
  { value: 'MALIYET', label: 'Maliyet (tedarikçi / panel ödemesi)' },
  { value: 'BORC_ODEME', label: 'Borç ödeme (kredi, taksit, kart)' },
] as const

const GELIR_KATEGORI = [
  { value: 'SATIS', label: 'Satış (ciroya girer)' },
  { value: 'TAHSILAT', label: 'Alacak tahsili (ciroya girmez)' },
  { value: 'DIGER', label: 'Diğer' },
] as const

export function HizliHareketForm({
  accounts,
}: {
  accounts: ReadonlyArray<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [yon, setYon] = useState<'OUT' | 'IN'>('OUT')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const kategoriler = yon === 'OUT' ? GIDER_KATEGORI : GELIR_KATEGORI

  async function gonder(formEl: HTMLFormElement) {
    const data = new FormData(formEl)
    setError(null)
    setOk(null)

    let amountMinor: number
    try {
      amountMinor = parseMajorToMinor(String(data.get('tutar') ?? ''))
    } catch {
      setError('Tutarı sayı olarak gir (örn. 120,00).')
      return
    }
    if (amountMinor <= 0) {
      setError('Tutar sıfırdan büyük olmalı.')
      return
    }

    const accountId = String(data.get('accountId') ?? '')
    if (!accountId) {
      setError('Hangi hesaptan/hesaba olduğunu seç.')
      return
    }

    setBusy(true)
    const res = await postJson('/api/v1/admin/kasa/entries', {
      accountId,
      occurredAt: data.get('occurredAt'),
      direction: yon,
      category: data.get('category'),
      amountMinor,
      description: data.get('description'),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }

    /**
     * ⚠️ TUTAR VE AÇIKLAMA TEMİZLENİR, HESAP VE TARİH KALIR. Arka arkaya
     * beş gider giren biri hesabı her seferinde yeniden seçmek zorunda
     * kalsaydı, üçüncüsünde vazgeçerdi.
     */
    for (const name of ['tutar', 'description']) {
      const el = formEl.elements.namedItem(name)
      if (el instanceof HTMLInputElement) el.value = ''
    }
    setOk(yon === 'OUT' ? 'Gider eklendi.' : 'Gelir eklendi.')
    router.refresh()
  }

  const field =
    'w-full rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-900'
  const label = 'block text-caption font-medium text-ink-600'
  const today = new Date().toISOString().slice(0, 10)

  const tab = (active: boolean) =>
    'rounded-[--radius-control] px-3 py-1.5 text-small font-medium transition-colors ' +
    (active ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-ink-100')

  return (
    <form
      onSubmit={withForm((form) => void gonder(form))}
      className="rounded-[--radius-card] border border-ink-200 bg-white p-4 shadow-[--shadow-card]"
    >
      {/* ⚠️ YÖN EN BAŞTA VE İKİ DÜĞME. Açılır listede gizlenseydi, yanlış
          yönde girilen bir hareket bakiyeyi ters yönde bozardı ve fark
          edilmesi zor olurdu. */}
      <div className="flex gap-1.5 rounded-[--radius-control] bg-ink-100 p-1" role="group" aria-label="Hareket yönü">
        <button type="button" className={tab(yon === 'OUT')} onClick={() => setYon('OUT')}>
          − Gider
        </button>
        <button type="button" className={tab(yon === 'IN')} onClick={() => setYon('IN')}>
          + Gelir
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className={label} htmlFor="h-desc">Ne için?</label>
          <input id="h-desc" name="description" required maxLength={500}
            placeholder={yon === 'OUT' ? 'Latte' : 'Danışmanlık'} className={`${field} mt-1`} />
        </div>
        <div>
          <label className={label} htmlFor="h-tutar">Tutar (₺)</label>
          <input id="h-tutar" name="tutar" inputMode="decimal" required placeholder="120,00"
            className={`${field} tabular mt-1`} />
        </div>
        <div>
          <label className={label} htmlFor="h-hesap">Hesap</label>
          <select id="h-hesap" name="accountId" required defaultValue="" className={`${field} mt-1`}>
            {/* ⚠️ Boş varsayılan bilinçli — yanlış hesaba yazma riski. */}
            <option value="">Seç…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="h-tarih">Tarih</label>
          <input id="h-tarih" name="occurredAt" type="date" required defaultValue={today}
            className={`${field} mt-1`} />
        </div>
        <div className="lg:col-span-2">
          <label className={label} htmlFor="h-kategori">Tür</label>
          <select
            id="h-kategori"
            name="category"
            // ⚠️ `key` ŞART: yön değişince React aynı `select`i yeniden
            //    kullanır ve eski seçim (örn. GIDER) yeni listede
            //    olmadığı hâlde gönderilmeye devam ederdi.
            key={yon}
            defaultValue={kategoriler[0].value}
            className={`${field} mt-1`}
          >
            {kategoriler.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-small text-danger-600">{error}</p>}
      {ok && !error && <p role="status" className="mt-3 text-small text-success-700">{ok}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-[--radius-control] bg-ink-900 px-4 py-2 text-small font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {busy ? '…' : yon === 'OUT' ? 'Gideri kaydet' : 'Geliri kaydet'}
        </button>
        <p className="text-caption text-ink-500">
          Kaydettiğin anda seçtiğin hesabın bakiyesi{' '}
          <strong>{yon === 'OUT' ? 'düşer' : 'artar'}</strong>.
        </p>
      </div>
    </form>
  )
}
