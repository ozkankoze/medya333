/**
 * PARA ARİTMETİĞİ — tek giriş noktası.
 *
 * KURAL: Tüm parasal değerler TAM SAYI KURUŞ (minor unit). Float ve Decimal
 * kullanılmaz — JS'te para hatalarının kaynağı bu ikisidir.
 *   249,00 TL  →  24900
 *
 * Bu dosya izomorfiktir: hem tarayıcıda hem sunucuda çalışır, hiçbir şey import etmez.
 */

export const CURRENCY = 'TRY' as const
export type Currency = typeof CURRENCY

/** Pozitif tam sayılar için yarıyı yukarı yuvarlayan tam sayı bölmesi. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('divRoundHalfUp: denominator is 0')
  if (numerator < 0 || denominator < 0) {
    // Negatif tutarlar (iade) için mutlak değer üzerinden yuvarla, işareti koru
    const sign = Math.sign(numerator) * Math.sign(denominator)
    return sign * divRoundHalfUp(Math.abs(numerator), Math.abs(denominator))
  }
  return Math.floor((numerator * 2 + denominator) / (denominator * 2))
}

/** basis point çarpımı: %12,5 → 1250 bp */
export function applyBasisPoints(amountMinor: number, bp: number): number {
  return divRoundHalfUp(amountMinor * bp, 10_000)
}

/**
 * KDV DAHİL tutardan vergiyi geriye doğru ayrıştırır.
 *
 *   taxAmount = round(total * rateBp / (10000 + rateBp))
 *
 * Örnek: 249,00 TL brüt, %20 KDV
 *   24900 * 2000 / 12000 = 4150  →  41,50 TL KDV
 *   net matrah = 24900 - 4150 = 20750  →  207,50 TL   (207,50 * 1,20 = 249,00 ✓)
 */
export function extractTaxFromGross(
  grossMinor: number,
  taxRateBp: number,
): { taxAmountMinor: number; netMinor: number } {
  if (taxRateBp < 0) throw new Error('extractTaxFromGross: negative tax rate')
  if (taxRateBp === 0) return { taxAmountMinor: 0, netMinor: grossMinor }
  const taxAmountMinor = divRoundHalfUp(grossMinor * taxRateBp, 10_000 + taxRateBp)
  return { taxAmountMinor, netMinor: grossMinor - taxAmountMinor }
}

/** Net (KDV hariç) tutara vergi ekler. Fatura/mutabakat tarafında gerekebilir. */
export function addTaxToNet(netMinor: number, taxRateBp: number): number {
  return netMinor + applyBasisPoints(netMinor, taxRateBp)
}

/**
 * NOT: `style: 'currency'` KULLANILMIYOR.
 * ICU sürümüne göre tr-TR biçimlendirmesi sembolü başa alıp "₺249,00"
 * üretebiliyor. Türkiye'de yerleşik yazım "249,00 ₺" — sembol sonda ve
 * araya bir boşluk. Sayıyı biçimlendirip sembolü kendimiz ekleyerek
 * tüm tarayıcı/ICU sürümlerinde tutarlı sonuç garantiliyoruz.
 */
const TRY_SYMBOL = '₺'
const NBSP = ' '

const NUM_2 = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NUM_0_2 = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

/** 24900 → "249,00 ₺" */
export function formatMinor(amountMinor: number, opts?: { compact?: boolean }): string {
  const fmt = opts?.compact ? NUM_0_2 : NUM_2
  return `${fmt.format(amountMinor / 100)}${NBSP}${TRY_SYMBOL}`
}

/** 45 → "0,45 ₺" · 4 → "0,04 ₺" — birim fiyatlarda 4 haneye kadar iner */
export function formatUnitPriceMinor(amountMinor: number): string {
  const value = amountMinor / 100
  const decimals = Number.isInteger(value * 100) && Math.abs(value) >= 0.01 ? 2 : 4
  const n = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
  return `${n}${NBSP}${TRY_SYMBOL}`
}

/** "249,00" / "249.00" / "249" → 24900. Admin form girdisi için. */
export function parseMajorToMinor(input: string): number {
  const normalized = input.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) throw new Error(`Geçersiz tutar: ${input}`)
  return Math.round(value * 100)
}

export function formatQuantity(n: number): string {
  return new Intl.NumberFormat('tr-TR').format(n)
}
