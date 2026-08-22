/**
 * ⭐ PRICING ENGINE — TEK KAYNAK
 *
 * Bu fonksiyon SAF'tır: ağ yok, DB yok, tarih yok, yan etki yok.
 * TARAYICIDA  → snapshot'taki kademelerle çalışır → slider'da 0 ms canlı fiyat
 * SUNUCUDA    → DB'den taze çekilen kademelerle çalışır → OTORİTE fiyat
 *
 * İki ayrı hesaplama kodu olmadığı için frontend/backend fiyat tutarsızlığı
 * sınıfındaki hatalar yapısal olarak imkânsızdır.
 *
 * KDV: Tüm girdi fiyatları KDV DAHİL'dir. Vergi toplamdan geriye ayrıştırılır.
 */

import { divRoundHalfUp, extractTaxFromGross } from '@/lib/money'
import {
  PricingError,
  type BreakdownLine,
  type CalculatePriceInput,
  type DiscountSpec,
  type NextTierHint,
  type PriceBreakdown,
  type PricingTier,
} from './types'

// ---------------------------------------------------------------------------
// Miktar doğrulama — AYNI kural hem istemcide hem sunucuda çalışır
// ---------------------------------------------------------------------------

export function validateQuantity(
  quantity: number,
  c: {
    minQuantity: number
    maxQuantity: number
    quantityStep: number
    presetQuantities?: readonly number[]
    presetOnly?: boolean
  },
): void {
  if (!Number.isInteger(quantity)) {
    throw new PricingError('INVALID_QUANTITY', 'Miktar tam sayı olmalıdır.', { quantity })
  }
  if (quantity <= 0) {
    throw new PricingError('INVALID_QUANTITY', 'Miktar sıfırdan büyük olmalıdır.', { quantity })
  }

  /**
   * ⚠️ HAZIR MİKTAR KİLİDİ
   *
   * Gerçek katalogda fiyat, miktarın FONKSİYONU DEĞİL; miktar–fiyat
   * eşleşmesidir. 500 → 324,90 ₺ tanımlıysa 501 için bir fiyat YOKTUR.
   * Bu kontrol istemcide ve sunucuda AYNI saf fonksiyondan geçer; UI'daki
   * kartlar atlansa bile sunucu reddeder.
   */
  if (c.presetOnly) {
    const presets = c.presetQuantities ?? []
    if (presets.length === 0) {
      throw new PricingError('NO_PRICING_RULE', 'Bu hizmet için seçilebilir bir paket yok.', {
        quantity,
      })
    }
    if (!presets.includes(quantity)) {
      throw new PricingError(
        'QUANTITY_NOT_ALLOWED',
        'Bu hizmette yalnızca hazır paketlerden biri seçilebilir.',
        { quantity, presetQuantities: [...presets] },
      )
    }
    return
  }
  if (quantity < c.minQuantity) {
    throw new PricingError(
      'BELOW_MINIMUM',
      `Bu hizmet için en az ${c.minQuantity} adet sipariş verebilirsiniz.`,
      { quantity, minQuantity: c.minQuantity },
    )
  }
  if (quantity > c.maxQuantity) {
    throw new PricingError(
      'ABOVE_MAXIMUM',
      `Bu hizmet için en fazla ${c.maxQuantity} adet sipariş verebilirsiniz.`,
      { quantity, maxQuantity: c.maxQuantity },
    )
  }
  const step = c.quantityStep > 0 ? c.quantityStep : 1
  if ((quantity - c.minQuantity) % step !== 0) {
    throw new PricingError('INVALID_STEP', `Miktar ${step} adetlik adımlarla artmalıdır.`, {
      quantity,
      quantityStep: step,
      minQuantity: c.minQuantity,
    })
  }
}

// ---------------------------------------------------------------------------
// Kademe seçimi
// ---------------------------------------------------------------------------

function tierCovers(tier: PricingTier, quantity: number): boolean {
  return quantity >= tier.minQuantity && (tier.maxQuantity === null || quantity <= tier.maxQuantity)
}

