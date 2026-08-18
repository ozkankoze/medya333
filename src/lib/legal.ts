/**
 * YASAL METİN SÜRÜMLERİ
 *
 * Kullanıcı bir sözleşmeyi kabul ettiğinde HANGİ SÜRÜMÜ kabul ettiği
 * siparişe snapshot'lanır. Metin sonradan değişse bile geçmiş siparişin
 * hangi şartlarla verildiği kanıtlanabilir kalır (mesafeli satış mevzuatı).
 *
 * ⚠️ Bir yasal metnin İÇERİĞİ değiştiğinde buradaki sürüm MUTLAKA artırılmalı.
 */

export interface LegalDocument {
  key: 'terms' | 'refund' | 'privacy'
  version: string
  title: string
  href: string
}

export const LEGAL_DOCUMENTS: Record<LegalDocument['key'], LegalDocument> = {
  terms: {
    key: 'terms',
    version: '2026-08-18.draft.1',
    title: 'Hizmet / Satış Sözleşmesi',
    href: '/satis-sozlesmesi',
  },
  refund: {
    key: 'refund',
    version: '2026-08-18.draft.1',
    title: 'İptal ve İade Koşulları',
    href: '/iptal-iade',
  },
  privacy: {
    key: 'privacy',
    version: '2026-08-18.draft.1',
    title: 'KVKK / Gizlilik Metni',
    href: '/kvkk-gizlilik',
  },
}

export const LEGAL_LIST = Object.values(LEGAL_DOCUMENTS)

/** Sipariş üzerinde saklanan onay snapshot'ı. */
export interface ConsentSnapshot {
  acceptedAt: string
  documents: Array<{ key: string; version: string; title: string; href: string }>
  /** Ham IP saklanmaz — tuzlanmış hash */
  ipHash?: string | null
  userAgent?: string | null
}

export function buildConsentSnapshot(input: {
  acceptedAt: Date
  ipHash?: string | null
  userAgent?: string | null
}): ConsentSnapshot {
  return {
    acceptedAt: input.acceptedAt.toISOString(),
    documents: LEGAL_LIST.map((d) => ({
      key: d.key,
      version: d.version,
      title: d.title,
      href: d.href,
    })),
    ipHash: input.ipHash ?? null,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  }
}
