/**
 * Kademe sağlık kontrolleri — admin fiyat editörünün arkasındaki mantık.
 *
 * Fiyat boşluğu (örn. 1000+ kademesi tanımsız) canlıda `NO_PRICING_RULE`
 * hatasına dönüşür ve fark edilene kadar sipariş kaybettirir. Çakışma ise
 * sessizce yanlış fiyattan satış demektir. İkisi de kaydetmeden önce yakalanmalı.
 *
 * Saf fonksiyonlar — admin UI'da canlı, API'de kaydetme öncesi çalışır.
 */

import type { PricingTier } from './types'
// ⚠️ Tek yönlü bağımlılık: calculate.ts tiers.ts'i İÇE AKTARMAZ, döngü yok.
import { anchorCap } from './calculate'

export interface TierOverlap {
  aId: string
  bId: string
  fromQuantity: number
  toQuantity: number | null
  /** Çakışmada hangi kademe kazanır (selectTier ile aynı mantık) */
  winnerId: string
}

export interface TierGap {
  fromQuantity: number
  toQuantity: number
}

export interface TierValidationReport {
  ok: boolean
  overlaps: TierOverlap[]
  gaps: TierGap[]
  invalid: Array<{ id: string; reason: string }>
}

function upper(t: PricingTier): number {
  return t.maxQuantity ?? Number.MAX_SAFE_INTEGER
}

function tierCoversQuantity(t: PricingTier, quantity: number): boolean {
  return quantity >= t.minQuantity && (t.maxQuantity === null || quantity <= t.maxQuantity)
}

function winnerOf(a: PricingTier, b: PricingTier): string {
  if (a.priority !== b.priority) return a.priority > b.priority ? a.id : b.id
  return a.minQuantity > b.minQuantity ? a.id : b.id
}

/**
 * @param tiers Aktif kademeler
 * @param constraints Varyantın min/max miktarı — boşluk taraması bu aralıkta yapılır
 */
export function validateTiers(
  tiers: PricingTier[],
  constraints: {
    minQuantity: number
    maxQuantity: number
    /** Hazır miktar listesi — `presetOnly` ile birlikte boşluk taraması bu liste üzerinde yapılır */
    presetQuantities?: readonly number[]
    presetOnly?: boolean
  },
): TierValidationReport {
  const invalid: TierValidationReport['invalid'] = []

  for (const t of tiers) {
    if (t.mode === 'PACKAGE') {
      // Sabit pakette birim fiyat yoktur; kontrol edilen şey paket fiyatıdır.
      const pkg = t.packagePriceMinor
      if (pkg == null || !Number.isInteger(pkg) || pkg <= 0) {
        invalid.push({ id: t.id, reason: 'Paket fiyatı sıfır veya negatif olamaz.' })
      }
    } else if (t.unitPriceMinor <= 0) {
      invalid.push({ id: t.id, reason: 'Birim fiyat sıfır veya negatif olamaz.' })
    }
    if (t.setupFeeMinor < 0) {
      invalid.push({ id: t.id, reason: 'Hizmet bedeli negatif olamaz.' })
    }
    if (t.minQuantity < 1) {
      invalid.push({ id: t.id, reason: 'Alt sınır en az 1 olmalıdır.' })
    }
    if (t.maxQuantity !== null && t.maxQuantity < t.minQuantity) {
      invalid.push({ id: t.id, reason: 'Üst sınır alt sınırdan küçük olamaz.' })
    }
  }

  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity || upper(a) - upper(b))

  // --- Çakışma ---
  const overlaps: TierOverlap[] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!
      const b = sorted[j]!
      const from = Math.max(a.minQuantity, b.minQuantity)
      const to = Math.min(upper(a), upper(b))
      if (from <= to) {
        overlaps.push({
          aId: a.id,
          bId: b.id,
          fromQuantity: from,
          toQuantity: to === Number.MAX_SAFE_INTEGER ? null : to,
          winnerId: winnerOf(a, b),
        })
      }
    }
  }

  /**
   * --- Boşluk ---
   *
   * HAZIR MİKTARLI (preset) varyantta aralık taraması ANLAMSIZDIR: 500 ile
   * 1.000 arasındaki 501–999 miktarları zaten seçilemez, dolayısıyla oradaki
   * "boşluk" bir hata değildir. Boşluk = fiyatı olmayan HAZIR MİKTAR.
   */
  if (constraints.presetOnly) {
    const presetGaps: TierGap[] = []
    for (const q of constraints.presetQuantities ?? []) {
      const covered = tiers.some((t) => tierCoversQuantity(t, q))
      if (!covered) presetGaps.push({ fromQuantity: q, toQuantity: q })
    }
    return {
      ok: overlaps.length === 0 && presetGaps.length === 0 && invalid.length === 0,
      overlaps,
      gaps: presetGaps,
      invalid,
    }
  }

  const gaps: TierGap[] = []
  let cursor = constraints.minQuantity
  for (const t of sorted) {
    if (upper(t) < cursor) continue
    if (t.minQuantity > cursor) {
      gaps.push({ fromQuantity: cursor, toQuantity: Math.min(t.minQuantity - 1, constraints.maxQuantity) })
    }
    cursor = Math.max(cursor, Math.min(upper(t), constraints.maxQuantity) + 1)
    if (cursor > constraints.maxQuantity) break
  }
  if (cursor <= constraints.maxQuantity) {
    gaps.push({ fromQuantity: cursor, toQuantity: constraints.maxQuantity })
  }

  return {
    ok: overlaps.length === 0 && gaps.length === 0 && invalid.length === 0,
    overlaps,
    gaps,
    invalid,
  }
}

