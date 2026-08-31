import { Badge } from '@/components/ui/badge'

/**
 * YASAL SAYFA DÜZENİ
 *
 * Faz 0 kararı #3: İçerikler PLACEHOLDER'dır. Gerçek hukuki metinler bir
 * avukat tarafından hazırlanıp buraya yerleştirilecektir. Route'lar ve
 * navigasyon şimdiden sabittir; metin değişince link yapısı bozulmaz.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-16">
      <Badge tone="warning" className="mb-6">
        Taslak metin — hukuk danışmanı tarafından güncellenecek
      </Badge>
      <div className="prose-medya flex flex-col gap-5 text-body text-ink-700 [&_h1]:text-h1 [&_h1]:text-ink-900 [&_h2]:mt-6 [&_h2]:text-h3 [&_h2]:text-ink-900 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </article>
  )
}
