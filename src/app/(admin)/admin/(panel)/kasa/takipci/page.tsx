import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { KasaTabs } from '@/components/kasa/KasaTabs'
import { TakipciEkle } from '@/components/kasa/TakipciEkle'
import { TakipciIzgara, type IzgaraGunu } from '@/components/kasa/TakipciIzgara'
import { getSessionUser } from '@/server/auth'
import { dayStartUtc } from '@/server/kasa'
import { gunAnahtari, PENCERE_GUN, takipciIzgarasi } from '@/server/kasa/takipci'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Takipçi Siparişleri',
  robots: { index: false, follow: false },
}

/**
 * /admin/kasa/takipci — TAKİPÇİ SİPARİŞLERİ VE GÜNLÜK KONTROL
 *
 * ⚠️ BURASI PARA DEFTERİ DEĞİLDİR. Siparişler sekmesi "ne sattım, ne
 * kazandım" sorusunu yanıtlar; bu ekran teslim sonrasını izler: hangi
 * hesaba hangi gün bakıldı, düşüş var mı. Kasaya, ciroya ve kâra hiçbir
 * etkisi yoktur.
 *
 * ⚠️ SATIRLAR ELLE GİRİLİR. Otomatik bir takipçi sayacı YOKTUR ve
 * olmayacaktır: Instagram'ın sayısını izinsiz çekmek hem kırılgan hem de
 * platform kurallarına aykırıdır. Burada kaydedilen şey, senin bakıp
 * gördüğündür.
 *
 * ⚠️ PENCERE ON DÖRT GÜN. Bütün geçmişi tek ızgarada göstermek, üç ay
 * sonra yatay kaydırmaktan başka bir şey olmayan bir ekran üretirdi;
 * sayfalama okları ile geriye gidilir.
 */
