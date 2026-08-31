import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { KasaEntryForm } from '@/components/kasa/KasaEntryForm'
import { formatMinor, formatQuantity } from '@/lib/money'
import { getSessionUser } from '@/server/auth'
import { getKasaOverview, listAccounts, listEntries } from '@/server/kasa'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Kasa',
  robots: { index: false, follow: false },
}

/**
 * /yonetim/kasa — GELİR / GİDER DEFTERİ
 *
 * ⚠️ SAYFA SEVİYESİNDE SUPERADMIN KAPISI. Yönetim düzeni SUPPORT'a kadar
 * açıktır; bu ekran ayrıca kontrol eder. Asıl kapı yine API ucundadır —
 * sayfa gizlemek bir yetki mekanizması DEĞİLDİR, yalnızca yanlışlıkla
 * girilmesini önler.
 *
 * ⚠️ İKİ FARKLI ZAMAN ARALIĞI AYNI EKRANDA. Bakiye TÜM zamanlardan,
 * ciro ve kâr SEÇİLİ AYDAN hesaplanır. Bu bilinçli: "hesapta ne kadar
 * var?" sorusu ayla sınırlanamaz, "bu ay ne kazandım?" sorusu ise
 * sınırlanmak zorundadır. Başlıklarda hangi aralığın geçerli olduğu
 * açıkça yazar.
 */
