import { cn } from '@/lib/utils'
import { formatQuantity } from '@/lib/money'
import type { PricingIssue, PricingValidationResult } from '@/server/catalog/admin'

/**
 * ⭐ FİYAT TABLOSU DOĞRULAMA RAPORU (Faz 8)
 *
 * Faz 5'e kadar bu ekran ham kod adı basıyordu ("TIER_BOUNDARY_UNREACHABLE").
 * Bir fiyat tablosunu düzeltmesi gereken kişi için bu bilgi değil, bilmecedir.
 *
 * Artık her kod için: NE OLDU · NEDEN ÖNEMLİ · NASIL DÜZELTİLİR.
 *
 * ⚠️ Sunucudan gelen `message` alanı da gösterilir — orada aralık gibi somut
 * ayrıntılar vardır. Buradaki metin onun yerine geçmez, ÜSTÜNE bağlam ekler.
 */

type Level = 'PASS' | 'WARNING' | 'ERROR'

const CODE_HELP: Record<
  PricingIssue['code'],
  { title: string; why: string; fix: string }
> = {
  GAP: {
    title: 'Fiyat boşluğu',
    why: 'Bu aralıktaki miktarlar için hiçbir kademe tanımlı değil. Müşteri bu miktarı seçtiğinde fiyat hesaplanamaz ve sipariş açılamaz.',
    fix: 'Boşluğu kapatan bir kademe ekleyin ya da komşu kademenin sınırını genişletin.',
  },
  OVERLAP: {
    title: 'Kademe çakışması',
    why: 'Aynı miktar birden çok kademeye düşüyor. Hangi fiyatın uygulanacağı önceliğe kalır; bu, aynı miktarın farklı zamanlarda farklı fiyatlanmasına yol açabilir.',
    fix: 'Çakışan kademelerden birinin alt/üst sınırını daraltın.',
  },
  INVALID_PRICE: {
    title: 'Geçersiz fiyat',
    why: 'Sıfır veya negatif fiyat, ücretsiz ya da eksi tutarlı sipariş demektir.',
    fix: 'Fiyatı sıfırdan büyük bir değere güncelleyin.',
  },
  INVALID_RANGE: {
    title: 'Geçersiz aralık',
    why: 'Üst sınır alt sınırdan küçük. Bu kademe hiçbir miktarı kapsayamaz.',
    fix: 'Alt ve üst sınırı düzeltin; sabit pakette ikisi aynı olmalıdır.',
  },
  DUPLICATE_TIER: {
    title: 'Yinelenen kademe',
    why: 'Aynı aralık iki kez tanımlanmış. Biri sessizce kullanılmaz hâle gelir ve fiyat değişikliği yanlış kayda uygulanabilir.',
    fix: 'Fazla olan kademeyi pasifleştirin.',
  },
  UNREACHABLE_TIER: {
    title: 'Erişilemez kademe',
    why: 'Bu kademe varyantın izin verdiği miktar aralığının dışında kalıyor; hiçbir sipariş bu fiyata düşemez.',
    fix: 'Varyantın min/maks miktarını genişletin ya da kademeyi pasifleştirin.',
  },
  TIER_BOUNDARY_UNREACHABLE: {
    title: 'Sınıra ulaşılamıyor',
    why: 'Miktar adımı yüzünden kademenin başlangıç değeri hiçbir zaman tam olarak seçilemiyor. Kademe kâğıt üzerinde var, pratikte yok.',
    fix: 'Adım değerini ya da kademe sınırını, sınır adımın katı olacak şekilde ayarlayın.',
  },
  NO_TIERS: {
    title: 'Fiyat tanımlı değil',
    why: 'Bu varyantta hiç aktif fiyat kademesi yok. Varyant katalogda görünse bile sipariş edilemez.',
    fix: 'En az bir fiyat kademesi ekleyin ya da varyantı pasifleştirin.',
  },
}

function levelOf(report: PricingValidationResult): Level {
  if (report.issues.some((i) => i.severity === 'error')) return 'ERROR'
  if (report.issues.length > 0) return 'WARNING'
  return 'PASS'
}

const LEVEL_STYLE: Record<Level, { box: string; text: string; label: string; summary: string }> = {
  PASS: {
    box: 'border-success-600/30 bg-success-100',
    text: 'text-success-700',
    label: 'PASS',
    summary: 'Fiyat tablosu sağlam. Tüm miktarlar fiyatlanabiliyor.',
  },
  WARNING: {
    box: 'border-warning-600/30 bg-warning-100',
    text: 'text-warning-700',
    label: 'WARNING',
    summary: 'Tablo çalışıyor ama dikkat edilmesi gereken noktalar var.',
  },
  ERROR: {
    box: 'border-danger-600/30 bg-danger-100',
    text: 'text-danger-700',
    label: 'ERROR',
    summary: 'Tabloda sipariş akışını bozan sorunlar var.',
  },
}

export function ValidationReport({ report }: { report: PricingValidationResult }) {
  const level = levelOf(report)
  const style = LEVEL_STYLE[level]

  return (
    <div
      className={cn('rounded-[--radius-card] border p-4', style.box)}
      data-testid="pricing-report"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full border border-current px-2 py-0.5 text-caption font-bold tracking-wide',
            style.text,
          )}
          data-testid="pricing-report-level"
        >
          {style.label}
        </span>
        <p className={cn('text-small font-medium', style.text)}>{style.summary}</p>
      </div>

      <p className="mt-1 text-caption text-ink-600">
        Kapsanan miktar aralığı: {formatQuantity(report.minQuantity)} –{' '}
        {formatQuantity(report.maxQuantity)}
      </p>

      {report.issues.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2.5" data-testid="pricing-issues">
          {report.issues.map((issue, i) => {
            const help = CODE_HELP[issue.code]
            const isError = issue.severity === 'error'
            return (
              <li
                key={`${issue.code}-${i}`}
                className="rounded-[--radius-control] border border-ink-200 bg-white p-3"
                data-testid={`issue-${issue.code}`}
              >
                <p className="flex flex-wrap items-center gap-2 text-small font-medium text-ink-900">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-caption font-bold',
                      isError ? 'bg-danger-100 text-danger-700' : 'bg-warning-100 text-warning-700',
                    )}
                  >
                    {isError ? 'ERROR' : 'WARNING'}
                  </span>
                  {help.title}
                  {issue.range && (
                    <span className="tabular font-normal text-caption text-ink-500">
                      {formatQuantity(issue.range.from)}
                      {issue.range.to === null ? ' ve üzeri' : ` – ${formatQuantity(issue.range.to)}`}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-caption text-ink-700">{issue.message}</p>
                <p className="mt-1 text-caption text-ink-600">
                  <strong>Neden önemli:</strong> {help.why}
                </p>
                <p className="mt-0.5 text-caption text-ink-600">
                  <strong>Nasıl düzeltilir:</strong> {help.fix}
                </p>
                <p className="mt-1 font-mono text-caption text-ink-400">{issue.code}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
