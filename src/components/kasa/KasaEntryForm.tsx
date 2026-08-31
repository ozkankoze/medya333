'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { postJson } from '@/lib/http/post-json'
import { parseMajorToMinor } from '@/lib/money'

/**
 * KASA — HAREKET GİRİŞ FORMU
 *
 * ⚠️ TUTAR İSTEMCİDE KURUŞA ÇEVRİLİR, SUNUCUYA TAM SAYI GİDER.
 * Sunucuya "1234,56" gibi bir metin veya ondalıklı sayı gönderilseydi,
 * kayan nokta yuvarlaması yüzünden 1 kuruşluk sapmalar birikirdi.
 * `parseMajorToMinor` projenin geri kalanıyla aynı çevrimi kullanır.
 *
 * ⚠️ KATEGORİ YÖNÜ BELİRLER, KULLANICI DEĞİL.
 * "Gider ama para girişi" gibi bir satır hem bakiyeyi hem kârı ters yönde
 * bozar ve tabloya bakan kimse fark etmez — rakam makul görünür, sadece
 * yanlıştır. Bu yüzden yön formda seçilmez, kategoriden türetilir. Sunucu
 * ayrıca aynı kuralı tekrar doğrular (istemci atlanabilir).
 */

const CATEGORIES = [
  { value: 'SATIS', label: 'Satış', direction: 'IN', allowsCost: true },
  { value: 'TAHSILAT', label: 'Alacak tahsili', direction: 'IN', allowsCost: false },
  { value: 'GIDER', label: 'Gider', direction: 'OUT', allowsCost: false },
  { value: 'MALIYET', label: 'Maliyet / tedarikçi ödemesi', direction: 'OUT', allowsCost: false },
  { value: 'BORC_ODEME', label: 'Borç / taksit ödemesi', direction: 'OUT', allowsCost: false },
  { value: 'DIGER', label: 'Diğer (giriş)', direction: 'IN', allowsCost: false },
] as const

type CategoryValue = (typeof CATEGORIES)[number]['value']

export function KasaEntryForm({ accounts }: { accounts: Array<{ id: string; label: string }> }) {
  const router = useRouter()
  const [category, setCategory] = useState<CategoryValue>('SATIS')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const meta = CATEGORIES.find((c) => c.value === category)!

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setOk(false)

    /**
     * ⚠️⚠️ FORM ELEMANI `await`TEN ÖNCE YAKALANIR. Aşağıda
     * `e.currentTarget.reset()` çağrılıyordu ve React `currentTarget`i
     * senkron bölüm bitince temizlediği için `await` sonrası `null`
     * oluyordu. `TypeError` genel `catch`e düşüp "Bağlantı hatası" olarak
     * gösteriliyordu — oysa HAREKET ZATEN YAZILMIŞTI.
     *
     * ⚠️ BURADA BEDELİ EN AĞIRDI: kullanıcı hata görüp tekrar bastığında
     * AYNI GELİR/GİDER İKİNCİ KEZ deftere düşüyor, yani BANKA BAKİYESİ
     * gerçeğin katına çıkıyordu.
     */
    const formEl = e.currentTarget
    const form = new FormData(formEl)
    const amountRaw = String(form.get('amount') ?? '').trim()
    const costRaw = String(form.get('cost') ?? '').trim()

    let amountMinor: number
    try {
      amountMinor = parseMajorToMinor(amountRaw)
    } catch {
      setError('Tutarı sayı olarak girin (örn. 1.100,00).')
      return
    }
    if (amountMinor <= 0) {
      setError('Tutar sıfırdan büyük olmalıdır.')
      return
    }

    let costMinor: number | null = null
    if (meta.allowsCost && costRaw) {
      try {
        costMinor = parseMajorToMinor(costRaw)
      } catch {
        setError('Maliyeti sayı olarak girin.')
        return
      }
      if (costMinor < 0) {
        setError('Maliyet negatif olamaz.')
        return
      }
    }

    setBusy(true)
    // ⚠️ `postJson` throw etmez; başarı sonrası arayüz işleri `try` dışında.
    const res = await postJson('/api/v1/admin/kasa/entries', {
      accountId: form.get('accountId'),
      occurredAt: form.get('occurredAt'),
      direction: meta.direction,
      category,
      amountMinor,
      description: String(form.get('description') ?? '').trim(),
      customerHandle: String(form.get('customerHandle') ?? '').trim() || null,
      costMinor,
    })
    setBusy(false)

    if (!res.ok) {
      setError(res.message)
      return
    }

    formEl.reset()
    setOk(true)
    // ⚠️ Sunucu bileşenlerini tazeler — bakiye ve döküm anında güncellenir.
    router.refresh()
  }

  const field =
    'w-full rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-900 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
  const label = 'block text-caption font-medium text-ink-600'

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card]"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label} htmlFor="k-category">Kategori</label>
          <select
            id="k-category"
            name="category"
            className={`${field} mt-1`}
            value={category}
            onChange={(ev) => setCategory(ev.target.value as CategoryValue)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <p className="mt-1 text-caption text-ink-500">
            {meta.direction === 'IN' ? 'Para girişi — bakiyeyi artırır' : 'Para çıkışı — bakiyeyi azaltır'}
          </p>
        </div>

        <div>
          <label className={label} htmlFor="k-account">Hesap</label>
          <select id="k-account" name="accountId" required className={`${field} mt-1`}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="k-date">Tarih</label>
          <input
            id="k-date"
            name="occurredAt"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className={`${field} mt-1`}
          />
        </div>

        <div>
          <label className={label} htmlFor="k-amount">Tutar (₺)</label>
          <input
            id="k-amount"
            name="amount"
            inputMode="decimal"
            required
            placeholder="1.100,00"
            className={`${field} mt-1 tabular`}
          />
        </div>

        {/* ⚠️ Maliyet YALNIZCA satış satırında. Gider satırına maliyet yazmak
            kâr hesabında aynı parayı iki kez düşerdi; sunucu da reddeder. */}
        {meta.allowsCost && (
          <div>
            <label className={label} htmlFor="k-cost">Maliyet (₺) — isteğe bağlı</label>
            <input
              id="k-cost"
              name="cost"
              inputMode="decimal"
              placeholder="400,00"
              className={`${field} mt-1 tabular`}
            />
            <p className="mt-1 text-caption text-ink-500">
              Bakiyeyi düşürmez; yalnızca net kâr hesabına girer.
            </p>
          </div>
        )}

        {meta.value === 'SATIS' && (
          <div>
            <label className={label} htmlFor="k-handle">Kullanıcı adı</label>
            <input id="k-handle" name="customerHandle" placeholder="@kullanici" className={`${field} mt-1`} />
          </div>
        )}

        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label} htmlFor="k-desc">İşlem</label>
          <input
            id="k-desc"
            name="description"
            required
            maxLength={500}
            placeholder="Instagram 1000 takipçi"
            className={`${field} mt-1`}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-small text-danger-600">{error}</p>
      )}
      {ok && !error && (
        <p role="status" className="mt-4 text-small text-success-700">Kayıt eklendi.</p>
      )}

      <div className="mt-5">
        <Button type="submit" loading={busy} disabled={busy}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}