export default async function KasaPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== 'SUPERADMIN') redirect('/yonetim/fulfillment')

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.y) || now.getUTCFullYear()
  const month = Number(sp.m) || now.getUTCMonth() + 1

  const [ov, accounts, entries] = await Promise.all([
    getKasaOverview(year, month),
    listAccounts(),
    listEntries(year, month),
  ])

  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">Kasa</h1>
          <p className="mt-1 text-small text-ink-600">
            Gelir, gider ve borç defteri — {monthName}
          </p>
        </div>
        <MonthNav year={year} month={month} />
      </header>

      {/* ───────────────────────── BANKA BAKİYELERİ ───────────────────────── */}
      <section aria-labelledby="bakiye-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="bakiye-baslik" className="text-h3 text-ink-900">
            Hesaplar
          </h2>
          {/* ⚠️ Bakiye AYA GÖRE DEĞİL, tüm hareketlere göredir. */}
          <p className="text-caption text-ink-500">Tüm zamanlar · her hareketten türetilir</p>
        </div>

        {ov.accounts.length === 0 ? (
          <EmptyCard
            title="Henüz hesap tanımlı değil."
            body="Banka hesaplarını ekledikten sonra bakiyeler burada görünür."
          />
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {ov.byOwner.map((group) => (
              <div
                key={group.owner}
                className="overflow-hidden rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]"
              >
                <h3 className="border-b border-ink-100 bg-ink-50 px-5 py-3 text-small font-semibold text-ink-900">
                  {group.owner}
                </h3>
                <ul className="divide-y divide-ink-100">
                  {group.accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <span className="text-small text-ink-700">{a.name}</span>
                      <span className="tabular text-small font-medium text-ink-900">
                        {formatMinor(a.balanceMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-4 border-t border-ink-200 bg-brand-50/50 px-5 py-3">
                  <span className="text-small font-semibold text-ink-900">Toplam</span>
                  <span className="tabular text-body font-semibold text-ink-900">
                    {formatMinor(group.totalMinor)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {ov.accounts.length > 0 && (
          <p className="tabular mt-3 text-right text-body text-ink-900">
            Genel toplam: <strong>{formatMinor(ov.grandTotalMinor)}</strong>
          </p>
        )}
      </section>

      {/* ────────────────────────── HAFTALIK KAZANÇ ───────────────────────── */}
      <section aria-labelledby="hafta-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="hafta-baslik" className="text-h3 text-ink-900">
            Kazançlar
          </h2>
          <p className="text-caption text-ink-500">
            {monthName}
            {ov.usdRateMinor > 0
              ? ` · kur ${formatMinor(ov.usdRateMinor)}`
              : ' · dolar kuru girilmemiş'}
          </p>
        </div>

        <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-ink-100 text-left text-caption uppercase tracking-wide text-ink-500">
                <th scope="col" className="px-5 py-3 font-medium">Hafta</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Kazanç</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Kazanç ($)</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Net kâr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {ov.weeks.map((w) => (
                <tr key={w.week}>
                  <td className="px-5 py-3 text-ink-700">{w.week}. Hafta</td>
                  <td className="tabular px-5 py-3 text-right text-ink-900">
                    {formatMinor(w.revenueMinor)}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink-600">
                    {/* ⚠️ Kur yoksa "$0,00" DEĞİL "—". Sıfır göstermek
                        "hiç kazanmadın" demektir; doğrusu "kur girilmemiş". */}
                    {w.usdMinor === null ? '—' : `$${(w.usdMinor / 100).toFixed(2)}`}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink-900">
                    {formatMinor(w.netMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-200 bg-brand-50/50 font-semibold">
                <td className="px-5 py-3 text-ink-900">Toplam</td>
                <td className="tabular px-5 py-3 text-right text-ink-900">
                  {formatMinor(ov.monthRevenueMinor)}
                </td>
                <td className="tabular px-5 py-3 text-right text-ink-700">
                  {ov.monthRevenueUsdMinor === null
                    ? '—'
                    : `$${(ov.monthRevenueUsdMinor / 100).toFixed(2)}`}
                </td>
                <td className="tabular px-5 py-3 text-right text-ink-900">
                  {formatMinor(ov.monthNetMinor)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ⚠️ İki rakamın farkı açıkça yazılır — karıştırılırsa yanlış karar alınır. */}
        <p className="mt-3 text-caption leading-relaxed text-ink-500">
          <strong className="text-ink-700">Kazanç</strong> satışların toplamıdır; alacak tahsili ve
          hesaplar arası transfer buraya girmez. <strong className="text-ink-700">Net kâr</strong>{' '}
          bundan maliyet ve giderler düşüldükten sonra kalandır. Hesaplardaki para ise
          yukarıdaki bakiyedir — üçü farklı sorulara cevap verir.
        </p>
      </section>

      {/* ──────────────────── ALACAKLAR + BORÇ TAKVİMİ ────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="alacak-baslik">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="alacak-baslik" className="text-h3 text-ink-900">Alacaklar</h2>
            <span className="tabular text-small font-medium text-ink-700">
              {formatMinor(ov.receivableTotalMinor)}
            </span>
          </div>
          {ov.receivables.length === 0 ? (
            <EmptyCard title="Açık alacak yok." body="Tahsil edilmemiş bir kayıt bulunmuyor." />
          ) : (
            <ul className="mt-4 divide-y divide-ink-100 rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
              {ov.receivables.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-small text-ink-900">{r.person}</p>
                    <p className="text-caption text-ink-500">
                      {r.dueDate ? formatDate(r.dueDate) : 'tarih belirtilmemiş'}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-small font-medium text-ink-900">
                    {formatMinor(r.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="borc-baslik">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="borc-baslik" className="text-h3 text-ink-900">Yaklaşan ödemeler</h2>
            <span className="tabular text-small font-medium text-ink-700">
              {formatMinor(ov.upcomingTotalMinor)}
            </span>
          </div>
          {ov.upcoming.length === 0 ? (
            <EmptyCard title="Planlanmış ödeme yok." body="Borç takviminde açık kayıt bulunmuyor." />
          ) : (
            <ul className="mt-4 divide-y divide-ink-100 rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
              {ov.upcoming.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-small text-ink-900">{p.creditor}</p>
                    <p className="text-caption text-ink-500">
                      {formatDate(p.dueDate)}
                      {p.remainingMinor != null &&
                        ` · kalan ${formatQuantity(Math.round(p.remainingMinor / 100))} ₺`}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-small font-medium text-ink-900">
                    {formatMinor(p.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ────────────────────────── HAREKET EKLE ──────────────────────────── */}
      <section aria-labelledby="ekle-baslik">
        <h2 id="ekle-baslik" className="text-h3 text-ink-900">Hareket ekle</h2>
        {accounts.length === 0 ? (
          <EmptyCard
            title="Önce hesap tanımlanmalı."
            body="Hareket girebilmek için en az bir banka hesabı gerekir."
          />
        ) : (
          <div className="mt-4">
            <KasaEntryForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.owner} · ${a.name}` }))} />
          </div>
        )}
      </section>

      {/* ─────────────────────────── AY DÖKÜMÜ ────────────────────────────── */}
      <section aria-labelledby="dokum-baslik">
        <h2 id="dokum-baslik" className="text-h3 text-ink-900">
          {monthName} dökümü
        </h2>
        {entries.length === 0 ? (
          <EmptyCard title="Bu ayda hareket yok." body="Girilen kayıtlar burada listelenir." />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            <table className="w-full text-small">
              <thead>
                <tr className="border-b border-ink-100 text-left text-caption uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-4 py-3 font-medium">Tarih</th>
                  <th scope="col" className="px-4 py-3 font-medium">Kullanıcı</th>
                  <th scope="col" className="px-4 py-3 font-medium">İşlem</th>
                  <th scope="col" className="px-4 py-3 font-medium">Hesap</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Tutar</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Maliyet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">
                      {formatDate(e.occurredAt)}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{e.customerHandle ?? '—'}</td>
                    <td className="px-4 py-3 text-ink-900">{e.description}</td>
                    <td className="px-4 py-3 text-ink-600">{e.account.name}</td>
                    <td
                      className={`tabular px-4 py-3 text-right font-medium ${
                        e.direction === 'IN' ? 'text-success-700' : 'text-danger-600'
                      }`}
                    >
                      {e.direction === 'IN' ? '+' : '−'}
                      {formatMinor(e.amountMinor)}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink-600">
                      {e.costMinor == null ? '—' : formatMinor(e.costMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

function MonthNav({ year, month }: { year: number; month: number }) {
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const link =
    'rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-700 hover:bg-ink-50'
  return (
    <nav aria-label="Ay seçimi" className="flex items-center gap-2">
      <a href={`/yonetim/kasa?y=${prev.y}&m=${prev.m}`} className={link}>
        ← Önceki
      </a>
      <a href={`/yonetim/kasa?y=${next.y}&m=${next.m}`} className={link}>
        Sonraki →
      </a>
    </nav>
  )
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-8 text-center">
      <p className="text-body text-ink-700">{title}</p>
      <p className="mt-1 text-small text-ink-500">{body}</p>
    </div>
  )
}
