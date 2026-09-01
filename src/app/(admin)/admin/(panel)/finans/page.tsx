import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HizliHareketForm } from '@/components/kasa/HizliHareketForm'
import { InlineEdit } from '@/components/kasa/InlineEdit'
import { RowMenu } from '@/components/kasa/RowMenu'
import type { CashCategory } from '@/lib/kasa/calc'
import { formatMinor } from '@/lib/money'
import { getSessionUser } from '@/server/auth'
import { listAccounts } from '@/server/kasa'
import { getFinance } from '@/server/kasa/finans'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Gelir – Gider',
  robots: { index: false, follow: false },
}

const KATEGORI_ETIKET: Record<CashCategory, string> = {
  SATIS: 'Satış',
  TAHSILAT: 'Tahsilat',
  GIDER: 'Gider',
  MALIYET: 'Maliyet',
  BORC_ODEME: 'Borç ödeme',
  TRANSFER_IN: 'Transfer (giriş)',
  TRANSFER_OUT: 'Transfer (çıkış)',
  DIGER: 'Diğer',
  DUZELTME: 'Düzeltme',
}

/**
 * /admin/finans — GELİR – GİDER
 *
 * Günlük para hareketlerinin girildiği ve okunduğu tek ekran. Kahve, benzin,
 * tedarikçi ödemesi, elden gelen para — hepsi buraya.
 *
 * ⚠️⚠️ İKİ SAYI GÖSTERİLİR VE AYNI ŞEY DEĞİLLERDİR:
 *   KASA AKIŞI → bu ay hesaplara ne girdi, ne çıktı ("param arttı mı?")
 *   NET KÂR    → ciro − maliyet − gider ("iş kazandırıyor mu?")
 * Alacak tahsili bakiyeyi artırır ama kâr değildir; kredi ödemesi bakiyeyi
 * düşürür ama zarar değildir. İkisini tek bir "net" altında toplamak bu
 * ayrımı görünmez kılar ve yanlış iş kararı ürettirir.
 */