/**
 * Kademe seçimi: önce `priority` (büyük kazanır), eşitse daha dar/yüksek
 * `minQuantity` kazanır. Böylece admin geçici bir kampanya kademesini yüksek
 * priority ile ekleyip mevcut yapıyı bozmadan üzerine yazabilir.
 */
export function selectTier(tiers: PricingTier[], quantity: number): PricingTier {
  const matching = tiers.filter((t) => tierCovers(t, quantity))
  if (matching.length === 0) {
    throw new PricingError(
      'NO_PRICING_RULE',
      'Bu miktar için tanımlı fiyat bulunamadı. Lütfen farklı bir miktar deneyin.',
      { quantity, tierCount: tiers.length },
    )
  }
  return matching.reduce((best, t) => {
    if (t.priority !== best.priority) return t.priority > best.priority ? t : best
    return t.minQuantity > best.minQuantity ? t : best
  })
}

/**
 * GRADUATED (kademeli) toplam.
 *
 * Kademeler artan sırada gezilir; her kademeye düşen adet kendi fiyatıyla
 * çarpılır. En düşük kademenin alt sınırı 0 kabul edilir — aksi halde
 * variant.minQuantity altındaki adetler hiçbir kademeye düşmez ve toplam
 * miktar tutmaz.
 */
function graduatedTotal(tiers: PricingTier[], quantity: number): number {
  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity)
  let prevUpper = 0
  let total = 0

  for (const tier of sorted) {
    const upper = tier.maxQuantity ?? Number.MAX_SAFE_INTEGER
    const unitsInBand = Math.max(0, Math.min(quantity, upper) - prevUpper)
    total += unitsInBand * tier.unitPriceMinor
    prevUpper = Math.max(prevUpper, Math.min(upper, quantity))
    if (quantity <= upper) break
  }
  return total
}

/**
 * ⭐ SABİT PAKET TUTARI
 *
 * `PACKAGE` modunda tutar HESAPLANMAZ, OKUNUR. Miktarla çarpma yoktur:
 * 500 takipçi = 32490 kuruş. `32490 / 500 = 64,98` kuruş olduğu için
 * birim fiyat üzerinden geri hesaplamak kuruş kaybı üretirdi.
 */
function packageTotal(tier: PricingTier): number {
  const price = tier.packagePriceMinor
  if (price == null || !Number.isInteger(price) || price <= 0) {
    throw new PricingError(
      'INVALID_PACKAGE_PRICE',
      'Bu paket için geçerli bir fiyat tanımlı değil.',
      { tierId: tier.id, packagePriceMinor: price ?? null },
    )
  }
  return price
}

/**
 * ⭐ ÇAPA TAVANI — "daha fazla alıp daha az öde" tersliğini KAPATIR
 *
 * ⚠️ ÇÖZDÜĞÜ GERÇEK SORUN
 *
 * Kademeli birim fiyat, band sınırında toplamı DÜŞÜREBİLİR:
 *
 *     999 × 1,40 ₺ = 1.398,60 ₺
 *   1.000 × 1,35 ₺ = 1.350,00 ₺     ← 1 adet FAZLA, 48,60 ₺ AZ
 *
 * Müşteriye "daha az alırsan daha çok ödersin" demek hem satış kaybı hem
 * güven kaybıdır. Kural şudur: **toplam, miktarla birlikte ASLA azalmaz.**
 *
 * ⚠️ İKİNCİ İŞİ — GERÇEK PAKET FİYATINI BİREBİR KORUMAK
 *
 * Birim fiyat `ceil` ile türetildiği için çapa miktarında fazla tahsilat
 * üretirdi (5.000 izlenme: 4 kr × 5.000 = 200,00 ₺ · gerçek paket 174,90 ₺).
 * Çapa fiyatı tavan olarak uygulandığında müşteri çapa miktarında **tam
 * olarak katalog fiyatını** öder — kuruşu kuruşuna, yuvarlama olmadan.
 *
 * Yöntem: toplam = min( birim × miktar , miktar ≤ çapa olan TÜM çapaların
 * fiyatları ). Band içinde toplam artar, çapaya ulaşınca sabitlenir.
 *
 * ⚠️ `GRADUATED` bu sorunu ÇÖZMEZ: ilerleyici toplam çapa fiyatlarını
 *    korumaz (1.000 için 999×140 + 1×135 = 1.399,95 ₺ ≠ 1.349,90 ₺).
 */
