import { formatQuantity } from './money'

/**
 * BİRİM ETİKETİ — SADECE GÖSTERİM
 *
 * `Service.unitLabel` müşteriye miktarın neyi ifade ettiğini anlatır:
 *   Takipçi / Beğeni / Görüntülenme → "adet"
 *   Profil Tanıtımı                 → "paket"
 *   İçerik Tanıtımı                 → "kampanya"
 *   Haftalık hizmet                 → "hafta"
 *
 * ⚠️ FİYAT MANTIĞININ PARÇASI DEĞİLDİR.
 * `calculatePrice` yalnızca tam sayı `quantity` ile çalışır ve `unitLabel`
 * hakkında hiçbir şey bilmez. Bu dosya `lib/pricing/*` tarafından import
 * EDİLMEZ — bağımlılık yönü tek taraflıdır ve öyle kalmalıdır.
 *
 * Türkçe'de sayıdan sonra birim çoğullanmaz: "152 adet", "3 paket", "2 hafta".
 * Bu yüzden pluralization mantığı YOK — bilinçli bir sadeleştirmedir.
 */

export const DEFAULT_UNIT_LABEL = 'adet'

/** 152, "adet" → "152 adet" */
export function withUnit(quantity: number, unitLabel: string | null | undefined): string {
  return `${formatQuantity(quantity)} ${unitLabel || DEFAULT_UNIT_LABEL}`
}

/** "0,45 ₺", "adet" → "0,45 ₺ / adet" */
export function perUnit(priceText: string, unitLabel: string | null | undefined): string {
  return `${priceText} / ${unitLabel || DEFAULT_UNIT_LABEL}`
}

/** Birim etiketi cümle içinde kullanılırken: "180 adet daha ekleyin" */
export function unitOf(unitLabel: string | null | undefined): string {
  return unitLabel || DEFAULT_UNIT_LABEL
}

/** Admin formunda önerilen değerler; serbest metin girişi de kabul edilir. */
export const SUGGESTED_UNIT_LABELS = [
  'adet',
  'paket',
  'kampanya',
  'hafta',
  'ay',
  'gönderi',
  'dakika',
] as const
