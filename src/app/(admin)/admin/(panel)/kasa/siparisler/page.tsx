import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AySecici } from '@/components/kasa/AySecici'
import { GunSeridi, type GunOzeti } from '@/components/kasa/GunSeridi'
import { KasaTabs } from '@/components/kasa/KasaTabs'
import { ManualOrderActions } from '@/components/kasa/ManualOrderActions'
import { InlineEdit } from '@/components/kasa/InlineEdit'
import { ManualOrderForm } from '@/components/kasa/ManualOrderForm'
import { OdemeCell } from '@/components/kasa/OdemeCell'
import { RowMenu } from '@/components/kasa/RowMenu'
import { ORDER_STATUS_LABEL, summarizeOrders, type ManualOrderStatus } from '@/lib/kasa/orders'
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
 * ⚠️ SÜTUN SIRASI TABLOYLA BİREBİR: Tarih · Kullanıcı adı · İşlem · Fiyat ·
 * Maliyet · Net kâr · Ödeme. Alışılmış bir düzeni "daha mantıklı" diye
 * değiştirmek, yıllardır aynı sırayla okuyan gözü her satırda yavaşlatır.
 *
 * ⚠️⚠️ BU EKRAN SİTEDEKİ SİPARİŞLERİ GÖSTERMEZ. Siteden gelen gerçek
 * müşteri siparişleri ayrı bir tablodadır ve panelde artık hiç
 * görüntülenmez (İş Kuyruğu ekranı kaldırıldı). Burası işletmenin kendi
 * defteridir — elle girilir, elle silinir.
 *
 * ⚠️ AYLIK TOPLAMLAR SİPARİŞ TARİHİNE GÖREDİR, tahsil tarihine göre değil.
 * "Bu ay ne kadar iş yaptım?" ile "bu ay kasaya ne kadar girdi?" farklı
 * sorulardır; ikincisi Kasa sekmesindedir. Rakamların farklı olması normal
 * ve başlıklarda hangi aralığın geçerli olduğu yazılıdır.
 */
const TEMEL_HREF = '/admin/kasa/siparisler'

