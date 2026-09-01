import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { KasaTabs } from '@/components/kasa/KasaTabs'
import { InlineEdit } from '@/components/kasa/InlineEdit'
import { PackageForm } from '@/components/kasa/PackageForm'
import { PackageActions } from '@/components/kasa/PackageActions'
import { RowMenu } from '@/components/kasa/RowMenu'
import { formatMinor } from '@/lib/money'
import type { PackageState } from '@/lib/kasa/packages'
import { getSessionUser } from '@/server/auth'
import { listAccounts } from '@/server/kasa'
import { getPackages } from '@/server/kasa/packages'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Aylık Paketler',
  robots: { index: false, follow: false },
}

const STATE_LABEL: Record<PackageState, string> = {
  PLANLANDI: 'Planlandı',
  AKTIF: 'Aktif',
  BITIYOR: 'Bitiyor',
  SURESI_DOLDU: 'Süresi doldu',
  IPTAL: 'İptal',
}

/**
 * ⚠️ "YAŞAYAN" PAKET — listenin üst yarısı. Kalan gün yalnızca bunlarda
 * anlamlıdır; süresi dolmuş bir pakette "-42 g" yazmak gürültüdür.
 */
const LIVING = new Set<PackageState>(['PLANLANDI', 'AKTIF', 'BITIYOR'])

const STATE_CLASS: Record<PackageState, string> = {
  PLANLANDI: 'bg-ink-100 text-ink-700',
  AKTIF: 'bg-success-100 text-success-700',
  BITIYOR: 'bg-warning-100 text-warning-700',
  SURESI_DOLDU: 'bg-ink-150 text-ink-600',
  IPTAL: 'bg-danger-100 text-danger-700',
}

/**
 * /admin/kasa/paketler — AYLIK MÜŞTERİ PAKETLERİ
 *
 * ⚠️ BU BİR ABONELİK EKRANI DEĞİLDİR. Hiçbir şey otomatik yenilenmez,
 * hiçbir tahakkuk kendiliğinden oluşmaz. Süresi dolan paket yalnızca
 * "süresi doldu" olarak GÖSTERİLİR; yenileme, elle açılan yeni bir kayıttır.
 *
 * ⚠️ DURUMLAR TARİHTEN TÜRETİLİR, veritabanında saklanmaz — bu yüzden
 * hiçbir zaman bayatlamaz (bkz. `lib/kasa/packages.ts`).
 */
