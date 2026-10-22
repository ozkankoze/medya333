import Link from 'next/link'

/**
 * AY SEÇİCİ — yıl okları + on iki ay
 *
 * ⚠️ SUNUCU BİLEŞENİDİR; seçim `?y=` ve `?m=` ile adreste taşınır.
 *
 * ⚠️ AY DEĞİŞİNCE GÜN SEÇİMİ DÜŞER (`g` taşınmaz). Taşınsaydı, 31 günü
 * seçiliyken 30 çeken bir aya geçen kullanıcı boş bir ekranla karşılaşır
 * ve ekranın bozulduğunu sanırdı.
 *
 * ⚠️ "Önceki / Sonraki" bağlantıları KALDIRILMADI, ayların yanında duruyor:
 * bir önceki aya bakmak en sık yapılan iştir ve on iki hapın içinde doğru
 * olanı aramaktan hızlıdır.
 */

const AYLAR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const

export function AySecici({
  year,
  month1,
  temelHref,
}: {
  year: number
  month1: number
  temelHref: string
}) {
  const href = (y: number, m: number) => `${temelHref}?y=${y}&m=${m}`

  return (
    <nav aria-label="Dönem seçimi" className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1">
        <Link
          href={href(year - 1, month1)}
          aria-label={`${year - 1} yılı`}
          className="rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1.5 text-small text-ink-700 hover:bg-ink-50"
        >
          ‹
        </Link>
        <span className="tabular min-w-[3.5rem] text-center text-small font-semibold text-ink-900">
          {year}
        </span>
        <Link
          href={href(year + 1, month1)}
          aria-label={`${year + 1} yılı`}
          className="rounded-[--radius-control] border border-ink-200 bg-white px-2.5 py-1.5 text-small text-ink-700 hover:bg-ink-50"
        >
          ›
        </Link>
      </span>

      <span className="flex flex-wrap gap-1 rounded-[--radius-control] border border-ink-200 bg-white p-1">
        {AYLAR.map((ad, i) => {
          const m = i + 1
          const aktif = m === month1
          return (
            <Link
              key={ad}
              href={href(year, m)}
              aria-current={aktif ? 'page' : undefined}
              title={`${ad} ${year}`}
              className={
                'rounded-[--radius-control] px-2.5 py-1 text-caption transition-colors ' +
                (aktif
                  ? 'bg-ink-900 font-semibold text-white'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900')
              }
            >
              {ad.slice(0, 3)}
            </Link>
          )
        })}
      </span>
    </nav>
  )
}
