import Link from 'next/link'

/**
 * AYIN GÜN ŞERİDİ — defteri gün gün okumak için
 *
 * ⚠️ SUNUCU BİLEŞENİDİR. Gün seçimi `?g=` ile adrese yazılır, istemci
 * durumuyla değil: seçili gün tarayıcı geçmişinde kalır, bağlantısı
 * paylaşılabilir ve sayfa yenilenince kaybolmaz. Küçük bir açılır menü
 * yerine bütün ayı tek bakışta göstermek bilinçli — muhasebe defterinde
 * asıl soru "hangi gün ne oldu" sorusudur ve cevabı taramak değil görmek
 * gerekir.
 *
 * ⚠️ SAYILAR AYRI SORGUDAN GELMEZ. Sayfa zaten o ayın bütün satırlarını
 * çekiyor; gün toplamları o satırlardan hesaplanır. Ayrı bir toplam
 * sorgusu, aynı veriyi iki yerden okuyup ikisinin ayrışması riskini
 * getirirdi.
 */

export interface GunOzeti {
  /** Ayın günü (1-31). */
  gun: number
  /** O güne girilmiş satır sayısı — iptaller dâhil. */
  adet: number
  /** ⚠️ İPTALLER HARİÇ satış toplamı: tablodaki özetle aynı kural. */
  tutarMinor: number
  /** O gün deftere ilk kez giren bir müşteri var mı? */
  yeniMusteri: boolean
}

export function GunSeridi({
  year,
  month1,
  gunler,
  secili,
  temelHref,
  bicimle,
}: {
  year: number
  month1: number
  gunler: readonly GunOzeti[]
  /** Seçili gün — null ise ay geneli gösteriliyor demektir. */
  secili: number | null
  temelHref: string
  /** Kuruşu ekrana yazan biçimlendirici (para birimi sayfadan gelir). */
  bicimle: (minor: number) => string
}) {
  const ayHref = `${temelHref}?y=${year}&m=${month1}`

  return (
    <section aria-labelledby="gun-baslik">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="gun-baslik" className="text-h3 text-ink-900">
          Gün seç
        </h2>
        <div className="flex items-center gap-3">
          <p className="flex items-center gap-1.5 text-caption text-ink-500">
            <span aria-hidden className="inline-block size-2 rounded-full bg-yeni-600" />
            o gün yeni müşteri var
          </p>
          <Link
            href={ayHref}
            aria-current={secili === null ? 'page' : undefined}
            className={
              'rounded-full px-3 py-1.5 text-caption transition-colors ' +
              (secili === null
                ? 'bg-ink-900 font-semibold text-white'
                : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50')
            }
          >
            Ay geneli
          </Link>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] gap-1.5">
        {gunler.map((g) => {
          const aktif = secili === g.gun
          const bos = g.adet === 0
          // ⚠️ Boş gün de TIKLANABİLİR kalır. Tıklanamaz olsaydı, "o gün
          //    hiç iş yok" bilgisi ile "o günü seçemiyorum" ayrımı
          //    kaybolurdu; boş gün ekranı da defterin bir parçasıdır.
          return (
            <Link
              key={g.gun}
              href={aktif ? ayHref : `${temelHref}?y=${year}&m=${month1}&g=${g.gun}`}
              aria-current={aktif ? 'page' : undefined}
              aria-label={`${g.gun} ${AY_ADI(year, month1)} — ${g.adet} sipariş`}
              className={
                'rounded-[--radius-control] border px-2 py-1.5 transition-colors ' +
                (aktif
                  ? 'border-ink-900 bg-ink-900 text-white'
                  : bos
                    ? 'border-ink-200 bg-ink-50 text-ink-400 hover:border-ink-300'
                    : 'border-ink-200 bg-white text-ink-900 hover:border-brand-500 hover:bg-brand-50')
              }
            >
              <span className="flex items-baseline gap-1">
                <span className="tabular text-body font-semibold leading-none">{g.gun}</span>
                <span
                  className={
                    'text-caption uppercase ' + (aktif ? 'text-ink-200' : 'text-ink-500')
                  }
                >
                  {gunAdi(year, month1, g.gun)}
                </span>
                {g.yeniMusteri && (
                  <span
                    aria-hidden
                    className={
                      'ml-auto inline-block size-1.5 rounded-full ' +
                      (aktif ? 'bg-white' : 'bg-yeni-600')
                    }
                  />
                )}
              </span>
              <span
                className={
                  'tabular mt-1 block truncate text-caption font-medium ' +
                  (aktif ? 'text-white' : bos ? 'text-ink-400' : 'text-ink-700')
                }
              >
                {bos ? '—' : bicimle(g.tutarMinor)}
              </span>
              <span
                className={'block text-caption ' + (aktif ? 'text-ink-200' : 'text-ink-500')}
              >
                {bos ? '' : `${g.adet} sipariş`}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

/**
 * ⚠️ UTC ŞART. Tarihler gün başlangıcına sabitlenmiş UTC değerleridir;
 * yerel saate çevrilseydi Türkiye'de gün adı bir gün kayabilirdi.
 */
function gunAdi(year: number, month1: number, gun: number): string {
  return new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month1 - 1, gun)))
    .replace('.', '')
}

function AY_ADI(year: number, month1: number): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month1 - 1, 1)),
  )
}
