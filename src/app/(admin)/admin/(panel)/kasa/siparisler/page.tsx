import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { KasaTabs } from '@/components/kasa/KasaTabs'
import { ManualOrderActions } from '@/components/kasa/ManualOrderActions'
import { ManualOrderForm } from '@/components/kasa/ManualOrderForm'
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATE_LABEL,
  type ManualOrderStatus,
} from '@/lib/kasa/orders'
import { formatMinor } from '@/lib/money'
import { getSessionUser } from '@/server/auth'
import { listAccounts } from '@/server/kasa'
import { getOrders } from '@/server/kasa/orders'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Siparişler',
  robots: { index: false, follow: false },
}

const STATUS_CLASS: Record<ManualOrderStatus, string> = {
  BEKLIYOR: 'bg-ink-100 text-ink-700',
  DEVAM_EDIYOR: 'bg-warning-100 text-warning-700',
  TAMAMLANDI: 'bg-success-100 text-success-700',
  IPTAL: 'bg-danger-100 text-danger-700',
}

/**
 * /admin/kasa/siparisler — ELLE GİRİLEN GÜNLÜK SİPARİŞ DEFTERİ
 *
 * ⚠️⚠️ BU EKRAN SİTEDEKİ SİPARİŞLERİ GÖSTERMEZ. Gerçek müşteri siparişleri
 * `/admin/fulfillment` altındadır: ödeme akışı üretirler, denetim izi
 * taşırlar ve SİLİNEMEZLER. Burası işletmenin kendi defteridir — elle
 * girilir, elle silinir. İkisi bilinçli olarak ayrı tutuldu; birleştirmek,
 * bir gün yanlış satırın silinmesiyle biterdi.
 *
 * ⚠️ AYLIK TOPLAMLAR SİPARİŞ TARİHİNE GÖREDİR, tahsil tarihine göre değil.
 * "Bu ay ne kadar iş yaptım?" ile "bu ay kasaya ne kadar girdi?" farklı
 * sorulardır; ikincisi Kasa sekmesindedir. Rakamların farklı olması normal
 * ve başlıklarda hangi aralığın geçerli olduğu yazılıdır.
 */
