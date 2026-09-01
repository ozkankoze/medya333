'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ORDER_STATUSES, ORDER_STATUS_LABEL } from '@/lib/kasa/orders'
import { postJson } from '@/lib/http/post-json'
import { formatMinor, parseMajorToMinor } from '@/lib/money'

/**
 * SİPARİŞ GİRİŞ FORMU (elle defter)
 *
 * ⚠️ NET KÂR YAZILMAZ, HESAPLANIR. Kullanıcı tutar ve maliyeti girer; kâr
 * anında türetilir. Ayrı bir alan olsaydı üçü birbiriyle çelişebilirdi.
 *
 * ⚠️⚠️ "ÖDEME" KUTUSU — TEK KUTU, İKİ ANLAM:
 *     "12.09.2026" → para BEKLENİYOR. Kasaya hiçbir hareket yazılmaz;
 *                    satır ana sayfada ALACAK olarak görünür.
 *     "yapıkredi"  → para GELDİ. O hesaba gelir hareketi yazılır ve
 *                    banka bakiyesi ARTAR.
 *     boş          → hiçbiri.
 *
 * ⚠️ "ÖDENDİ" DİYE İŞARETLENEBİLEN BİR KUTU YOKTUR ve olmamalıdır. Hesap
 * adı yazmadan "ödendi" denebilseydi, kasaya hiçbir hareket yazılmadan
 * sipariş tahsil edilmiş görünürdü — bakiye ile defter ayrışırdı. Para
 * geldi demek, hangi hesaba geldiğini söylemek zorundadır.
 */