/**
 * ⚠️ DIŞARIYA AÇIK: `entryPriceOf` de bu tavanı kullanır. Kart üzerindeki
 * "…'den başlar" tutarı ile ödeme ekranındaki tutarın AYNI koddan gelmesi
 * gerekir; iki ayrı hesap 10 kuruşluk sessiz farklar üretiyordu.
 */
export function anchorCap(
  tiers: PricingTier[],
  quantity: number,
  linearMinor: number,
): { goodsMinor: number; anchorQuantity: number | null } {
  let best = linearMinor
  let anchorQuantity: number | null = null

  for (const t of tiers) {
    // Yalnızca BU miktara eşit ya da ONDAN BÜYÜK çapalar tavan olabilir.
    if (t.minQuantity < quantity) continue
    const anchor = t.packagePriceMinor
    if (anchor == null || !Number.isInteger(anchor) || anchor <= 0) continue
    if (anchor < best) {
      best = anchor
      // Çapa TAM olarak seçilen miktarsa bu bir "biraz daha al" durumu
      // değildir — sadece katalog fiyatının kendisidir.
      anchorQuantity = t.minQuantity > quantity ? t.minQuantity : null
    }
  }
  return { goodsMinor: best, anchorQuantity }
}

function goodsTotalFor(
  tier: PricingTier,
  tiers: PricingTier[],
  quantity: number,
): { goodsMinor: number; anchorQuantity: number | null } {
  if (tier.mode === 'PACKAGE') return { goodsMinor: packageTotal(tier), anchorQuantity: null }
  if (tier.mode === 'GRADUATED') {
    return { goodsMinor: graduatedTotal(tiers, quantity), anchorQuantity: null }
  }
  return anchorCap(tiers, quantity, tier.unitPriceMinor * quantity)
}

// ---------------------------------------------------------------------------
// İndirimler
// ---------------------------------------------------------------------------

function computeDiscount(baseMinor: number, spec: DiscountSpec | null | undefined): number {
  if (!spec) return 0
  if (spec.minOrderMinor != null && baseMinor < spec.minOrderMinor) return 0

  let discount =
    spec.type === 'PERCENTAGE'
      ? divRoundHalfUp(baseMinor * spec.value, 10_000)
      : Math.max(0, spec.value)

  if (spec.maxDiscountMinor != null) discount = Math.min(discount, spec.maxDiscountMinor)
  // İndirim tutarı hiçbir zaman tabanı aşamaz — negatif toplam oluşamaz.
  return Math.min(discount, baseMinor)
}

// ---------------------------------------------------------------------------
// Upsell göstergesi
// ---------------------------------------------------------------------------

function findNextTier(
  tiers: PricingTier[],
  quantity: number,
  currentUnitPrice: number,
): NextTierHint | null {
  const candidates = tiers
    .filter((t) => t.minQuantity > quantity && t.unitPriceMinor < currentUnitPrice)
    .sort((a, b) => a.minQuantity - b.minQuantity)

  const next = candidates[0]
  if (!next) return null

  return {
    minQuantity: next.minQuantity,
    unitPriceMinor: next.unitPriceMinor,
    unitSavingMinor: currentUnitPrice - next.unitPriceMinor,
    totalAtNextTierMinor: next.unitPriceMinor * next.minQuantity + next.setupFeeMinor,
  }
}

// ---------------------------------------------------------------------------
// ANA FONKSİYON
// ---------------------------------------------------------------------------