export default async function FinansPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/giris?next=/admin/finans')
  if (user.role !== 'SUPERADMIN') redirect('/admin/notifications')

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.y) || now.getUTCFullYear()
  const month = Number(sp.m) || now.getUTCMonth() + 1

  const [data, accounts] = await Promise.all([getFinance(year, month), listAccounts()])
  const accountOptions = accounts.map((a) => ({ id: a.id, label: `${a.owner} · ${a.name}` }))

  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const navLink =
    'rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-700 hover:bg-ink-50'

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">Gelir – Gider</h1>
          <p className="mt-1 text-small text-ink-600">Günlük para hareketleri — {monthName}</p>
        </div>
        <nav aria-label="Ay seçimi" className="flex items-center gap-2">
          <a href={`/admin/finans?y=${prev.y}&m=${prev.m}`} className={navLink}>← Önceki</a>
          <a href={`/admin/finans?y=${next.y}&m=${next.m}`} className={navLink}>Sonraki →</a>
        </nav>
      </header>

      {/* ───────────────────────── HIZLI GİRİŞ ───────────────────────────── */}
      <section aria-labelledby="ekle-baslik">
        <h2 id="ekle-baslik" className="text-h3 text-ink-900">Hızlı giriş</h2>
        <div className="mt-3">
          <HizliHareketForm accounts={accountOptions} />
        </div>
      </section>

      {/* ──────────────────────────── ÖZET ───────────────────────────────── */}
      <section aria-labelledby="ozet-baslik">
        <h2 id="ozet-baslik" className="text-h3 text-ink-900">{monthName} özeti</h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Giren" value={formatMinor(data.girenMinor)} tone="in" />
          <Stat label="Çıkan" value={formatMinor(data.cikanMinor)} tone="out" />
          <Stat
            label="Kasa akışı"
            value={formatMinor(data.akisMinor)}
            tone={data.akisMinor < 0 ? 'out' : 'in'}
            strong
          />
        </div>

        {/* ⚠️ AYRIM EKRANDA YAZILI OLMALI. Yazmasaydı "kasa akışı" ile
            "net kâr" farklı çıktığında hangisinin doğru olduğu sorusu
            cevapsız kalırdı — ikisi de doğrudur, farklı soruların
            cevabıdır. */}
        <div className="mt-3 rounded-[--radius-card] border border-ink-200 bg-ink-50 px-4 py-3">
          <p className="text-small text-ink-700">
            Net kâr: <strong className="tabular">{formatMinor(data.profit.netMinor)}</strong>{' '}
            <span className="text-ink-500">
              (ciro {formatMinor(data.profit.revenueMinor)} − maliyet{' '}
              {formatMinor(data.profit.costOfSalesMinor)} − gider{' '}
              {formatMinor(data.profit.expenseMinor)})
            </span>
          </p>
          <p className="mt-1 text-caption leading-relaxed text-ink-500">
            <strong>Kasa akışı kâr değildir.</strong> Alacak tahsili bakiyeyi artırır ama kâra
            girmez (satış zaten sayılmıştı); kredi ödemesi bakiyeyi düşürür ama zarar değildir.
            Hesaplar arası transferler ve bakiye düzeltmeleri iki toplama da girmez.
          </p>
        </div>

        {data.giderDagilimi.length > 0 && (
          <div className="mt-4">
            <h3 className="text-small font-semibold text-ink-900">Para nereye gitti?</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {data.giderDagilimi.map((g) => (
                <li
                  key={g.category}
                  className="rounded-full border border-ink-200 bg-white px-3 py-1 text-caption text-ink-700"
                >
                  {KATEGORI_ETIKET[g.category]}{' '}
                  <span className="tabular font-semibold text-ink-900">
                    {formatMinor(g.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ──────────────────────────── LİSTE ──────────────────────────────── */}
      <section aria-labelledby="liste-baslik">
        <h2 id="liste-baslik" className="text-h3 text-ink-900">Hareketler</h2>

        {data.rows.length === 0 ? (
          <div className="mt-4 rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-8 text-center">
            <p className="text-body text-ink-700">Bu ayda hareket yok.</p>
            <p className="mt-1 text-small text-ink-500">
              Yukarıdan bir gider ya da gelir ekleyince burada listelenir.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            <table className="w-full border-collapse text-small">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Tarih</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Ne için</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Tür</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Hesap</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Tutar</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.rows.map((r) => (
                  <tr key={r.id} className="align-middle odd:bg-white even:bg-ink-50">
                    <td className="tabular whitespace-nowrap px-3 py-2 text-ink-600">
                      {fmtDate(r.occurredAt)}
                    </td>
                    <td className="max-w-[24rem] px-3 py-2 text-ink-800" title={r.description}>
                      <span className="line-clamp-2">{r.description}</span>
                      {/* ⚠️ BAĞLI SATIR İŞARETLENİR: tutarı donmuştur, sebebi
                          burada görünür — düzenleme kutusunu açıp anlamaya
                          çalışmak gerekmesin. */}
                      {r.linkedTo && (
                        <span className="ml-1.5 text-caption text-ink-500">· {r.linkedTo}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-600">
                      {KATEGORI_ETIKET[r.category]}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-600">{r.accountName}</td>
                    {/* ⚠️ YÖN RENKLE VE İŞARETLE — sadece renk yeterli
                        olmazdı: renk körlüğünde giren ile çıkan
                        ayırt edilemezdi. */}
                    <td
                      className={`tabular whitespace-nowrap px-3 py-2 text-right font-medium ${
                        r.direction === 'IN' ? 'text-success-700' : 'text-danger-600'
                      }`}
                    >
                      {r.direction === 'IN' ? '+' : '−'} {formatMinor(r.amountMinor)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RowMenu>
                        <InlineEdit
                          endpoint={`/api/v1/admin/kasa/entries/${r.id}`}
                          fields={[
                            { kind: 'text', name: 'description', label: 'Ne için', value: r.description, required: true },
                            { kind: 'date', name: 'occurredAt', label: 'Tarih', value: isoDay(r.occurredAt), required: true },
                            {
                              kind: 'money',
                              name: 'amountMinor',
                              label: 'Tutar',
                              valueMinor: r.amountMinor,
                              required: true,
                              frozen: r.linkedTo
                                ? `Bu satır bir ${r.linkedTo} kaydından yazıldı — tutar donmuş`
                                : undefined,
                            },
                            { kind: 'text', name: 'note', label: 'Not', value: r.note ?? '' },
                          ]}
                          remove={{
                            endpoint: `/api/v1/admin/kasa/entries/${r.id}`,
                            confirm: `"${r.description}" hareketi silinsin mi? Bakiye buna göre değişir.`,
                            blocked: r.linkedTo
                              ? `Bu hareket bir ${r.linkedTo} kaydına bağlı; önce oradan geri alın.`
                              : undefined,
                          }}
                        />
                      </RowMenu>
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

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    // ⚠️ UTC şart: tarihler gün başlangıcına sabitlenmiş UTC değerleridir.
    timeZone: 'UTC',
  }).format(d)
}

function Stat({
  label,
  value,
  tone,
  strong,
}: {
  label: string
  value: string
  tone: 'in' | 'out'
  strong?: boolean
}) {
  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-4 shadow-[--shadow-card]">
      <p className="text-caption uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`tabular mt-1 ${strong ? 'text-h3' : 'text-body'} font-semibold ${
          tone === 'in' ? 'text-success-700' : 'text-danger-600'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