// ---------------------------------------------------------------------------
// ADIM (quantityStep) SINIR KONTROLÜ
// ---------------------------------------------------------------------------

/**
 * Seçilebilir miktarlar: `minQuantity + k · quantityStep`, üst sınır `maxQuantity`.
 * Örn. min=100, step=50 → 100, 150, 200 … Bir kademe 100–499 olarak tanımlanmışsa
 * kademenin SON miktarı (499) hiçbir zaman seçilemez; gerçekte kademe 450'de biter.
 *
 * Bu bir hata DEĞİLDİR (sipariş yine geçer, boşluk oluşmaz) ama admin'in
 * "1000'e kadar bu fiyat" sandığı şey aslında 950'de bittiği için fiyat
 * tablosunu yanlış okumasına yol açar. Bu yüzden açık bir UYARI olarak raporlanır.
 */
export interface TierStepIssue {
  tierId: string
  /**
   * `BOUNDARY` → kademenin üst sınırı seçilemiyor (kademe daha erken bitiyor)
   * `EMPTY`    → adım nedeniyle kademe aralığında hiç seçilebilir miktar yok
   */
  kind: 'BOUNDARY' | 'EMPTY'
  declaredFrom: number
  declaredTo: number | null
  /** Aralıktaki en küçük/en büyük gerçekten seçilebilir miktar (EMPTY ise null) */
  firstSelectable: number | null
  lastSelectable: number | null
}

/** Verilen aralıktaki en küçük seçilebilir miktar (yoksa null). */
function firstSelectableIn(
  from: number,
  to: number,
  base: number,
  step: number,
): number | null {
  const start = Math.max(from, base)
  if (start > to) return null
  const offset = (start - base) % step
  const q = offset === 0 ? start : start + (step - offset)
  return q <= to ? q : null
}

/** Verilen aralıktaki en büyük seçilebilir miktar (yoksa null). */
function lastSelectableIn(from: number, to: number, base: number, step: number): number | null {
  if (to < Math.max(from, base)) return null
  const q = to - ((to - base) % step)
  return q >= Math.max(from, base) ? q : null
}

/**
 * `quantityStep` yüzünden erişilemeyen kademe sınırlarını bulur.
 * Saf fonksiyon — admin editöründe canlı, API'de kaydetmeden önce çalışır.
 */
export function findStepBoundaryIssues(
  tiers: PricingTier[],
  constraints: { minQuantity: number; maxQuantity: number; quantityStep: number },
): TierStepIssue[] {
  const step = constraints.quantityStep > 0 ? constraints.quantityStep : 1
  if (step === 1) return []

  const base = constraints.minQuantity
  const issues: TierStepIssue[] = []

  for (const t of tiers) {
    // Kademenin varyant sınırlarıyla kesişimi
    const from = Math.max(t.minQuantity, constraints.minQuantity)
    const to = Math.min(upper(t), constraints.maxQuantity)
    if (from > to) continue // zaten UNREACHABLE_TIER olarak raporlanıyor

    const first = firstSelectableIn(from, to, base, step)
    const last = lastSelectableIn(from, to, base, step)

    if (first === null || last === null) {
      issues.push({
        tierId: t.id,
        kind: 'EMPTY',
        declaredFrom: t.minQuantity,
        declaredTo: t.maxQuantity,
        firstSelectable: null,
        lastSelectable: null,
      })
      continue
    }

    // Üst sınır seçilebilir mi? (sonsuz kademede üst sınır yok, kontrol edilmez)
    if (t.maxQuantity !== null && to <= constraints.maxQuantity && last !== to) {
      issues.push({
        tierId: t.id,
        kind: 'BOUNDARY',
        declaredFrom: t.minQuantity,
        declaredTo: t.maxQuantity,
        firstSelectable: first,
        lastSelectable: last,
      })
    }
  }

  return issues
}

/** Fiyat tablosunu müşteriye şeffaf göstermek için sıralı, okunabilir hale getirir. */
export function sortTiersForDisplay(tiers: PricingTier[]): PricingTier[] {
  return [...tiers].sort((a, b) => a.minQuantity - b.minQuantity)
}

// ---------------------------------------------------------------------------
// GİRİŞ FİYATI ("…'den başlar")
// ---------------------------------------------------------------------------