export default async function ManualOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>
}) {
  const user = await getSessionUser()
  // ⚠️ Oturumsuz istek personel kapısına, yetkisiz oturum panele döner.
  if (!user) redirect('/admin/giris?next=/admin/kasa/siparisler')
  if (user.role !== 'SUPERADMIN') redirect('/admin/fulfillment')

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.y) || now.getUTCFullYear()
  const month = Number(sp.m) || now.getUTCMonth() + 1

  const [data, accounts] = await Promise.all([getOrders(year, month), listAccounts()])
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
      <KasaTabs active="siparisler" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">Siparişler</h1>
          <p className="mt-1 text-small text-ink-600">
            Elle tutulan günlük defter — {monthName}
          </p>
        </div>
        <nav aria-label="Ay seçimi" className="flex items-center gap-2">
          <a href={`/admin/kasa/siparisler?y=${prev.y}&m=${prev.m}`} className={navLink}>
            ← Önceki
          </a>
          <a href={`/admin/kasa/siparisler?y=${next.y}&m=${next.m}`} className={navLink}>
            Sonraki →
          </a>
        </nav>
      </header>

      {/*
        ⚠️ BU AYRIM EKRANDA YAZILI OLMALI. Yazmasaydı, "İş Kuyruğu'ndaki
        siparişler neden burada yok?" sorusu kaçınılmazdı ve cevabı hiçbir
        yerde bulunamazdı.
      */}
      <p className="rounded-[--radius-card] border border-ink-200 bg-ink-50 px-4 py-3 text-caption leading-relaxed text-ink-600">
        Bu defter <strong>yalnızca senin elle girdiğin</strong> kayıtları tutar. Siteden gelen
        gerçek müşteri siparişleri burada görünmez; onlar <strong>İş Kuyruğu</strong>’ndadır ve
        silinemez.
      </p>

      {/* ──────────────────────────── ÖZET ───────────────────────────────── */}
      <section aria-labelledby="ozet-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="ozet-baslik" className="text-h3 text-ink-900">Özet</h2>
          <p className="text-caption text-ink-500">
            {monthName} — sipariş TARİHİNE göre
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Toplam sipariş tutarı" value={formatMinor(data.summary.monthSaleMinor)} />
          <Stat label="Toplam maliyet" value={formatMinor(data.summary.monthCostMinor)} />
          <Stat label="Net kâr" value={formatMinor(data.summary.monthNetMinor)} strong />
          <Stat label="Sipariş adedi" value={String(data.summary.monthCount)} muted />
        </div>

        {/* ⚠️ TAHSİL EDİLMEMİŞ TUTAR AYRI GÖSTERİLİR. Ciroya bakıp "bu para
            bende" sanmak, en pahalı yanlış okumadır. */}
        {data.summary.monthUnpaidMinor > 0 && (
          <p className="mt-3 rounded-[--radius-card] border border-warning-300 bg-warning-50 px-4 py-3 text-small text-warning-800">
            Bu ayın siparişlerinden <strong>{formatMinor(data.summary.monthUnpaidMinor)}</strong>{' '}
            henüz tahsil edilmedi — bu tutar yukarıdaki cirodadır ama bankada değildir.
          </p>
        )}
        {data.summary.monthCanceledCount > 0 && (
          <p className="mt-2 text-caption text-ink-500">
            {data.summary.monthCanceledCount} iptal edilmiş sipariş toplamlara dâhil edilmedi.
          </p>
        )}
      </section>

      {/* ────────────────────────── SİPARİŞ EKLE ─────────────────────────── */}
      <section aria-labelledby="ekle-baslik">
        <h2 id="ekle-baslik" className="text-h3 text-ink-900">Yeni sipariş</h2>
        <div className="mt-4">
          <ManualOrderForm />
        </div>
      </section>

      {/* ──────────────────────────── LİSTE ──────────────────────────────── */}
      <section aria-labelledby="liste-baslik">
        <h2 id="liste-baslik" className="text-h3 text-ink-900">{monthName} siparişleri</h2>
        {data.rows.length === 0 ? (
          <div className="mt-4 rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-8 text-center">
            <p className="text-body text-ink-700">Bu ayda sipariş yok.</p>
            <p className="mt-1 text-small text-ink-500">
              Eklediğin siparişler burada listelenir.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            <table className="w-full text-small">
              <thead>
                <tr className="border-b border-ink-100 text-left text-caption uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-4 py-3 font-medium">Kullanıcı adı</th>
                  {/* ⚠️ Satırı okunur kılan sütun budur — kullanıcı adının
                      hemen yanında durur, tutarların arasında değil. */}
                  <th scope="col" className="px-4 py-3 font-medium">Sipariş içeriği</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tarih</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Sipariş tutarı</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Maliyet</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Net kâr</th>
                  <th scope="col" className="px-4 py-3 font-medium">Sipariş durumu</th>
                  <th scope="col" className="px-4 py-3 font-medium">Ödeme durumu</th>
                  <th scope="col" className="px-4 py-3 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-ink-900">{r.customerName}</td>
                    {/* ⚠️ `break-words` şart: uzun içerik metni tabloyu yana
                        taşırıp diğer sütunları ekrandan çıkarabilir. */}
                    <td className="max-w-[18rem] break-words px-4 py-3 text-ink-700">
                      {r.description}
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">
                      {fmtDate(r.occurredAt)}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink-900">
                      {formatMinor(r.salePriceMinor)}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink-600">
                      {formatMinor(r.costMinor)}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium text-ink-900">
                      {formatMinor(r.netMinor)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[r.status]}`}
                      >
                        {ORDER_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.paidAt ? (
                        <span className="text-success-700">
                          {PAYMENT_STATE_LABEL.ODENDI} · {fmtDate(r.paidAt)}
                        </span>
                      ) : (
                        <span className="text-ink-500">{PAYMENT_STATE_LABEL.BEKLIYOR}</span>
                      )}
                      {/* ⚠️ İPTAL AMA TAHSİL EDİLMİŞ: para kasada duruyor,
                          ciroya girmiyor. Bu fark görünmezse "rakamlar neden
                          tutmuyor?" sorusu cevapsız kalır. */}
                      {r.status === 'IPTAL' && r.paidAt && (
                        <span className="mt-1 block text-caption text-warning-700">
                          para kasada — iade elle girilmeli
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ManualOrderActions
                        id={r.id}
                        accounts={accountOptions}
                        status={r.status}
                        saleLabel={formatMinor(r.salePriceMinor)}
                        costLabel={formatMinor(r.costMinor)}
                        isPaid={Boolean(r.paidAt)}
                        canRecordCost={r.costMinor > 0 && !r.costEntryId && r.status !== 'IPTAL'}
                        canDelete={r.canDelete}
                      />
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

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    // ⚠️ UTC şart: tarihler gün başlangıcına sabitlenmiş UTC değerleridir.
    //    Yerel saate çevrilseydi Türkiye'de bir gün kayabilirdi.
    timeZone: 'UTC',
  }).format(d)
}

function Stat({
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