export function calculatePrice(input: CalculatePriceInput): PriceBreakdown {
  const {
    quantity,
    tiers,
    constraints,
    taxRateBp,
    campaign = null,
    coupon = null,
    allowStacking = false,
    currency = 'TRY',
  } = input

  if (!Number.isInteger(taxRateBp) || taxRateBp < 0) {
    throw new PricingError('INVALID_TAX_RATE', 'Geçersiz KDV oranı.', { taxRateBp })
  }

  // 1) Miktar doğrulama
  validateQuantity(quantity, constraints)

  // 2) Kademe seçimi
  const tier = selectTier(tiers, quantity)

  // 3) Taban tutar (KDV DAHİL)
  const { goodsMinor, anchorQuantity } = goodsTotalFor(tier, tiers, quantity)
  const listSubtotalMinor = goodsMinor + tier.setupFeeMinor

  // 4) İndirimler — kampanya önce, kupon sonra
  const campaignDiscountMinor = computeDiscount(listSubtotalMinor, campaign)
  const afterCampaign = listSubtotalMinor - campaignDiscountMinor

  let couponDiscountMinor = 0
  if (coupon) {
    const stackingBlocked = campaignDiscountMinor > 0 && !allowStacking
    if (!stackingBlocked) {
      couponDiscountMinor = computeDiscount(afterCampaign, coupon)
    }
  }

  const discountMinor = campaignDiscountMinor + couponDiscountMinor
  const totalMinor = listSubtotalMinor - discountMinor

  // 5) KDV — brüt toplamdan geriye ayrıştırılır (checkout'ta üzerine EKLENMEZ)
  const { taxAmountMinor, netMinor } = extractTaxFromGross(totalMinor, taxRateBp)

  // 6) Kırılım satırları
  const isPackage = tier.mode === 'PACKAGE'
  const lines: BreakdownLine[] = [
    {
      key: 'goods',
      // Sabit pakette "1 × birim fiyat" yazmak yanıltıcıdır: birim fiyat yoktur.
      label: isPackage ? 'Paket fiyatı' : `${quantity} × birim fiyat`,
      amountMinor: goodsMinor,
    },
  ]
  if (tier.setupFeeMinor > 0) {
    lines.push({ key: 'setup_fee', label: 'Hizmet bedeli', amountMinor: tier.setupFeeMinor })
  }
  if (campaignDiscountMinor > 0) {
    lines.push({
      key: 'campaign',
      label: 'Kampanya indirimi',
      amountMinor: -campaignDiscountMinor,
    })
  }
  if (couponDiscountMinor > 0) {
    lines.push({
      key: 'coupon',
      label: coupon?.code ? `Kupon (${coupon.code})` : 'Kupon indirimi',
      amountMinor: -couponDiscountMinor,
    })
  }
  lines.push({ key: 'total', label: 'Toplam (KDV dahil)', amountMinor: totalMinor })
  lines.push({
    key: 'tax',
    label: `Dahil KDV (%${taxRateBp / 100})`,
    amountMinor: taxAmountMinor,
    informational: true,
  })

  return {
    currency,
    quantity,
    pricingMode: tier.mode,
    packagePriceMinor: isPackage ? goodsMinor : null,
    tierId: tier.id,
    tierMinQuantity: tier.minQuantity,
    tierMaxQuantity: tier.maxQuantity,
    unitPriceMinor: tier.unitPriceMinor,
    /**
     * ⚠️ MÜŞTERİYE GÖSTERİLECEK BİRİM FİYAT BUDUR.
     *
     * Çapa tavanı devreye girdiğinde gerçekte ödenen birim, kademenin ilan
     * ettiği `unitPriceMinor`'dan DÜŞÜKTÜR. Kademe fiyatını göstermek
     * "birim × miktar ≠ toplam" gibi tutarsız bir kart üretirdi.
     */
    effectiveUnitPriceMinor: goodsMinor / quantity,
    /** Tavan hangi çapadan geldi? `null` = tavan uygulanmadı ya da tam çapadayız. */
    anchorQuantity,
    listSubtotalMinor,
    setupFeeMinor: tier.setupFeeMinor,
    campaignDiscountMinor,
    couponDiscountMinor,
    discountMinor,
    totalMinor,
    taxRateBp,
    taxAmountMinor,
    subtotalMinor: netMinor,
    // Sabit pakette "biraz daha ekle, birim fiyat düşsün" ipucu ANLAMSIZDIR.
    nextTier: isPackage ? null : findNextTier(tiers, quantity, tier.unitPriceMinor),
    lines,
  }
}