export default async function ManualOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; g?: string }>
}) {
  const user = await getSessionUser()
  // ⚠️ Oturumsuz istek personel kapısına, yetkisiz oturum panele döner.
  if (!user) redirect('/admin/giris?next=/admin/kasa/siparisler')
  if (user.role !== 'SUPERADMIN') redirect('/admin/notifications')

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.y) || now.getUTCFullYear()
  const month = Number(sp.m) || now.getUTCMonth() + 1
  const gunSayisi = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // ⚠️ GEÇERSİZ GÜN SESSİZCE AY GENELİNE DÜŞER. Hata sayfası göstermek,
  //    adresi elle kurcalayan tek kullanıcı için gereksiz sert olurdu.
  const gunParam = Number(sp.g)
  const seciliGun =
    Number.isInteger(gunParam) && gunParam >= 1 && gunParam <= gunSayisi ? gunParam : null

  const [data, accounts] = await Promise.all([getOrders(year, month), listAccounts()])
  const accountOptions = accounts.map((a) => ({ id: a.id, label: `${a.owner} · ${a.name}` }))

  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )

  /* ── Gün şeridi: ayın satırlarından türetilir, ayrı sorgu yok ───────── */
  const gunler: GunOzeti[] = Array.from({ length: gunSayisi }, (_, i) => ({
    gun: i + 1,
    adet: 0,
    tutarMinor: 0,
    yeniMusteri: false,
  }))
  for (const r of data.rows) {
    const g = gunler[r.occurredAt.getUTCDate() - 1]
    if (!g) continue
    g.adet += 1
    // ⚠️ İptaller gün toplamına GİRMEZ: üstteki özetle aynı kural.
    if (r.status !== 'IPTAL') g.tutarMinor += r.salePriceMinor
    if (r.yeniMusteri) g.yeniMusteri = true
  }

  /* ── Seçime göre satırlar ve özet ───────────────────────────────────── */
  const satirlar =
    seciliGun === null
      ? data.rows
      : data.rows.filter((r) => r.occurredAt.getUTCDate() === seciliGun)

  // ⚠️ GÜN ÖZETİ AYNI SAF FONKSİYONLA hesaplanır. Ekranda ikinci bir
  //    toplama mantığı yazılsaydı, iptal ve tahsilat kuralları zamanla
  //    ay özetinden ayrışırdı.
  const ozet = seciliGun === null ? data.summary : summarizeOrders(satirlar, { year, month1: month })
  const yeniMusteriAdedi = satirlar.filter((r) => r.yeniMusteri).length

  const secimAdi =
    seciliGun === null
      ? `${monthName} · ay geneli`
      : new Intl.DateTimeFormat('tr-TR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          weekday: 'long',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(year, month - 1, seciliGun)))

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
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Ay adımı" className="flex items-center gap-2">
            <a href={`${TEMEL_HREF}?y=${prev.y}&m=${prev.m}`} className={navLink}>
              ← Önceki
            </a>
            <a href={`${TEMEL_HREF}?y=${next.y}&m=${next.m}`} className={navLink}>
              Sonraki →
            </a>
          </nav>
          <AySecici year={year} month1={month} temelHref={TEMEL_HREF} />
        </div>
      </header>

      <GunSeridi
        year={year}
        month1={month}
        gunler={gunler}
        secili={seciliGun}
        temelHref={TEMEL_HREF}
        // ⚠️ GÜN KUTUSUNDA KURUŞ YOK (compact). Otuz bir kutunun hepsinde
        //    ",00" yazmak rakamı kutuya sığdırmıyordu ve tarama sırasında
        //    hiçbir şey anlatmıyor; kesin rakam zaten tablodadır.
        bicimle={(m) => formatMinor(m, { compact: true })}
      />

      {/*
        ⚠️ BU AYRIM EKRANDA YAZILI OLMALI. Yazmasaydı, "İş Kuyruğu'ndaki
        siparişler neden burada yok?" sorusu kaçınılmazdı ve cevabı hiçbir
        yerde bulunamazdı.
      */}
      <p className="rounded-[--radius-card] border border-ink-200 bg-ink-50 px-4 py-3 text-caption leading-relaxed text-ink-600">
        <strong>Ödeme</strong> sütununa <strong>tarih</strong> yazarsan satır alacak olur ve
        panelin ana sayfasında görünür; <strong>hesap adı</strong> yazarsan (
        {accounts.map((a) => a.name).join(', ') || 'önce hesap ekleyin'}) o hesaba gelir yazılır
        ve bakiye artar.
      </p>

      {/* ──────────────────────────── ÖZET ───────────────────────────────── */}
      <section aria-labelledby="ozet-baslik">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="ozet-baslik" className="text-h3 text-ink-900">Özet</h2>
          {/* ⚠️ HANGİ ARALIĞIN TOPLANDIĞI HER ZAMAN YAZILI. Gün seçiliyken
              ay rakamını görmeyi bekleyen göz, yazmasaydı yanlış okurdu. */}
          <p className="text-caption text-ink-500">
            {secimAdi} — sipariş TARİHİNE göre
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Toplam sipariş tutarı" value={formatMinor(ozet.monthSaleMinor)} />
          <Stat label="Toplam maliyet" value={formatMinor(ozet.monthCostMinor)} />
          <Stat label="Net kâr" value={formatMinor(ozet.monthNetMinor)} strong />
          <Stat label="Sipariş adedi" value={String(ozet.monthCount)} muted />
          <Stat label="Yeni müşteri" value={String(yeniMusteriAdedi)} yeni />
        </div>

        {/* ⚠️ TAHSİL EDİLMEMİŞ TUTAR AYRI GÖSTERİLİR. Ciroya bakıp "bu para
            bende" sanmak, en pahalı yanlış okumadır. */}
        {ozet.monthUnpaidMinor > 0 && (
          <p className="mt-3 rounded-[--radius-card] border border-warning-300 bg-warning-50 px-4 py-3 text-small text-warning-800">
            {seciliGun === null ? 'Bu ayın' : 'Bu günün'} siparişlerinden{' '}
            <strong>{formatMinor(ozet.monthUnpaidMinor)}</strong> henüz tahsil edilmedi — bu tutar
            yukarıdaki cirodadır ama bankada değildir.
          </p>
        )}
        {ozet.monthCanceledCount > 0 && (
          <p className="mt-2 text-caption text-ink-500">
            {ozet.monthCanceledCount} iptal edilmiş sipariş toplamlara dâhil edilmedi.
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
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="liste-baslik" className="text-h3 text-ink-900">{secimAdi}</h2>
          <p className="tabular text-caption text-ink-500">{satirlar.length} kayıt</p>
        </div>
        {satirlar.length === 0 ? (
          <div className="mt-4 rounded-[--radius-card] border border-dashed border-ink-300 bg-white p-8 text-center">
            <p className="text-body text-ink-700">
              {seciliGun === null ? 'Bu ayda sipariş yok.' : 'Bu günde sipariş yok.'}
            </p>
            <p className="mt-1 text-small text-ink-500">
              Eklediğin siparişler burada listelenir.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]">
            <table className="w-full border-collapse text-small">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-left text-caption uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Tarih</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Kullanıcı adı</th>
                  <th scope="col" className="px-3 py-2 font-semibold">İşlem</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Fiyat</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Maliyet</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Net kâr</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Ödeme</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {satirlar.map((r) => (
                  <tr
                    key={r.id}
                    // ⚠️ YENİ MÜŞTERİ SATIRI PEMBE ZEMİN + SOL KENAR ÇİZGİSİ.
                    //    Yalnızca rozet konsaydı, uzun bir listede göz onu
                    //    satır satır aramak zorunda kalırdı; yalnızca zemin
                    //    olsaydı renk körlüğünde hiçbir fark kalmazdı.
                    className={
                      'align-middle ' +
                      (r.yeniMusteri
                        ? 'bg-yeni-50 shadow-[inset_3px_0_0_var(--color-yeni-600)]'
                        : 'odd:bg-white even:bg-ink-50')
                    }
                  >
                    <td className="tabular whitespace-nowrap px-3 py-2 text-ink-600">
                      {fmtDate(r.occurredAt)}
                    </td>
                    <td className="max-w-[13rem] px-3 py-2 font-medium text-ink-900">
                      <span className="block truncate" title={r.customerName}>
                        {r.customerName}
                      </span>
                      {/* ⚠️ ROZETLER ADIN ALTINDA, KENDİ SATIRINDA. Adın
                          yanına dizilince iki rozet yan yana geldiğinde
                          ("Yeni müşteri" + "Tamamlandı") ikisi de kırpılıp
                          okunamaz hâle geliyordu. Alt satır, sütunu
                          genişletmeden ikisini de tam gösterir. */}
                      {(r.yeniMusteri || r.status !== 'BEKLIYOR') && (
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          {r.yeniMusteri && (
                            <span className="whitespace-nowrap rounded-full bg-yeni-600 px-1.5 py-0.5 text-caption font-semibold text-white">
                              Yeni müşteri
                            </span>
                          )}
                          {/* ⚠️ İPTAL DURUMU AYRI SÜTUN DEĞİL, BİR ETİKET.
                              Kendi sütununu hak edecek kadar sık
                              kullanılmıyor; sütun açmak diğer yedi sütunu
                              daraltırdı. */}
                          {r.status !== 'BEKLIYOR' && (
                            <span
                              className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-caption font-medium ${STATUS_CLASS[r.status]}`}
                            >
                              {ORDER_STATUS_LABEL[r.status]}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[22rem] px-3 py-2 text-ink-700" title={r.description}>
                      <span className="line-clamp-2">{r.description}</span>
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-900">
                      {formatMinor(r.salePriceMinor)}
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink-600">
                      {formatMinor(r.costMinor)}
                    </td>
                    {/* ⚠️ EKSİ NET KÂR KIRMIZI — diğerleriyle aynı siyah
                        olsaydı zarar eden satır göze çarpmazdı. */}
                    <td
                      className={`tabular whitespace-nowrap px-3 py-2 text-right font-medium ${
                        r.netMinor < 0 ? 'text-danger-600' : 'text-ink-900'
                      }`}
                    >
                      {formatMinor(r.netMinor)}
                    </td>
                    <td className="px-3 py-2">
                      <OdemeCell
                        orderId={r.id}
                        paidLabel={
                          r.paidAt
                            ? `${r.paidAccountName ?? 'Tahsil'} · ${fmtDate(r.paidAt)}`
                            : null
                        }
                        dueLabel={r.dueDate ? fmtDate(r.dueDate) : null}
                        hesapAdlari={accounts.map((a) => a.name)}
                      />
                      {/* ⚠️ İPTAL AMA TAHSİL EDİLMİŞ: para kasada duruyor,
                          ciroya girmiyor. Bu fark görünmezse "rakamlar neden
                          tutmuyor?" sorusu cevapsız kalır. */}
                      {r.status === 'IPTAL' && r.paidAt && (
                        <span className="mt-0.5 block text-caption text-warning-700">
                          para kasada — iade elle girilmeli
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RowMenu>
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
                        {/*
                          ⚠️ Kullanıcı adı, içerik ve tarih HER ZAMAN
                          düzenlenir. Tutar ve maliyet yalnızca o kayda bağlı
                          bir kasa hareketi YOKKEN — aksi hâlde kayıtla kasa
                          arasında sessiz bir fark açılırdı.
                        */}
                        <InlineEdit
                          endpoint={`/api/v1/admin/kasa/siparisler/${r.id}/duzenle`}
                          method="POST"
                          fields={[
                            { kind: 'text', name: 'customerName', label: 'Kullanıcı adı', value: r.customerName, required: true },
                            { kind: 'text', name: 'description', label: 'İşlem', value: r.description, required: true },
                            { kind: 'date', name: 'occurredAt', label: 'Tarih', value: isoDay(r.occurredAt), required: true },
                            {
                              kind: 'money',
                              name: 'salePriceMinor',
                              label: 'Fiyat',
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
  yeni,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
  /** "Yeni müşteri" kutusu — tabloda kullanılan pembeyle aynı dili konuşur. */
  yeni?: boolean
}) {
  return (
    <div
      className={`rounded-[--radius-card] border p-4 ${
        yeni
          ? 'border-yeni-200 bg-yeni-50'
          : muted
            ? 'border-ink-200 bg-ink-50'
            : 'border-ink-200 bg-white shadow-[--shadow-card]'
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`tabular mt-1 ${strong ? 'text-h3' : 'text-body'} font-semibold ${
          yeni ? 'text-yeni-700' : 'text-ink-900'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
