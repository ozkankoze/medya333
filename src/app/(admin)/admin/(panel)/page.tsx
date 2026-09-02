import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountBalances } from '@/components/kasa/AccountBalances'
import { AlacakOdeme } from '@/components/kasa/AlacakOdeme'
import { todayForOperator } from '@/lib/kasa/packages'
import { formatMinor } from '@/lib/money'
import { getSessionUser } from '@/server/auth'
import { getPanelHome } from '@/server/kasa/panel'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Panel',
  robots: { index: false, follow: false },
}

/**
 * /admin — PANELİN ANA SAYFASI
 *
 * Tek bir soruya cevap verir: **elimde ne var, kimden ne alacağım?**
 *
 * ⚠️ BURADA CİRO, KÂR VE AY GRAFİĞİ YOKTUR. Onlar Kasa sayfasında. Ana
 * sayfa her açılışta bakılan yerdir; her açılışta bakılan bir ekran
 * kalabalıklaşırsa hiçbir şey görünmez olur.
 *
 * ⚠️ ALACAK LİSTESİ İKİ KAYNAĞI BİRLEŞTİRİR (sipariş defterine tarih
 * yazılanlar + kasadaki bağımsız alacaklar). Yalnızca birini göstermek,
 * "toplam alacağım" sorusuna eksik cevap vermek olurdu — eksik bir toplam,
 * yanlış bir toplamdan daha tehlikelidir çünkü doğru görünür.
 */
export default async function PanelHomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/admin/giris?next=/admin')
  // ⚠️ Bakiye ve alacak SUPERADMIN'e özeldir; diğer roller sipariş
  //    defterini de görmez, doğrudan kendi alanlarına gider.
  if (user.role !== 'SUPERADMIN') redirect('/admin/notifications')

  const today = todayForOperator()
  const data = await getPanelHome(today)

  const formatted = Object.fromEntries(
    data.accounts.map((a) => [a.id, formatMinor(a.balanceMinor)]),
  )

  /**
   * ⚠️ ÖDEME KUTUSUNUN TANIYACAĞI HESAPLAR. Sipariş defterindekiyle AYNI
   * liste ve aynı çözümleme kuralı — iki ekranda iki farklı davranış
   * olsaydı hangisinin ne yaptığı ezberlenmek zorunda kalırdı.
   */
  const hesapSecenekleri = data.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    label: `${a.owner} · ${a.name}`,
  }))

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-h1 text-ink-900">Panel</h1>
        <p className="mt-1 text-small text-ink-600">
          Hesaplarda duran para ve tahsil edilmeyi bekleyen alacaklar
        </p>
      </header>

      {/* ─────────────────────────── HESAPLAR ────────────────────────────── */}
      <section aria-labelledby="hesap-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="hesap-baslik" className="text-h3 text-ink-900">Hesaplar</h2>
          <p className="tabular text-small font-semibold text-ink-900">
            Toplam {formatMinor(data.grandTotalMinor)}
          </p>
        </div>
        <div className="mt-4">
          <AccountBalances accounts={data.accounts} formatted={formatted} />
        </div>
      </section>

      {/* ─────────────────────────── ALACAKLAR ───────────────────────────── */}
      <section aria-labelledby="alacak-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="alacak-baslik" className="text-h3 text-ink-900">Alacaklar</h2>
          <p className="tabular text-small font-semibold text-ink-900">
            Toplam {formatMinor(data.alacakToplamMinor)}
          </p>
        </div>
        <p className="mt-1 text-caption text-ink-500">
          Sipariş defterinde ödeme kutusuna tarih yazdığın satırlar burada görünür.
          Para gelince <strong>“Ödeme alındı”</strong> deyip hesap adını yaz — o hesaba gelir
          yazılır ve satır listeden düşer.
        </p>

        {data.alacaklar.length === 0 ? (
          <p className="mt-4 rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-6 text-center text-small text-ink-600">
            Bekleyen alacak yok.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            <table className="w-full border-collapse text-small">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Tarih</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Kişi</th>
                  <th scope="col" className="px-3 py-2 font-semibold">İşlem</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Tutar</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.alacaklar.map((a) => (
                  <tr key={`${a.source}-${a.id}`} className="align-middle odd:bg-white even:bg-ink-50">
                    <td className="tabular whitespace-nowrap px-3 py-2 text-ink-600">
                      {a.dueDate ? fmtDate(a.dueDate) : '—'}
                      {/* ⚠️ GECİKMİŞ ALACAK KIRMIZI. Tarih tek başına
                          "geçti mi?" sorusunu her satırda kafadan hesap
                          yapmayı gerektirirdi. */}
                      {a.daysLeft !== null && (
                        <span
                          className={`ml-1.5 text-caption ${
                            a.daysLeft < 0 ? 'font-semibold text-danger-600' : 'text-ink-500'
                          }`}
                        >
                          {a.daysLeft < 0 ? `${-a.daysLeft} gün gecikti` : `${a.daysLeft} g`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-ink-900">{a.person}</td>
                    <td className="max-w-[26rem] px-3 py-2 text-ink-700" title={a.description}>
                      <span className="line-clamp-2">{a.description}</span>
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right font-medium text-ink-900">
                      {formatMinor(a.amountMinor)}
                    </td>
                    {/*
                      ⚠️ ALACAK GÖRÜLDÜĞÜ YERDE KAPATILABİLMELİ. Önceden bu
                      tablo salt okunurdu: para geldiğinde kullanıcı buradan
                      hiçbir şey yapamıyor, Siparişler sayfasına gidip satırı
                      aramak zorunda kalıyordu. Kayıt ertelenirse liste
                      gerçeği göstermeyi bırakır.
                    */}
                    <td className="px-3 py-2 text-right">
                      <AlacakOdeme source={a.source} id={a.id} hesaplar={hesapSecenekleri} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──────────────────────────── BORÇLAR ────────────────────────────── */}
      {data.borclar.length > 0 && (
        <section aria-labelledby="borc-baslik">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="borc-baslik" className="text-h3 text-ink-900">Yaklaşan ödemeler</h2>
            <p className="tabular text-small font-semibold text-ink-900">
              Toplam {formatMinor(data.borcToplamMinor)}
            </p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            <table className="w-full border-collapse text-small">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Tarih</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Kime</th>
                  <th scope="col" className="px-3 py-2 font-semibold">İşlem</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Tutar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.borclar.map((b) => (
                  <tr key={b.id} className="align-middle odd:bg-white even:bg-ink-50">
                    <td className="tabular whitespace-nowrap px-3 py-2 text-ink-600">
                      {fmtDate(b.dueDate)}
                      {b.daysLeft !== null && (
                        <span
                          className={`ml-1.5 text-caption ${
                            b.daysLeft < 0 ? 'font-semibold text-danger-600' : 'text-ink-500'
                          }`}
                        >
                          {b.daysLeft < 0 ? `${-b.daysLeft} gün gecikti` : `${b.daysLeft} g`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-ink-900">{b.creditor}</td>
                    <td className="px-3 py-2 text-ink-700">{b.description}</td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right font-medium text-ink-900">
                      {formatMinor(b.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-small text-ink-600">
        Sipariş girmek için{' '}
        <Link href="/admin/kasa/siparisler" className="font-medium text-brand-700 underline">
          Siparişler
        </Link>
        , aylık müşteriler için{' '}
        <Link href="/admin/kasa/paketler" className="font-medium text-brand-700 underline">
          Aylık Paketler
        </Link>
        .
      </p>
    </div>
  )
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(d)
}
