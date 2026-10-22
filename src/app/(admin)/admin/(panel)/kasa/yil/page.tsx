import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { KasaTabs } from '@/components/kasa/KasaTabs'
import { formatMinor } from '@/lib/money'
import { getSessionUser } from '@/server/auth'
import { yilOzeti } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Yıl özeti',
  robots: { index: false, follow: false },
}

const AYLAR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const

/**
 * /admin/kasa/yil — ON İKİ AY TEK EKRANDA
 *
 * ⚠️ RAKAMLAR SİPARİŞ DEFTERİNDEN gelir, kasadan değil: "hangi ay ne kadar
 * iş yaptım" sorusunu yanıtlar. Kasa sekmesindeki tutarlarla bilerek
 * farklı olabilir, çünkü orada ölçü tahsilat tarihidir. Hangi ölçünün
 * geçerli olduğu başlıkta yazılıdır.
 *
 * ⚠️ İPTALLER TOPLAMLARA GİRMEZ — ay ekranındaki kuralla aynı.
 */
export default async function YilOzetiPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/giris?next=/admin/kasa/yil')
  if (user.role !== 'SUPERADMIN') redirect('/admin/notifications')

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.y) || now.getUTCFullYear()
  const aylar = await yilOzeti(year)

  const toplam = aylar.reduce(
    (a, m) => ({
      adet: a.adet + m.adet,
      satis: a.satis + m.satisMinor,
      maliyet: a.maliyet + m.maliyetMinor,
      net: a.net + m.netMinor,
      bekleyen: a.bekleyen + m.tahsilEdilmemisMinor,
    }),
    { adet: 0, satis: 0, maliyet: 0, net: 0, bekleyen: 0 },
  )

  // ⚠️ Çubuklar yılın en iyi ayına oranlanır; sabit tavan, sakin bir yılda
  //    bütün ayları dibe yapıştırırdı.
  const zirve = Math.max(1, ...aylar.map((m) => m.satisMinor))
  const buAy = year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : null

  return (
    <div className="flex flex-col gap-8">
      <KasaTabs active="yil" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">{year} özeti</h1>
          <p className="mt-1 text-small text-ink-600">
            Sipariş defteri — sipariş TARİHİNE göre, iptaller hariç
          </p>
        </div>
        <nav aria-label="Yıl seçimi" className="flex items-center gap-2">
          <Link
            href={`/admin/kasa/yil?y=${year - 1}`}
            className="rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-700 hover:bg-ink-50"
          >
            ← {year - 1}
          </Link>
          <Link
            href={`/admin/kasa/yil?y=${year + 1}`}
            className="rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-700 hover:bg-ink-50"
          >
            {year + 1} →
          </Link>
        </nav>
      </header>

      <section aria-label="Yıl toplamı" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kutu label="Yıllık ciro" value={formatMinor(toplam.satis)} strong />
        <Kutu label="Toplam maliyet" value={formatMinor(toplam.maliyet)} />
        <Kutu label="Net kâr" value={formatMinor(toplam.net)} strong />
        <Kutu label="Sipariş adedi" value={String(toplam.adet)} muted />
      </section>

      <section aria-labelledby="ay-baslik">
        <h2 id="ay-baslik" className="text-h3 text-ink-900">Aylar</h2>
        <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
          <table className="w-full border-collapse text-small">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
                <th scope="col" className="px-3 py-2 font-semibold">Ay</th>
                <th scope="col" className="px-3 py-2 font-semibold">Ciro dağılımı</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Ciro</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Maliyet</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Net kâr</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sipariş</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bekleyen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {aylar.map((m) => {
                const bos = m.adet === 0
                return (
                  <tr
                    key={m.month1}
                    className={
                      buAy === m.month1
                        ? 'bg-brand-50'
                        : bos
                          ? 'bg-white text-ink-400'
                          : 'odd:bg-white even:bg-ink-50'
                    }
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-900">
                      <Link
                        href={`/admin/kasa/siparisler?y=${year}&m=${m.month1}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {AYLAR[m.month1 - 1]}
                      </Link>
                      {buAy === m.month1 && (
                        <span className="ml-1.5 rounded-full bg-brand-100 px-1.5 py-0.5 text-caption font-medium text-brand-700">
                          bu ay
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        aria-hidden
                        className="block h-2 w-full overflow-hidden rounded-full bg-ink-100"
                      >
                        <span
                          className="block h-full rounded-full bg-brand-500"
                          style={{ width: `${bos ? 0 : (m.satisMinor / zirve) * 100}%` }}
                        />
                      </span>
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-900">
                      {bos ? '—' : formatMinor(m.satisMinor)}
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-600">
                      {bos ? '—' : formatMinor(m.maliyetMinor)}
                    </td>
                    <td
                      className={`tabular whitespace-nowrap px-3 py-2 text-right font-medium ${
                        m.netMinor < 0 ? 'text-danger-600' : 'text-ink-900'
                      }`}
                    >
                      {bos ? '—' : formatMinor(m.netMinor)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-ink-600">
                      {bos ? '—' : m.adet}
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {m.tahsilEdilmemisMinor > 0 ? (
                        <span className="text-warning-700">
                          {formatMinor(m.tahsilEdilmemisMinor)}
                        </span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-300 bg-ink-50 font-semibold text-ink-900">
                <td className="px-3 py-2 text-caption uppercase tracking-wide text-ink-600" colSpan={2}>
                  Yıl toplamı
                </td>
                <td className="tabular px-3 py-2 text-right">{formatMinor(toplam.satis)}</td>
                <td className="tabular px-3 py-2 text-right text-ink-600">
                  {formatMinor(toplam.maliyet)}
                </td>
                <td className="tabular px-3 py-2 text-right">{formatMinor(toplam.net)}</td>
                <td className="tabular px-3 py-2 text-right text-ink-600">{toplam.adet}</td>
                <td className="tabular px-3 py-2 text-right text-warning-700">
                  {toplam.bekleyen > 0 ? formatMinor(toplam.bekleyen) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

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