export default async function TakipciPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string; arsiv?: string }>
}) {
  const user = await getSessionUser()
  // ⚠️ Oturumsuz istek personel kapısına, yetkisiz oturum panele döner.
  if (!user) redirect('/admin/giris?next=/admin/kasa/takipci')
  if (user.role !== 'SUPERADMIN') redirect('/admin/notifications')

  const sp = await searchParams
  const arsiv = sp.arsiv === '1'
  const bugun = dayStartUtc(new Date())

  // ⚠️ GEÇERSİZ TARİH SESSİZCE BUGÜNE DÜŞER; adresi elle kurcalayan tek
  //    kullanıcı için hata sayfası göstermek gereksiz sert olurdu.
  const istenen = /^\d{4}-\d{2}-\d{2}$/.test(sp.b ?? '')
    ? new Date(`${sp.b}T00:00:00.000Z`)
    : bugun
  const bitis = Number.isNaN(istenen.getTime())
    ? bugun
    : // ⚠️ İLERİ GİDİLEMEZ: gelecek günlerden oluşan boş bir ızgara,
      //    ekranın bozuk olduğu izlenimi verirdi.
      new Date(Math.min(istenen.getTime(), bugun.getTime()))

  const { gunler, satirlar } = await takipciIzgarasi({ bitis, arsiv })

  const kisaTarih = new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })
  const gunAdi = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' })
  const uzunTarih = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const izgaraGunleri: IzgaraGunu[] = gunler.map((g) => ({
    anahtar: gunAnahtari(g),
    etiket: kisaTarih.format(g),
    gunAdi: gunAdi.format(g).replace('.', ''),
    bugun: g.getTime() === bugun.getTime(),
    gelecek: g.getTime() > bugun.getTime(),
  }))

  const oncekiB = gunAnahtari(new Date(bitis.getTime() - 7 * 86_400_000))
  const sonrakiB = gunAnahtari(
    new Date(Math.min(bitis.getTime() + 7 * 86_400_000, bugun.getTime())),
  )
  const sondaMi = bitis.getTime() === bugun.getTime()
  const navLink =
    'rounded-[--radius-control] border border-ink-200 bg-white px-3 py-2 text-small text-ink-700 hover:bg-ink-50'

  /* ── Bugün kaç hesaba bakıldı? ──────────────────────────────────────── */
  const bugunAnahtar = gunAnahtari(bugun)
  const bugunBakilan = satirlar.filter((s) => s.isaretliGunler.includes(bugunAnahtar)).length
  const bugunKalan = satirlar.length - bugunBakilan

  return (
    <div className="flex flex-col gap-8">
      <KasaTabs active="takipci" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-900">Takipçi Siparişleri</h1>
          <p className="mt-1 text-small text-ink-600">
            {arsiv ? 'Arşiv' : 'Günlük kontrol listesi'} — {uzunTarih.format(gunler[0]!)} ile{' '}
            {uzunTarih.format(gunler[gunler.length - 1]!)} arası
          </p>
        </div>
        <nav aria-label="Tarih aralığı" className="flex flex-wrap items-center gap-2">
          <Link href={adres(oncekiB, arsiv)} className={navLink}>
            ← 7 gün geri
          </Link>
          <Link href={adres(sonrakiB, arsiv)} className={navLink} aria-disabled={sondaMi}>
            7 gün ileri →
          </Link>
          {!sondaMi && (
            <Link href={adres(gunAnahtari(bugun), arsiv)} className={navLink}>
              Bugüne dön
            </Link>
          )}
          <Link
            href={adres(gunAnahtari(bitis), !arsiv)}
            className="rounded-[--radius-control] px-3 py-2 text-small text-ink-600 underline-offset-2 hover:underline"
          >
            {arsiv ? 'Aktif listeye dön' : 'Arşiv'}
          </Link>
        </nav>
      </header>

      {/* ⚠️ BUGÜNÜN DURUMU EN ÜSTTE. Ekranın tek günlük sorusu "bugün
          hepsine baktım mı" sorusudur; ızgarayı saymak zorunda kalmamalı. */}
      {!arsiv && satirlar.length > 0 && (
        <p
          className={
            'rounded-[--radius-card] border px-4 py-3 text-small ' +
            (bugunKalan === 0
              ? 'border-success-100 bg-success-100/40 text-success-700'
              : 'border-warning-300 bg-warning-50 text-warning-800')
          }
        >
          {bugunKalan === 0 ? (
            <>
              Bugün listedeki <strong>{satirlar.length}</strong> hesabın hepsi kontrol edildi.
            </>
          ) : (
            <>
              Bugün <strong>{bugunBakilan}</strong> hesap kontrol edildi,{' '}
              <strong>{bugunKalan}</strong> hesap bekliyor.
            </>
          )}
        </p>
      )}

      {!arsiv && (
        <section aria-labelledby="ekle-baslik">
          <h2 id="ekle-baslik" className="text-h3 text-ink-900">
            Listeye ekle
          </h2>
          <div className="mt-4">
            <TakipciEkle />
          </div>
        </section>
      )}

      <section aria-labelledby="izgara-baslik">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="izgara-baslik" className="text-h3 text-ink-900">
            {arsiv ? 'Arşivdekiler' : 'Kontrol listesi'}
          </h2>
          <p className="tabular text-caption text-ink-500">
            {satirlar.length} hesap · son {PENCERE_GUN} gün
          </p>
        </div>
        <div className="mt-4">
          <TakipciIzgara
            arsiv={arsiv}
            gunler={izgaraGunleri}
            satirlar={satirlar.map((s) => ({
              id: s.id,
              username: s.username,
              endCount: s.endCount,
              note: s.note,
              isaretliGunler: s.isaretliGunler,
              toplamKontrol: s.toplamKontrol,
              sonKontrolAnahtar: s.sonKontrol ? gunAnahtari(s.sonKontrol) : null,
              sonKontrolEtiket: s.sonKontrol ? uzunTarih.format(s.sonKontrol) : null,
            }))}
          />
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

function adres(bitisAnahtari: string, arsiv: boolean): string {
  const p = new URLSearchParams({ b: bitisAnahtari })
  if (arsiv) p.set('arsiv', '1')
  return `/admin/kasa/takipci?${p.toString()}`
}