export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>
}) {
  const user = await getSessionUser()
  // ⚠️ Oturumsuz istek personel kapısına, yetkisiz oturum panele döner.
  //    İkisini tek satırda birleştirmek, oturumsuz ziyaretçiyi düzenin
  //    yeniden yönlendireceği bir sayfaya göndermek olurdu.
  if (!user) redirect('/admin/giris?next=/admin/kasa/paketler')
  if (user.role !== 'SUPERADMIN') redirect('/admin/fulfillment')

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.y) || now.getUTCFullYear()
  const month = Number(sp.m) || now.getUTCMonth() + 1

  const [data, accounts] = await Promise.all([getPackages(year, month), listAccounts()])
  const accountOptions = accounts.map((a) => ({ id: a.id, label: `${a.owner} · ${a.name}` }))

  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )

  return (
    <div className="flex flex-col gap-8">
      {/* ⚠️ Sekme çubuğu üç kasa sayfasında da AYNI bileşenden gelir.
          Her sayfaya elle kopyalansaydı, dördüncü bir sekme eklendiğinde
          birinde unutulur ve o sayfadan diğerine geçilemezdi. */}
      <KasaTabs active="paketler" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">Aylık Paketler</h1>
          <p className="mt-1 text-small text-ink-600">
            Süreli müşteri hizmetleri — elle yönetilir, otomatik yenileme yoktur
          </p>
        </div>
      </header>

      {/* ──────────────────────────── ÖZET ───────────────────────────────── */}
      <section aria-labelledby="ozet-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="ozet-baslik" className="text-h3 text-ink-900">Özet</h2>
          <p className="text-caption text-ink-500">
            Tutarlar {monthName} — ayda BAŞLAYAN paketler
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Toplam satış" value={formatMinor(data.summary.monthSaleMinor)} />
          <Stat label="Toplam maliyet" value={formatMinor(data.summary.monthCostMinor)} />
          <Stat label="Toplam net kâr" value={formatMinor(data.summary.monthNetMinor)} strong />
          <Stat label="Bu ay açılan paket" value={String(data.summary.monthCount)} />
        </div>

        {/* ⚠️ Bu sayaçlar "ŞU AN" durumudur — seçili aydan bağımsızdır. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Aktif paket" value={String(data.summary.activeCount)} muted />
          <Stat label="Yakında bitecek" value={String(data.summary.endingSoonCount)} muted />
          <Stat label="Süresi dolan" value={String(data.summary.expiredCount)} muted />
          <Stat label="İptal" value={String(data.summary.canceledCount)} muted />
        </div>
        <p className="mt-2 text-caption text-ink-500">
          Alt satırdaki sayaçlar bugünün durumunu gösterir; seçili aya göre değişmez.
        </p>
      </section>

      {/* ─────────────────── YENİLENEN / YENİLENMEYEN ────────────────────── */}
      {data.retention.length > 0 && (
        <section aria-labelledby="yenileme-baslik">
          <h2 id="yenileme-baslik" className="text-h3 text-ink-900">Müşteri devamlılığı</h2>
          {/* ⚠️ Bu bir ÇIKARIMDIR, kaydedilmiş bir gerçek değil — kural yazılı. */}
          <p className="mt-1 text-caption leading-relaxed text-ink-500">
            Otomatik yenileme olmadığı için “yenilendi” bilgisi çıkarımdır: süresi dolmuş bir
            paketin müşterisi için, o paketin bitiş tarihinden sonra başlayan başka bir paket
            varsa müşteri yenilenmiş sayılır. İptal edilen paketler sayılmaz.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <RetentionList title="Yenileyen" rows={data.renewed} tone="success" />
            <RetentionList title="Yenilemeyen" rows={data.notRenewed} tone="danger" />
          </div>
        </section>
      )}

      {/* ────────────────────────── PAKET EKLE ───────────────────────────── */}
      <section aria-labelledby="ekle-baslik">
        <h2 id="ekle-baslik" className="text-h3 text-ink-900">Yeni paket</h2>
        {/* ⚠️ Formun altında da yazılı: paket açmak bakiyeye dokunmaz. */}
        <div className="mt-4">
          <PackageForm />
        </div>
      </section>

      {/* ──────────────────────────── LİSTE ──────────────────────────────── */}
      <section aria-labelledby="liste-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="liste-baslik" className="text-h3 text-ink-900">Tüm paketler</h2>
          {/* ⚠️ SIRA YAZILI. Yazılmazsa "neden bu sırada?" sorusu her
              seferinde tabloya bakarak tahmin edilir. */}
          <p className="text-caption text-ink-500">
            Bitişi en yakın olan üstte — süresi dolan ve iptaller en altta
          </p>
        </div>
        {data.rows.length === 0 ? (
          <div className="mt-4 rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-8 text-center">
            <p className="text-body text-ink-700">Henüz paket yok.</p>
            <p className="mt-1 text-small text-ink-500">Eklediğin paketler burada listelenir.</p>
          </div>
        ) : (
          /**
           * ⚠️ TABLO SIKI TUTULUR: satır başına TEK SATIR yükseklik hedefi.
           *
           * Önceki hâlinde hizmet adı beş satıra sarıyor, işlem düğmeleri alt
           * alta diziliyordu; ekrana dört paket sığıyordu ve tablo bir liste
           * değil paragraf yığını gibi okunuyordu. Şimdi hizmet adı iki
           * satıra kırpılıyor (tamamı `title` ile duruyor, bilgi kaybı yok)
           * ve işlemler `RowMenu` içine giriyor.
           */
          <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            <table className="w-full border-collapse text-small">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Müşteri</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Hizmet</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Dönem</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Durum</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Satış</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Maliyet</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Net kâr</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Ödeme</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.rows.map((r) => (
                  /* ⚠️ Zebra: göz, dokuz sütunlu bir satırı şeritsiz takip
                     ederken bir üst satıra kayıyor. */
                  <tr key={r.id} className="align-middle odd:bg-white even:bg-ink-50">
                    <td className="max-w-[14rem] truncate px-3 py-2 font-medium text-ink-900" title={r.customerName}>
                      {r.customerName}
                    </td>
                    <td className="max-w-[20rem] px-3 py-2 text-ink-700" title={r.serviceName}>
                      {/* ⚠️ Kırpma GİZLEME DEĞİL: tam metin `title`da duruyor
                          ve düzenleme kutusunda zaten görünüyor. */}
                      <span className="line-clamp-2">{r.serviceName}</span>
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-ink-600">
                      {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${STATE_CLASS[r.state]}`}>
                        {STATE_LABEL[r.state]}
                      </span>
                      {/* ⚠️ Liste bitiş tarihine göre sıralı; kalan günü
                          yazmak sıranın SEBEBİNİ satırda görünür kılar. */}
                      {LIVING.has(r.state) && (
                        <span className="tabular ml-1.5 text-caption text-ink-500">
                          {r.daysLeft} g
                        </span>
                      )}
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-900">
                      {formatMinor(r.salePriceMinor)}
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-600">
                      {formatMinor(r.costMinor)}
                    </td>
                    {/* ⚠️ EKSİ NET KÂR KIRMIZI. Ekranda 250 ₺ satışa karşı
                        1.250 ₺ maliyetli bir paket duruyordu ve eksi kâr
                        diğerleriyle aynı siyahtı — göze çarpmıyordu. */}
                    <td
                      className={`tabular whitespace-nowrap px-3 py-2 text-right font-medium ${
                        r.netMinor < 0 ? 'text-danger-600' : 'text-ink-900'
                      }`}
                    >
                      {formatMinor(r.netMinor)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-600">
                      {r.paidAt ? (
                        <span className="text-success-700">Tahsil · {fmtDate(r.paidAt)}</span>
                      ) : (
                        <span className="text-ink-500">Bekliyor</span>
                      )}
                      {/* ⚠️ İPTAL AMA TAHSİL EDİLMİŞ: para kasada duruyor,
                          paket cirosuna girmiyor. Bu fark görünmezse
                          "rakamlar neden tutmuyor?" sorusu cevapsız kalır. */}
                      {r.state === 'IPTAL' && r.paidAt && (
                        <span className="mt-0.5 block text-caption text-warning-700">
                          para kasada — iade elle girilmeli
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/*
                        ⚠️ İŞLEMLER MENÜNÜN İÇİNDE. "Tahsil et", "Gideri işle"
                        ve "İptal" her satırda açıkta durduğunda tablo
                        okunamıyordu. Yetenek KALDIRILMADI — tahsilat hâlâ
                        banka bakiyesini artıran tek yol; yalnızca bir tık
                        geriye alındı.
                      */}
                      <RowMenu>
                        <PackageActions
                          id={r.id}
                          accounts={accountOptions}
                          saleLabel={formatMinor(r.salePriceMinor)}
                          costLabel={formatMinor(r.costMinor)}
                          isPaid={Boolean(r.paidAt)}
                          canCollect={!r.paidAt && r.state !== 'IPTAL'}
                          canRecordCost={r.costMinor > 0 && !r.costEntryId && r.state !== 'IPTAL'}
                          canCancel={r.state !== 'IPTAL'}
                        />
                        {/*
                          ⚠️ Müşteri, hizmet, tarihler ve not HER ZAMAN
                          düzenlenir. Satış ve maliyet yalnızca bağlı kasa
                          hareketi YOKKEN — bu oturumda 79.000 TL'lik sessiz
                          farkla kanıtlanan kusurun kapısı budur.
                        */}
                        <InlineEdit
                          endpoint={`/api/v1/admin/kasa/paketler/${r.id}/duzenle`}
                          method="POST"
                          fields={[
                            { kind: 'text', name: 'customerName', label: 'Müşteri', value: r.customerName, required: true },
                            { kind: 'text', name: 'serviceName', label: 'Hizmet', value: r.serviceName, required: true },
                            { kind: 'date', name: 'startDate', label: 'Başlangıç', value: isoDay(r.startDate), required: true },
                            { kind: 'date', name: 'endDate', label: 'Bitiş', value: isoDay(r.endDate), required: true },
                            {
                              kind: 'money',
                              name: 'salePriceMinor',
                              label: 'Satış',
                              valueMinor: r.salePriceMinor,
                              required: true,
                              frozen: r.paymentEntryId ? 'Tahsilat yazılmış — tutar donmuş' : undefined,
                            },
                            {
                              kind: 'money',
                              name: 'costMinor',
                              label: 'Maliyet',
                              valueMinor: r.costMinor,
                              required: true,
                              frozen: r.costEntryId ? 'Gider yazılmış — maliyet donmuş' : undefined,
                            },
                            { kind: 'text', name: 'note', label: 'Not', value: r.note ?? '' },
                          ]}
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

/** `<input type="date">` için gün. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
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

function RetentionList({
  title,
  rows,
  tone,
}: {
  title: string
  rows: Array<{ customerName: string; lastEndDate: Date }>
  tone: 'success' | 'danger'
}) {
  return (
    <div className="overflow-hidden rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
      <h3 className="flex items-center justify-between border-b border-ink-100 bg-ink-50 px-4 py-2.5 text-small font-semibold text-ink-900">
        {title}
        <span className={tone === 'success' ? 'text-success-700' : 'text-danger-600'}>
          {rows.length}
        </span>
      </h3>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-caption text-ink-500">Kayıt yok.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.customerName} className="flex justify-between gap-3 px-4 py-2.5">
              <span className="truncate text-small text-ink-800">{r.customerName}</span>
              <span className="tabular shrink-0 text-caption text-ink-500">
                bitiş {fmtDate(r.lastEndDate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
