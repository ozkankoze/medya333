import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { KasaTabs } from '@/components/kasa/KasaTabs'
import { ORDER_STATUS_LABEL, type ManualOrderStatus } from '@/lib/kasa/orders'
import { formatMinor } from '@/lib/money'
import { getSessionUser } from '@/server/auth'
import { musteriDefteri } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Müşteri geçmişi',
  robots: { index: false, follow: false },
}

const STATUS_CLASS: Record<ManualOrderStatus, string> = {
  BEKLIYOR: 'bg-ink-100 text-ink-700',
  DEVAM_EDIYOR: 'bg-warning-100 text-warning-700',
  TAMAMLANDI: 'bg-success-100 text-success-700',
  IPTAL: 'bg-danger-100 text-danger-700',
}

/**
 * /admin/kasa/siparisler/musteri/[isim] — TEK MÜŞTERİNİN GEÇMİŞİ
 *
 * ⚠️ SALT OKUMA EKRANI. Düzenleme ve silme bilerek yoktur: bir satırı
 * değiştirmek defterin kendi ekranında yapılır. İki yerde düzenleme
 * olsaydı, hangi ekranın neyi değiştirdiği zamanla bulanıklaşırdı.
 *
 * ⚠️ MÜŞTERİ TABLOSU YOKTUR, ölçüt ADIN KENDİSİDİR. Bu defterde müşteri
 * kaydı tutulmuyor; aynı kişi iki farklı yazımla girildiyse iki ayrı
 * geçmiş görünür. Çözümü sipariş formundaki öneri listesidir, burada
 * tahmin yürütmek (büyük/küçük harf eşleme, benzerlik) yanlış kişilerin
 * cirosunu birleştirme riski taşırdı.
 */
export default async function MusteriGecmisiPage({
  params,
}: {
  params: Promise<{ isim: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/giris?next=/admin/kasa/siparisler')
  if (user.role !== 'SUPERADMIN') redirect('/admin/notifications')

  const { isim: ham } = await params
  const isim = decodeURIComponent(ham)
  const d = await musteriDefteri(isim)

  const gecerli = d.adet - d.iptalAdedi
  const ortalama = gecerli > 0 ? Math.round(d.toplamSatisMinor / gecerli) : 0

  return (
    <div className="flex flex-col gap-8">
      <KasaTabs active="siparisler" />

      <header>
        <Link
          href="/admin/kasa/siparisler"
          className="text-small text-ink-600 underline-offset-2 hover:underline"
        >
          ← Siparişler
        </Link>
        <h1 className="mt-2 text-h1 text-ink-900">{isim}</h1>
        <p className="mt-1 text-small text-ink-600">
          {d.adet === 0 ? (
            'Bu isimle kayıt yok.'
          ) : (
            <>
              {d.ilkTarih && d.sonTarih && (
                <>
                  İlk sipariş {fmtDate(d.ilkTarih)} · son sipariş {fmtDate(d.sonTarih)}
                </>
              )}
            </>
          )}
        </p>
      </header>

      {d.adet > 0 && (
        <>
          <section aria-label="Özet" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kutu label="Toplam ciro" value={formatMinor(d.toplamSatisMinor)} strong />
            <Kutu label="Toplam maliyet" value={formatMinor(d.toplamMaliyetMinor)} />
            <Kutu label="Net kâr" value={formatMinor(d.toplamNetMinor)} strong />
            <Kutu label="Sipariş adedi" value={`${gecerli}`} muted />
            <Kutu label="Ortalama fiş" value={formatMinor(ortalama)} muted />
          </section>

          {/* ⚠️ TAHSİL EDİLMEMİŞ TUTAR AYRI DURUR: müşterinin ne kadar iş
              yaptırdığı ile ne kadar ödediği farklı sorulardır. */}
          {d.tahsilEdilmemisMinor > 0 && (
            <p className="rounded-[--radius-card] border border-warning-300 bg-warning-50 px-4 py-3 text-small text-warning-800">
              Bu müşteriden <strong>{formatMinor(d.tahsilEdilmemisMinor)}</strong> henüz tahsil
              edilmedi.
            </p>
          )}

          <section aria-labelledby="gecmis-baslik">
            <h2 id="gecmis-baslik" className="text-h3 text-ink-900">
              Bütün siparişler
            </h2>
            <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
              <table className="w-full border-collapse text-small">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-3 py-2 font-semibold">Tarih</th>
                    <th scope="col" className="px-3 py-2 font-semibold">İşlem</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Fiyat</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Maliyet</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Net kâr</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Ödeme</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {d.rows.map((r) => (
                    <tr key={r.id} className="odd:bg-white even:bg-ink-50">
                      <td className="tabular whitespace-nowrap px-3 py-2 text-ink-600">
                        {fmtDate(r.occurredAt)}
                      </td>
                      <td className="px-3 py-2 text-ink-700">
                        {r.description}
                        {r.status !== 'BEKLIYOR' && (
                          <span
                            className={`ml-1.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-caption font-medium ${STATUS_CLASS[r.status]}`}
                          >
                            {ORDER_STATUS_LABEL[r.status]}
                          </span>
                        )}
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-900">
                        {formatMinor(r.salePriceMinor)}
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-600">
                        {formatMinor(r.costMinor)}
                      </td>
                      <td
                        className={`tabular whitespace-nowrap px-3 py-2 text-right font-medium ${
                          r.netMinor < 0 ? 'text-danger-600' : 'text-ink-900'
                        }`}
                      >
                        {formatMinor(r.netMinor)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-caption">
                        {r.paidAt ? (
                          <span className="text-success-700">
                            {r.paidAccountName ?? 'Tahsil'} · {fmtDate(r.paidAt)}
                          </span>
                        ) : r.dueDate ? (
                          <span className="text-warning-700">
                            beklenen · {fmtDate(r.dueDate)}
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    // ⚠️ UTC şart: tarihler gün başlangıcına sabitlenmiş UTC değerleridir.
    timeZone: 'UTC',
  }).format(d)
}

function Kutu({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={`rounded-[--radius-card] border p-4 ${
        muted ? 'border-ink-200 bg-ink-50' : 'border-ink-200 bg-white shadow-[--shadow-card]'
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`tabular mt-1 ${strong ? 'text-h3' : 'text-body'} font-semibold text-ink-900`}>
        {value}
      </p>
    </div>
  )
}
