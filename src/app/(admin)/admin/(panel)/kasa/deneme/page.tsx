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
import { getPackages, getTrialConversion } from '@/server/kasa/packages'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Deneme Paketleri',
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
 * /admin/kasa/deneme — DENEME PAKETLERİ
 *
 * Aylık paketlerle AYNI MANTIK: aynı tablo, aynı tahsilat akışı, aynı
 * düzenleme ve dondurma kuralları. Tek fark `isTrial` bayrağı ve bu
 * ekranın sorduğu soru.
 *
 * ⚠️⚠️ BU EKRANIN SORDUĞU SORU FARKLI: aylık pakette "ne kadar kazandım?",
 * burada "kaç deneme ücretli müşteriye DÖNÜŞTÜ?". Deneme genelde ücretsiz
 * ya da sembolik bedelli olduğu için ciroya bakmak bir şey anlatmaz;
 * kampanyanın işe yarayıp yaramadığını dönüşüm oranı söyler.
 *
 * ⚠️ DÖNÜŞÜM BİR ÇIKARIMDIR, kaydedilmiş bir gerçek değil — kural ekranda
 * yazılıdır (bkz. `getTrialConversion`).
 */
export default async function TrialPackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>
}) {
  const user = await getSessionUser()
  // ⚠️ Oturumsuz istek personel kapısına, yetkisiz oturum panele döner.
  //    İkisini tek satırda birleştirmek, oturumsuz ziyaretçiyi düzenin
  //    yeniden yönlendireceği bir sayfaya göndermek olurdu.
  if (!user) redirect('/admin/giris?next=/admin/kasa/deneme')
  if (user.role !== 'SUPERADMIN') redirect('/admin/notifications')

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.y) || now.getUTCFullYear()
  const month = Number(sp.m) || now.getUTCMonth() + 1

  const [data, accounts, conversion] = await Promise.all([
    // ⚠️ `trial: true` — bu sayfa YALNIZCA deneme paketlerini gösterir.
    getPackages(year, month, { trial: true }),
    listAccounts(),
    getTrialConversion(),
  ])
  const accountOptions = accounts.map((a) => ({ id: a.id, label: `${a.owner} · ${a.name}` }))

  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )

  return (
    <div className="flex flex-col gap-8">
      {/* ⚠️ Sekme çubuğu üç kasa sayfasında da AYNI bileşenden gelir.
          Her sayfaya elle kopyalansaydı, dördüncü bir sekme eklendiğinde
          birinde unutulur ve o sayfadan diğerine geçilemezdi. */}
      <KasaTabs active="deneme" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">Deneme Paketleri</h1>
          <p className="mt-1 text-small text-ink-600">
            Ücretsiz / tanıtım denemeleri — elle yönetilir, otomatik yenileme yoktur
          </p>
          <p className="mt-0.5 text-caption text-ink-500">
            Ücretli işler burada görünmez —{' '}
            <a href="/admin/kasa/paketler" className="font-medium text-brand-700 underline">
              Aylık Paketler
            </a>
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
          <Stat label="Bu ay açılan deneme" value={String(data.summary.monthCount)} />
        </div>

        {/*
          ⚠️⚠️ ASIL ÖLÇÜ BU. Deneme genelde ücretsiz ya da sembolik
          bedelli; yukarıdaki ciro satırı çoğu zaman sıfır olacak ve tek
          başına hiçbir şey anlatmaz. Kampanyanın işe yarayıp yaramadığını
          dönüşüm söyler.
        */}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label="Ücretliye dönüşen" value={String(conversion.convertedCount)} />
          <Stat label="Dönüşmeyen" value={String(conversion.notConvertedCount)} />
          <Stat label="Denemesi sürüyor" value={String(conversion.pendingCount)} muted />
        </div>
        <p className="mt-2 text-caption leading-relaxed text-ink-500">
          <strong>Dönüşüm bir çıkarımdır:</strong> bir denemenin müşterisi için, o denemenin
          bitiş tarihinden <strong>sonra başlayan</strong> ücretli bir paket varsa dönüşmüş
          sayılır. Denemesi henüz bitmemiş olanlar hiçbir tarafa yazılmaz; iptaller sayılmaz.
        </p>

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

      {/* ⚠️ "Müşteri devamlılığı" bloğu BURADA YOK: denemede sorulan soru
          "yenilendi mi?" değil "ücretliye dönüştü mü?". İkisi birden
          gösterilseydi iki benzer ama farklı oran yan yana durur ve
          hangisine bakılacağı belirsizleşirdi. */}

      {/* ────────────────────────── PAKET EKLE ───────────────────────────── */}
      <section aria-labelledby="ekle-baslik">
        <h2 id="ekle-baslik" className="text-h3 text-ink-900">Yeni deneme</h2>
        {/* ⚠️ Formun altında da yazılı: paket açmak bakiyeye dokunmaz. */}
        <div className="mt-4">
          {/* ⚠️ `isTrial` ŞART: gönderilmezse kayıt normal paket olarak
              açılır ve aylık ciroya karışır. */}
          <PackageForm isTrial />
        </div>
      </section>

      {/* ──────────────────────────── LİSTE ──────────────────────────────── */}
      <section aria-labelledby="liste-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="liste-baslik" className="text-h3 text-ink-900">Tüm denemeler</h2>
          {/* ⚠️ SIRA YAZILI. Yazılmazsa "neden bu sırada?" sorusu her
              seferinde tabloya bakarak tahmin edilir. */}
          <p className="text-caption text-ink-500">
            Bitişi en yakın olan üstte — süresi dolan ve iptaller en altta
          </p>
        </div>
        {data.rows.length === 0 ? (
          <div className="mt-4 rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-8 text-center">
            <p className="text-body text-ink-700">Henüz deneme paketi yok.</p>
            <p className="mt-1 text-small text-ink-500">Eklediklerin burada listelenir.</p>
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

