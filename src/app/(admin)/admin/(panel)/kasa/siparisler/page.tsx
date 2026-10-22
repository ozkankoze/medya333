import { Fragment } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AySecici } from '@/components/kasa/AySecici'
import { GunSeridi, type GunOzeti } from '@/components/kasa/GunSeridi'
import { KasaTabs } from '@/components/kasa/KasaTabs'
import { SiparisAraclari, type DisaAktarSatiri } from '@/components/kasa/SiparisAraclari'
import { ManualOrderActions } from '@/components/kasa/ManualOrderActions'
import { InlineEdit } from '@/components/kasa/InlineEdit'
import { ManualOrderForm } from '@/components/kasa/ManualOrderForm'
import { OdemeCell } from '@/components/kasa/OdemeCell'
import { RowMenu } from '@/components/kasa/RowMenu'
import { ORDER_STATUS_LABEL, summarizeOrders, type ManualOrderStatus } from '@/lib/kasa/orders'
import { formatMinor } from '@/lib/money'
import { getSessionUser } from '@/server/auth'
import { listAccounts } from '@/server/kasa'
import { getOrders, musteriAdlari, type OrderRow } from '@/server/kasa/orders'

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
  searchParams: Promise<{ y?: string; m?: string; g?: string; q?: string; f?: string }>
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

  const q = (sp.q ?? '').trim()
  // ⚠️ BİLİNMEYEN SÜZGEÇ = SÜZGEÇ YOK. Adresten gelen değere güvenilmez.
  const f = ['yeni', 'odenmedi', 'gecikmis', 'iptal'].includes(sp.f ?? '') ? sp.f! : ''

  const [data, accounts, musteriler] = await Promise.all([
    getOrders(year, month),
    listAccounts(),
    musteriAdlari(),
  ])
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
  // ⚠️ BUGÜN UTC GÜN BAŞINA SABİTLENİR: `dueDate` de öyle tutuluyor;
  //    saatli bir karşılaştırma, vadesi bugün olan satırı "gecikmiş"
  //    gösterebilirdi.
  const bugunUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const gecikmeGunu = (r: OrderRow): number | null => {
    if (r.paidAt || !r.dueDate || r.status === 'IPTAL') return null
    const fark = bugunUtc - r.dueDate.getTime()
    return fark > 0 ? Math.floor(fark / 86_400_000) : null
  }

  const gunSuzulmus =
    seciliGun === null
      ? data.rows
      : data.rows.filter((r) => r.occurredAt.getUTCDate() === seciliGun)

  // ⚠️ ARAMA TÜRKÇE KÜÇÜLTMEYLE: "İ" harfi `toLowerCase()` ile "i̇" olur ve
  //    "İzmir" araması "izmir" satırını bulamazdı.
  const kucult = (t: string) => t.toLocaleLowerCase('tr')
  const aranan = kucult(q)
  const satirlar = gunSuzulmus.filter((r) => {
    if (aranan && !kucult(`${r.customerName} ${r.description}`).includes(aranan)) return false
    if (f === 'yeni') return r.yeniMusteri
    if (f === 'odenmedi') return !r.paidAt && r.status !== 'IPTAL'
    if (f === 'gecikmis') return gecikmeGunu(r) !== null
    if (f === 'iptal') return r.status === 'IPTAL'
    return true
  })
  const suzuluyor = Boolean(q) || Boolean(f)

  // ⚠️ GÜN ÖZETİ AYNI SAF FONKSİYONLA hesaplanır. Ekranda ikinci bir
  //    toplama mantığı yazılsaydı, iptal ve tahsilat kuralları zamanla
  //    ay özetinden ayrışırdı.
  const ozet =
    seciliGun === null && !suzuluyor
      ? data.summary
      : summarizeOrders(satirlar, { year, month1: month })
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

  /* ── Excel çıkışı için düz satırlar ─────────────────────────────────── */
  // ⚠️ Rakamlar ekranla AYNI biçimde yazılır (1.250,00 ₺). Ham kuruş
  //    yazılsaydı, dosyayı açan kişi 125000 görüp yanlış okurdu.
  const disaAktar: DisaAktarSatiri[] = satirlar.map((r) => ({
    tarih: fmtDate(r.occurredAt),
    musteri: r.customerName,
    islem: r.description,
    fiyat: formatMinor(r.salePriceMinor),
    maliyet: formatMinor(r.costMinor),
    net: formatMinor(r.netMinor),
    durum: ORDER_STATUS_LABEL[r.status],
    odeme: r.paidAt
      ? `${r.paidAccountName ?? 'Tahsil'} · ${fmtDate(r.paidAt)}`
      : r.dueDate
        ? `Beklenen: ${fmtDate(r.dueDate)}`
        : '',
  }))
  const dosyaAdi =
    seciliGun === null
      ? `medya333-siparisler-${year}-${String(month).padStart(2, '0')}`
      : `medya333-siparisler-${year}-${String(month).padStart(2, '0')}-${String(seciliGun).padStart(2, '0')}`

  /* ── Görünen satırların toplamı (tablo altı) ────────────────────────── */
  // ⚠️ SÜZÜLMÜŞ LİSTENİN TOPLAMI, ayın değil. Üstteki özet kutuları da aynı
  //    seçime bakar; ikisinin farklı rakam göstermesi güveni bitirirdi.
  const gecerliSatirlar = satirlar.filter((r) => r.status !== 'IPTAL')
  const toplamSatis = gecerliSatirlar.reduce((a, r) => a + r.salePriceMinor, 0)
  const toplamMaliyet = gecerliSatirlar.reduce((a, r) => a + r.costMinor, 0)

  /**
   * Ay görünümünde satırları HAFTAYA böler.
   *
   * ⚠️ YALNIZCA AY GENELİNDE. Tek gün seçiliyken hafta ayracı tek bir
   * başlıktan ibaret kalır, bilgi vermez.
   *
   * ⚠️ HAFTA PAZARTESİ BAŞLAR (Türkiye'deki alışkanlık). Pazar başlangıcı
   * seçilseydi, hafta sonu iki ayrı haftaya bölünürdü.
   */
  const haftaNo = (d: Date): number => {
    const gun = (new Date(d).getUTCDay() + 6) % 7 // 0 = Pazartesi
    const pazartesi = d.getTime() - gun * 86_400_000
    return Math.floor(pazartesi / 86_400_000)
  }
  type Blok = { hafta: number; baslik: string; satirlar: OrderRow[] }
  const bloklar: Blok[] = []
  if (seciliGun === null) {
    for (const r of satirlar) {
      const h = haftaNo(r.occurredAt)
      let blok = bloklar.find((b) => b.hafta === h)
      if (!blok) {
        const pazartesi = new Date(h * 86_400_000)
        const pazar = new Date(pazartesi.getTime() + 6 * 86_400_000)
        blok = { hafta: h, baslik: `${fmtDate(pazartesi)} – ${fmtDate(pazar)}`, satirlar: [] }
        bloklar.push(blok)
      }
      blok.satirlar.push(r)
    }
  } else {
    bloklar.push({ hafta: 0, baslik: '', satirlar: satirlar.slice() })
  }

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
          <ManualOrderForm musteriler={musteriler} />
        </div>
      </section>

      {/* ──────────────────────────── LİSTE ──────────────────────────────── */}
      <section aria-labelledby="liste-baslik">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="liste-baslik" className="text-h3 text-ink-900">{secimAdi}</h2>
          <p className="tabular text-caption text-ink-500">
            {satirlar.length} kayıt
            {suzuluyor && gunSuzulmus.length !== satirlar.length
              ? ` · ${gunSuzulmus.length} kayıttan süzüldü`
              : ''}
          </p>
        </div>

        <div className="mt-3">
          <SiparisAraclari
            temelHref={TEMEL_HREF}
            year={year}
            month1={month}
            gun={seciliGun}
            q={q}
            f={f}
            dosyaAdi={dosyaAdi}
            satirlar={disaAktar}
          />
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
          <>
          {/* ⚠️ TELEFONDA TABLO DEĞİL KART. Sekiz sütunluk bir tabloyu
              telefonda yatay kaydırmak, defteri okunamaz kılıyordu; sipariş
              çoğu zaman yolda, telefondan bakılarak kontrol ediliyor.
              Masaüstündeki tablo olduğu gibi duruyor. */}
          <ul className="mt-4 flex flex-col gap-2 md:hidden">
            {satirlar.map((r) => (
              <li
                key={r.id}
                className={
                  'rounded-[--radius-card] border p-3 ' +
                  (r.yeniMusteri
                    ? 'border-yeni-200 bg-yeni-50'
                    : 'border-ink-200 bg-white shadow-[--shadow-card]')
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`${TEMEL_HREF}/musteri/${encodeURIComponent(r.customerName)}`}
                    className="truncate font-semibold text-ink-900 underline-offset-2 hover:underline"
                  >
                    {r.customerName}
                  </Link>
                  <span className="tabular shrink-0 text-small font-semibold text-ink-900">
                    {formatMinor(r.salePriceMinor)}
                  </span>
                </div>
                <p className="mt-0.5 text-small text-ink-700">{r.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-caption">
                  <span className="tabular text-ink-500">{fmtDate(r.occurredAt)}</span>
                  {r.yeniMusteri && (
                    <span className="rounded-full bg-yeni-600 px-1.5 py-0.5 font-semibold text-white">
                      Yeni müşteri
                    </span>
                  )}
                  {r.status !== 'BEKLIYOR' && (
                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${STATUS_CLASS[r.status]}`}>
                      {ORDER_STATUS_LABEL[r.status]}
                    </span>
                  )}
                  {r.paidAt ? (
                    <span className="text-success-700">
                      {r.paidAccountName ?? 'Tahsil'} · {fmtDate(r.paidAt)}
                    </span>
                  ) : gecikmeGunu(r) !== null ? (
                    <span className="font-semibold text-danger-600">
                      {gecikmeGunu(r)} gün gecikti
                    </span>
                  ) : (
                    <span className="text-warning-700">tahsil edilmedi</span>
                  )}
                  <span className="tabular ml-auto text-ink-500">
                    net {formatMinor(r.netMinor)}
                  </span>
                </div>
              </li>
            ))}
            <li className="rounded-[--radius-card] border border-ink-300 bg-ink-50 px-3 py-2 text-small font-semibold text-ink-900">
              <span className="flex justify-between">
                <span>Toplam · {gecerliSatirlar.length} sipariş</span>
                <span className="tabular">{formatMinor(toplamSatis)}</span>
              </span>
            </li>
          </ul>

          <div className="mt-4 hidden overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card] md:block">
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
                {bloklar.map((blok) => (
                  <Fragment key={blok.hafta}>
                    {/* ⚠️ HAFTA AYRACI yalnızca ay görünümünde ve birden çok
                        hafta varken. Tek haftalık bir listede ayraç,
                        bilgi değil gürültüdür. */}
                    {seciliGun === null && bloklar.length > 1 && (
                      <tr className="border-y border-ink-200 bg-ink-100/80">
                        <td colSpan={8} className="px-3 py-1.5">
                          <span className="flex flex-wrap items-baseline justify-between gap-2 text-caption">
                            <span className="font-semibold uppercase tracking-wide text-ink-600">
                              Hafta · {blok.baslik}
                            </span>
                            <span className="tabular text-ink-700">
                              {blok.satirlar.filter((x) => x.status !== 'IPTAL').length} sipariş ·{' '}
                              {formatMinor(
                                blok.satirlar
                                  .filter((x) => x.status !== 'IPTAL')
                                  .reduce((a, x) => a + x.salePriceMinor, 0),
                              )}
                            </span>
                          </span>
                        </td>
                      </tr>
                    )}
                    {blok.satirlar.map((r) => (
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
                      {/* ⚠️ AD BİR BAĞLANTI: o müşterinin bütün geçmişi tek
                          tıkla açılır. Satırın geri kalanı tıklanabilir
                          YAPILMADI — satıra basınca sayfa değiştiren bir
                          tablo, düzenlemeye uzanan eli yanlışlıkla başka
                          yere götürür. */}
                      <Link
                        href={`${TEMEL_HREF}/musteri/${encodeURIComponent(r.customerName)}`}
                        title={`${r.customerName} — geçmişi`}
                        className="block truncate underline-offset-2 hover:underline"
                      >
                        {r.customerName}
                      </Link>
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
                      {/* ⚠️ GECİKEN ALACAK SAYIYLA GÖSTERİLİR. "Gecikti"
                          demek yetmez: üç gün ile üç ay aynı görünürdü. */}
                      {gecikmeGunu(r) !== null && (
                        <span className="mt-0.5 block text-caption font-semibold text-danger-600">
                          {gecikmeGunu(r)} gün gecikti
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
                  </Fragment>
                ))}
              </tbody>
              {/* ⚠️ GÖRÜNEN SATIRLARIN TOPLAMI. Uzun bir listede göz, üstteki
                  özet kutusuna geri dönmek yerine burada toplamı bulur. */}
              <tfoot>
                <tr className="border-t-2 border-ink-300 bg-ink-50 font-semibold text-ink-900">
                  <td className="px-3 py-2 text-caption uppercase tracking-wide text-ink-600" colSpan={3}>
                    Toplam · {gecerliSatirlar.length} sipariş
                    {satirlar.length !== gecerliSatirlar.length && (
                      <span className="ml-1 font-normal normal-case tracking-normal text-ink-500">
                        (iptaller hariç)
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{formatMinor(toplamSatis)}</td>
                  <td className="tabular px-3 py-2 text-right text-ink-600">
                    {formatMinor(toplamMaliyet)}
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {formatMinor(toplamSatis - toplamMaliyet)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          </>
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