export interface EntryPrice {
  /** 'package' → gösterilecek tutar bir PAKET TOPLAMIDIR, birim fiyat DEĞİL */
  kind: 'unit' | 'package'
  /**
   * kind='package' → en düşük paket toplamı
   * kind='unit'    → EN DÜŞÜK BİRİM FİYAT
   *
   * ⚠️ MÜŞTERİYE GÖSTERİLECEK ALAN BU DEĞİL. Birim fiyat yalnızca varyantlar
   * arası karşılaştırma içindir (bkz. `VariantPicker` yüzde farkı). Kartta
   * gösterilecek tutar `minOrderMinor`'dır.
   */
  amountMinor: number
  /** Paket fiyatının hangi miktara ait olduğu (kind === 'package') */
  quantity: number | null
  /** ⭐ EN KÜÇÜK SİPARİŞİN TOPLAM TUTARI — kartlarda gösterilen budur. */
  minOrderMinor: number
  /** O toplamın kaç adede karşılık geldiği. */
  minOrderQuantity: number
}

/**
 * Kartlarda gösterilen "…'den başlar" tutarı.
 *
 * ⚠️ EN DÜŞÜK BİRİM FİYAT GÖSTERİLMEZ — YANILTICIDIR.
 *
 * Takipçide en düşük birim fiyat 25 kuruştur ama o fiyata ancak 1.000.000
 * takipçi alan biri ulaşır. Kartta "0,25 ₺ / takipçi'den başlar" yazmak,
 * müşteriye asla karşılaşmayacağı bir rakamı vaat eder: minimum sipariş
 * 500 takipçidir ve 324,90 ₺'dir. Bu yüzden `minOrderMinor` alanı
 * EN KÜÇÜK SİPARİŞİN gerçek toplamını taşır ve kartlar onu basar.
 *
 * ⚠️ Sabit paket kademelerinde birim fiyat YOKTUR (0'dır); orada en düşük
 * paket toplamı hem `amountMinor` hem `minOrderMinor` olur.
 */
export function entryPriceOf(tiers: readonly PricingTier[]): EntryPrice | null {
  const packages = tiers.filter((t) => t.mode === 'PACKAGE' && (t.packagePriceMinor ?? 0) > 0)
  if (packages.length > 0) {
    const cheapest = packages.reduce((best, t) =>
      (t.packagePriceMinor ?? 0) < (best.packagePriceMinor ?? 0) ? t : best,
    )
    const amountMinor = cheapest.packagePriceMinor ?? 0
    return {
      kind: 'package',
      amountMinor,
      quantity: cheapest.minQuantity,
      minOrderMinor: amountMinor,
      minOrderQuantity: cheapest.minQuantity,
    }
  }

  const units = tiers.filter((t) => t.unitPriceMinor > 0)
  if (units.length === 0) return null

  /**
   * Satın alınabilecek EN KÜÇÜK miktar ve onun gerçek tutarı.
   *
   * ⚠️ `birim × miktar` YETMEZ: çapa tavanı yüzünden 65 kr × 500 = 325,00 ₺
   * çıkar ama gerçekte ödenen 324,90 ₺'dir. Kart ile ödeme ekranı arasında
   * 10 kuruşluk fark bırakmamak için motorun kullandığı `anchorCap` aynen
   * çağrılır.
   */
  const minQuantity = Math.min(...units.map((t) => t.minQuantity))
  const covering = units.filter((t) => tierCoversQuantity(t, minQuantity))
  const linearTier = covering.length > 0 ? covering[0] : undefined
  const linearMinor = (linearTier?.unitPriceMinor ?? 0) * minQuantity
  const { goodsMinor } = anchorCap([...tiers], minQuantity, linearMinor)

  return {
    kind: 'unit',
    amountMinor: Math.min(...units.map((t) => t.unitPriceMinor)),
    quantity: null,
    minOrderMinor: goodsMinor + (linearTier?.setupFeeMinor ?? 0),
    minOrderQuantity: minQuantity,
  }
}

/**
 * Belirli bir HAZIR MİKTARIN müşteriye gösterilecek toplam tutarı.
 *
 * Sabit paket kademelerinde tutar okunur; birim fiyatlı kademelerde
 * `birim × miktar` ile hesaplanır. Kupon/kampanya BURAYA GİRMEZ — bunlar
 * kart üzerindeki liste fiyatlarıdır; ödenecek tutarın otoritesi
 * `calculatePrice`'tır.
 */
export function listPriceAtQuantity(
  tiers: readonly PricingTier[],
  quantity: number,
): number | null {
  const covering = tiers.filter((t) => tierCoversQuantity(t, quantity))
  if (covering.length === 0) return null
  const tier = covering.reduce((best, t) => {
    if (t.priority !== best.priority) return t.priority > best.priority ? t : best
    return t.minQuantity > best.minQuantity ? t : best
  })
  const goods =
    tier.mode === 'PACKAGE' ? (tier.packagePriceMinor ?? 0) : tier.unitPriceMinor * quantity
  return goods + tier.setupFeeMinor
}