export function ManualOrderForm() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [uyari, setUyari] = useState<string | null>(null)
  const [sale, setSale] = useState('')
  const [cost, setCost] = useState('')

  /** Canlı net kâr önizlemesi — girdiler bozuksa gösterilmez. */
  let netPreview: string | null = null
  try {
    if (sale.trim()) {
      const s = parseMajorToMinor(sale)
      const c = cost.trim() ? parseMajorToMinor(cost) : 0
      netPreview = formatMinor(s - c)
    }
  } catch {
    netPreview = null
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setOk(false)
    setUyari(null)
    const form = e.currentTarget
    const data = new FormData(form)

    let salePriceMinor: number
    let costMinor: number
    try {
      salePriceMinor = parseMajorToMinor(String(data.get('sale') ?? ''))
      const c = String(data.get('cost') ?? '').trim()
      costMinor = c ? parseMajorToMinor(c) : 0
    } catch {
      setError('Tutarları sayı olarak girin (örn. 1.250,00).')
      return
    }
    if (salePriceMinor < 0 || costMinor < 0) {
      setError('Tutarlar negatif olamaz.')
      return
    }

    setBusy(true)
    // ⚠️ `postJson` throw etmez; başarı sonrası arayüz işleri `try` dışında.
    //    (Bu formda `form` zaten `await`ten önce yakalanmıştı, ama genel
    //    `catch` yine de her hatayı "bağlantı hatası" diye gösteriyordu.)
    const res = await postJson('/api/v1/admin/kasa/siparisler', {
      customerName: data.get('customerName'),
      description: data.get('description'),
      occurredAt: data.get('occurredAt'),
      salePriceMinor,
      costMinor,
      status: data.get('status'),
      odeme: data.get('odeme'),
    })
    setBusy(false)

    if (!res.ok) {
      setError(res.message)
      return
    }

    /**
     * ⚠️ SİPARİŞ YAZILDI AMA ÖDEME KUTUSU ANLAŞILMADIYSA, BU BİR HATA
     * DEĞİL UYARIDIR. Satır kaydedildi; yalnızca ödeme kısmı uygulanamadı.
     * "Hata" diye gösterilseydi kullanıcı satırı ikinci kez girer ve
     * defterde çift kayıt oluşurdu.
     */
    const body = res.data as { odemeHatasi?: string | null; odeme?: { kind: string } | null }
    form.reset()
    setSale('')
    setCost('')
    setOk(true)
    setUyari(body?.odemeHatasi ?? null)
    router.refresh()
  }

  const field =
    'w-full rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-900 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
  const label = 'block text-caption font-medium text-ink-600'
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card]"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label} htmlFor="o-customer">Kullanıcı adı</label>
          <input id="o-customer" name="customerName" required maxLength={200}
            placeholder="@kullaniciadi" className={`${field} mt-1`} />
        </div>
        {/*
          ⚠️ SIRALAMA: kim → ne → ne zaman. "Sipariş içeriği" kullanıcı
          adının hemen yanındadır çünkü satırı okunur kılan şey odur;
          tutarların arasına konsaydı, para alanlarını doldururken
          atlanması kolay olurdu.

          ⚠️ ZORUNLU (`required`). İsteğe bağlı olsaydı pratikte çoğu satır
          boş kalır ve defter birkaç hafta sonra okunamaz hâle gelirdi:
          aynı müşteriye aynı gün girilen iki satır ayırt edilemezdi.
          Tarayıcı doğrulaması tek başına yeterli değildir — sunucu ve
          veritabanı da boş değeri reddeder.
        */}
        <div>
          <label className={label} htmlFor="o-content">Sipariş içeriği</label>
          <input id="o-content" name="description" required maxLength={300}
            placeholder="Instagram 10K Türk takipçi" className={`${field} mt-1`} />
        </div>
        <div>
          <label className={label} htmlFor="o-date">Tarih</label>
          <input id="o-date" name="occurredAt" type="date" required defaultValue={today}
            className={`${field} mt-1`} />
        </div>
        <div>
          <label className={label} htmlFor="o-status">Sipariş durumu</label>
          <select id="o-status" name="status" defaultValue="BEKLIYOR" className={`${field} mt-1`}>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="o-sale">Sipariş tutarı (₺)</label>
          <input id="o-sale" name="sale" inputMode="decimal" required placeholder="1.250,00"
            value={sale} onChange={(ev) => setSale(ev.target.value)}
            className={`${field} mt-1 tabular`} />
        </div>
        <div>
          <label className={label} htmlFor="o-cost">Maliyet (₺)</label>
          <input id="o-cost" name="cost" inputMode="decimal" placeholder="400,00"
            value={cost} onChange={(ev) => setCost(ev.target.value)}
            className={`${field} mt-1 tabular`} />
        </div>
        {/*
          ⚠️ ÖDEME KUTUSU TUTARLARIN YANINDA, EN SONDA. Sıralama tabloyla
          birebir aynı: kim → ne → ne zaman → fiyat → maliyet → net → ödeme.
          Formu doldururken göz, sonra bakacağı tabloyla aynı yolu izler.
        */}
        <div>
          <label className={label} htmlFor="o-odeme">Ödeme</label>
          <input id="o-odeme" name="odeme" maxLength={60}
            placeholder="12.09.2026 ya da Yapıkredi" className={`${field} mt-1`} />
          <p className="mt-1 text-caption leading-snug text-ink-500">
            Tarih yazarsan <strong>alacak</strong> olur, hesap adı yazarsan o hesaba{' '}
            <strong>gelir</strong> yazılır.
          </p>
        </div>

        <div>
          <span className={label}>Net kâr</span>
          {/* ⚠️ Girilmez, hesaplanır. */}
          <p className="tabular mt-1 rounded-[--radius-control] border border-dashed border-ink-300 bg-ink-50 px-3 py-2 text-small font-semibold text-ink-900">
            {netPreview ?? '—'}
          </p>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-small text-danger-600">{error}</p>}
      {ok && !error && (
        <p role="status" className="mt-4 text-small text-success-700">Sipariş eklendi.</p>
      )}
      {uyari && (
        <p role="alert" className="mt-2 text-small text-warning-700">
          Sipariş kaydedildi, ama ödeme kutusu uygulanamadı: {uyari}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="submit" loading={busy} disabled={busy}>Siparişi Kaydet</Button>
        <p className="text-caption text-ink-500">
          Ödeme kutusu boşsa ya da tarihliyse banka bakiyesi{' '}
          <strong>değişmez</strong>. Bakiye yalnızca hesap adı yazıldığında artar.
        </p>
      </div>
    </form>
  )
}
