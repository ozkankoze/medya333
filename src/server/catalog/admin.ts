import 'server-only'

import type { z } from 'zod'
import type {
  adminPlatformSchema,
  adminPricingRuleSchema,
  adminServiceSchema,
  adminVariantSchema,
} from '@/lib/validation'
import { validateTiers, findStepBoundaryIssues, type PricingTier } from '@/lib/pricing'
import { writeAudit } from '@/server/audit'
import { revalidateCatalog } from '@/server/cache'
import { db } from '@/server/db'
import { hasAdapter } from '@/server/platforms/registry'
import { invalidateCatalogCache } from './index'

/**
 * ADMIN KATALOG CRUD — servis katmanı
 *
 * Route'lar ince kalır; tüm iş kuralları burada:
 *   • Sunucu tarafı doğrulama (Zod route'ta, iş kuralları burada)
 *   • Katalog kayıtları GERÇEKTEN SİLİNMEZ — siparişi olan kayıt isActive:false olur
 *   • Her yazma işlemi AuditLog'a before/after ile düşer
 *   • Her yazma sonrası katalog önbelleği (Next tag + Redis) düşürülür
 */

export class CatalogAdminError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'CatalogAdminError'
  }
}

export interface ActorContext {
  actorId: string
  actorIpHash?: string | null
}

async function afterWrite(): Promise<void> {
  revalidateCatalog()
  await invalidateCatalogCache()
}

// ---------------------------------------------------------------------------
// PLATFORM
// ---------------------------------------------------------------------------

type PlatformInput = z.infer<typeof adminPlatformSchema>

export async function createPlatform(input: PlatformInput, actor: ActorContext) {
  if (!hasAdapter(input.adapterKey)) {
    throw new CatalogAdminError(
      'UNKNOWN_ADAPTER',
      `Bilinmeyen adapter: "${input.adapterKey}". Kayıtlı bir adapter seçin veya "generic" kullanın.`,
    )
  }
  const exists = await db.platform.findUnique({ where: { slug: input.slug }, select: { id: true } })
  if (exists) throw new CatalogAdminError('SLUG_TAKEN', 'Bu slug zaten kullanılıyor.', 409)

  const created = await db.platform.create({ data: input })
  await writeAudit({ ...actor, action: 'platform.create', entityType: 'Platform', entityId: created.id, after: created })
  await afterWrite()
  return created
}

export async function updatePlatform(id: string, input: Partial<PlatformInput>, actor: ActorContext) {
  const before = await db.platform.findUnique({ where: { id } })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Platform bulunamadı.', 404)

  if (input.adapterKey && !hasAdapter(input.adapterKey)) {
    throw new CatalogAdminError('UNKNOWN_ADAPTER', `Bilinmeyen adapter: "${input.adapterKey}".`)
  }
  if (input.slug && input.slug !== before.slug) {
    const clash = await db.platform.findUnique({ where: { slug: input.slug }, select: { id: true } })
    if (clash) throw new CatalogAdminError('SLUG_TAKEN', 'Bu slug zaten kullanılıyor.', 409)
  }

  const after = await db.platform.update({ where: { id }, data: input })
  await writeAudit({ ...actor, action: 'platform.update', entityType: 'Platform', entityId: id, before, after })
  await afterWrite()
  return after
}

/** Siparişi olan platform SİLİNMEZ — pasife alınır (geçmiş raporlar bozulmasın). */
export async function deletePlatform(id: string, actor: ActorContext) {
  const before = await db.platform.findUnique({
    where: { id },
    include: { _count: { select: { orders: true, services: true } } },
  })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Platform bulunamadı.', 404)

  if (before._count.orders > 0) {
    const after = await db.platform.update({ where: { id }, data: { isActive: false } })
    await writeAudit({ ...actor, action: 'platform.deactivate', entityType: 'Platform', entityId: id, before, after })
    await afterWrite()
    return { deleted: false, deactivated: true, reason: 'Bu platformun siparişleri var; pasife alındı.' }
  }

  await db.platform.delete({ where: { id } })
  await writeAudit({ ...actor, action: 'platform.delete', entityType: 'Platform', entityId: id, before })
  await afterWrite()
  return { deleted: true, deactivated: false }
}

export async function reorderPlatforms(order: Array<{ id: string; sortOrder: number }>, actor: ActorContext) {
  await db.$transaction(
    order.map((o) => db.platform.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder } })),
  )
  await writeAudit({ ...actor, action: 'platform.reorder', entityType: 'Platform', entityId: '*', after: order })
  await afterWrite()
  return { updated: order.length }
}

// ---------------------------------------------------------------------------
// SERVICE
// ---------------------------------------------------------------------------

type ServiceInput = z.infer<typeof adminServiceSchema>

export async function createService(input: ServiceInput, actor: ActorContext) {
  const platform = await db.platform.findUnique({ where: { id: input.platformId }, select: { id: true } })
  if (!platform) throw new CatalogAdminError('PLATFORM_NOT_FOUND', 'Platform bulunamadı.', 404)

  const clash = await db.service.findUnique({
    where: { platformId_slug: { platformId: input.platformId, slug: input.slug } },
    select: { id: true },
  })
  if (clash) throw new CatalogAdminError('SLUG_TAKEN', 'Bu platformda aynı slug zaten var.', 409)

  const created = await db.service.create({ data: input })
  await writeAudit({ ...actor, action: 'service.create', entityType: 'Service', entityId: created.id, after: created })
  await afterWrite()
  return created
}

export async function updateService(id: string, input: Partial<ServiceInput>, actor: ActorContext) {
  const before = await db.service.findUnique({ where: { id } })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Hizmet bulunamadı.', 404)

  if (input.slug && input.slug !== before.slug) {
    const clash = await db.service.findUnique({
      where: { platformId_slug: { platformId: input.platformId ?? before.platformId, slug: input.slug } },
      select: { id: true },
    })
    if (clash) throw new CatalogAdminError('SLUG_TAKEN', 'Bu platformda aynı slug zaten var.', 409)
  }

  const after = await db.service.update({ where: { id }, data: input })
  await writeAudit({ ...actor, action: 'service.update', entityType: 'Service', entityId: id, before, after })
  await afterWrite()
  return after
}

export async function deleteService(id: string, actor: ActorContext) {
  const before = await db.service.findUnique({
    where: { id },
    include: { _count: { select: { orders: true } } },
  })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Hizmet bulunamadı.', 404)

  if (before._count.orders > 0) {
    const after = await db.service.update({ where: { id }, data: { isActive: false } })
    await writeAudit({ ...actor, action: 'service.deactivate', entityType: 'Service', entityId: id, before, after })
    await afterWrite()
    return { deleted: false, deactivated: true, reason: 'Bu hizmetin siparişleri var; pasife alındı.' }
  }

  await db.service.delete({ where: { id } })
  await writeAudit({ ...actor, action: 'service.delete', entityType: 'Service', entityId: id, before })
  await afterWrite()
  return { deleted: true, deactivated: false }
}

// ---------------------------------------------------------------------------
// SERVICE VARIANT
// ---------------------------------------------------------------------------

type VariantInput = z.infer<typeof adminVariantSchema>

export async function createVariant(input: VariantInput, actor: ActorContext) {
  const service = await db.service.findUnique({ where: { id: input.serviceId }, select: { id: true } })
  if (!service) throw new CatalogAdminError('SERVICE_NOT_FOUND', 'Hizmet bulunamadı.', 404)

  const clash = await db.serviceVariant.findUnique({
    where: { serviceId_slug: { serviceId: input.serviceId, slug: input.slug } },
    select: { id: true },
  })
  if (clash) throw new CatalogAdminError('SLUG_TAKEN', 'Bu hizmette aynı slug zaten var.', 409)

  const created = await db.$transaction(async (tx) => {
    // Tek varsayılan varyant olabilir
    if (input.isDefault) {
      await tx.serviceVariant.updateMany({
        where: { serviceId: input.serviceId },
        data: { isDefault: false },
      })
    }
    return tx.serviceVariant.create({ data: input })
  })

  await writeAudit({ ...actor, action: 'variant.create', entityType: 'ServiceVariant', entityId: created.id, after: created })
  await afterWrite()
  return created
}

export async function updateVariant(id: string, input: Partial<VariantInput>, actor: ActorContext) {
  const before = await db.serviceVariant.findUnique({ where: { id } })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Varyant bulunamadı.', 404)

  const minQ = input.minQuantity ?? before.minQuantity
  const maxQ = input.maxQuantity ?? before.maxQuantity
  if (maxQ < minQ) {
    throw new CatalogAdminError('INVALID_RANGE', 'Maksimum miktar minimumdan küçük olamaz.', 400, {
      minQuantity: minQ,
      maxQuantity: maxQ,
    })
  }

  const after = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.serviceVariant.updateMany({
        where: { serviceId: before.serviceId, id: { not: id } },
        data: { isDefault: false },
      })
    }
    return tx.serviceVariant.update({ where: { id }, data: input })
  })

  await writeAudit({ ...actor, action: 'variant.update', entityType: 'ServiceVariant', entityId: id, before, after })
  await afterWrite()
  return after
}

export async function deleteVariant(id: string, actor: ActorContext) {
  const before = await db.serviceVariant.findUnique({
    where: { id },
    include: { _count: { select: { orders: true } } },
  })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Varyant bulunamadı.', 404)

  if (before._count.orders > 0) {
    const after = await db.serviceVariant.update({ where: { id }, data: { isActive: false } })
    await writeAudit({ ...actor, action: 'variant.deactivate', entityType: 'ServiceVariant', entityId: id, before, after })
    await afterWrite()
    return { deleted: false, deactivated: true, reason: 'Bu varyantın siparişleri var; pasife alındı.' }
  }

  await db.serviceVariant.delete({ where: { id } })
  await writeAudit({ ...actor, action: 'variant.delete', entityType: 'ServiceVariant', entityId: id, before })
  await afterWrite()
  return { deleted: true, deactivated: false }
}

// ---------------------------------------------------------------------------
// PRICING RULE
// ---------------------------------------------------------------------------

type PricingRuleInput = z.infer<typeof adminPricingRuleSchema>

/** Kaydetmeden ÖNCE tabloyu simüle edip doğrular (bkz. validatePricingTable). */
export async function createPricingRule(input: PricingRuleInput, actor: ActorContext) {
  const variant = await db.serviceVariant.findUnique({ where: { id: input.serviceVariantId } })
  if (!variant) throw new CatalogAdminError('VARIANT_NOT_FOUND', 'Varyant bulunamadı.', 404)

  await assertNoDuplicate(input.serviceVariantId, input.minQuantity, input.maxQuantity ?? null, null)

  const created = await db.pricingRule.create({ data: { ...input, createdById: actor.actorId } })
  await writeAudit({ ...actor, action: 'pricing_rule.create', entityType: 'PricingRule', entityId: created.id, after: created })
  await afterWrite()
  return created
}

export async function updatePricingRule(id: string, input: Partial<PricingRuleInput>, actor: ActorContext) {
  const before = await db.pricingRule.findUnique({ where: { id } })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Fiyat kademesi bulunamadı.', 404)

  const minQ = input.minQuantity ?? before.minQuantity
  const maxQ = input.maxQuantity !== undefined ? input.maxQuantity : before.maxQuantity
  if (maxQ != null && maxQ < minQ) {
    throw new CatalogAdminError('INVALID_RANGE', 'Üst sınır alt sınırdan küçük olamaz.')
  }
  if (input.unitPriceMinor != null && input.unitPriceMinor <= 0) {
    throw new CatalogAdminError('INVALID_PRICE', 'Birim fiyat sıfırdan büyük olmalıdır.')
  }

  await assertNoDuplicate(before.serviceVariantId, minQ, maxQ ?? null, id)

  const after = await db.pricingRule.update({ where: { id }, data: input })
  await writeAudit({ ...actor, action: 'pricing_rule.update', entityType: 'PricingRule', entityId: id, before, after })
  await afterWrite()
  return after
}

export async function deletePricingRule(id: string, actor: ActorContext) {
  const before = await db.pricingRule.findUnique({ where: { id } })
  if (!before) throw new CatalogAdminError('NOT_FOUND', 'Fiyat kademesi bulunamadı.', 404)

  await db.pricingRule.delete({ where: { id } })
  await writeAudit({ ...actor, action: 'pricing_rule.delete', entityType: 'PricingRule', entityId: id, before })
  await afterWrite()
  return { deleted: true }
}

/** Aynı [min,max] aralığına sahip ikinci kademe = duplicate. */
async function assertNoDuplicate(
  serviceVariantId: string,
  minQuantity: number,
  maxQuantity: number | null,
  excludeId: string | null,
): Promise<void> {
  const dup = await db.pricingRule.findFirst({
    where: {
      serviceVariantId,
      minQuantity,
      maxQuantity,
      isActive: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  })
  if (dup) {
    throw new CatalogAdminError(
      'DUPLICATE_TIER',
      `Bu varyantta ${minQuantity}–${maxQuantity ?? '∞'} aralığı için zaten bir kademe var.`,
      409,
      { existingId: dup.id },
    )
  }
}

// ---------------------------------------------------------------------------
// FİYAT TABLOSU DOĞRULAMA (admin editörünün arkasındaki motor)
// ---------------------------------------------------------------------------

export interface PricingIssue {
  severity: 'error' | 'warning'
  code:
    | 'GAP'
    | 'OVERLAP'
    | 'INVALID_PRICE'
    | 'INVALID_RANGE'
    | 'DUPLICATE_TIER'
    | 'UNREACHABLE_TIER'
    | 'TIER_BOUNDARY_UNREACHABLE'
    | 'NO_TIERS'
  message: string
  tierIds?: string[]
  range?: { from: number; to: number | null }
}

export interface PricingValidationResult {
  variantId: string
  variantLabel: string
  serviceName: string
  platformName: string
  minQuantity: number
  maxQuantity: number
  ok: boolean
  issues: PricingIssue[]
}

/**
 * Bir varyantın fiyat tablosunu doğrular.
 * Kapsam: boşluk · çakışma · negatif/sıfır fiyat · geçersiz aralık ·
 *         duplicate kademe · erişilemez kademe · hiç kademe yok.
 */
export async function validatePricingTable(variantId: string): Promise<PricingValidationResult> {
  const variant = await db.serviceVariant.findUnique({
    where: { id: variantId },
    include: {
      service: { include: { platform: true } },
      pricingRules: { where: { isActive: true }, orderBy: { minQuantity: 'asc' } },
    },
  })
  if (!variant) throw new CatalogAdminError('VARIANT_NOT_FOUND', 'Varyant bulunamadı.', 404)

  const tiers: PricingTier[] = variant.pricingRules.map((r) => ({
    id: r.id,
    mode: r.mode,
    minQuantity: r.minQuantity,
    maxQuantity: r.maxQuantity,
    unitPriceMinor: r.unitPriceMinor,
    setupFeeMinor: r.setupFeeMinor,
    priority: r.priority,
  }))

  const issues: PricingIssue[] = []

  if (tiers.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_TIERS',
      message: 'Bu varyantın hiç fiyat kademesi yok — müşteriye gösterilemez.',
    })
  }

  const report = validateTiers(tiers, {
    minQuantity: variant.minQuantity,
    maxQuantity: variant.maxQuantity,
  })

  for (const gap of report.gaps) {
    issues.push({
      severity: 'error',
      code: 'GAP',
      message: `${gap.fromQuantity}–${gap.toQuantity} aralığı için fiyat tanımlı değil. Bu miktarlarda sipariş verilemez.`,
      range: { from: gap.fromQuantity, to: gap.toQuantity },
    })
  }

  for (const ov of report.overlaps) {
    const winner = tiers.find((t) => t.id === ov.winnerId)
    issues.push({
      severity: 'warning',
      code: 'OVERLAP',
      message:
        `${ov.fromQuantity}–${ov.toQuantity ?? '∞'} aralığında iki kademe çakışıyor. ` +
        `Uygulanacak birim fiyat: ${((winner?.unitPriceMinor ?? 0) / 100).toFixed(2)} ₺.`,
      tierIds: [ov.aId, ov.bId],
      range: { from: ov.fromQuantity, to: ov.toQuantity },
    })
  }

  for (const inv of report.invalid) {
    issues.push({
      severity: 'error',
      code: inv.reason.includes('fiyat') ? 'INVALID_PRICE' : 'INVALID_RANGE',
      message: inv.reason,
      tierIds: [inv.id],
    })
  }

  // Duplicate: birebir aynı [min,max]
  const seen = new Map<string, string[]>()
  for (const t of tiers) {
    const key = `${t.minQuantity}:${t.maxQuantity ?? 'inf'}`
    seen.set(key, [...(seen.get(key) ?? []), t.id])
  }
  for (const [key, ids] of seen) {
    if (ids.length > 1) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_TIER',
        message: `${key.replace(':', '–').replace('inf', '∞')} aralığı için ${ids.length} kademe tanımlı.`,
        tierIds: ids,
      })
    }
  }

  // Erişilemez: varyantın min/max aralığının tamamen dışında kalan kademe
  for (const t of tiers) {
    const upper = t.maxQuantity ?? Number.MAX_SAFE_INTEGER
    if (upper < variant.minQuantity || t.minQuantity > variant.maxQuantity) {
      issues.push({
        severity: 'warning',
        code: 'UNREACHABLE_TIER',
        message:
          `${t.minQuantity}–${t.maxQuantity ?? '∞'} kademesi, varyantın izin verdiği ` +
          `${variant.minQuantity}–${variant.maxQuantity} aralığının dışında; hiçbir zaman uygulanmaz.`,
        tierIds: [t.id],
      })
    }
  }

  // Adım (quantityStep) yüzünden erişilemeyen kademe sınırları.
  // HATA DEĞİL — sipariş akışını bozmaz — ama admin'in tabloyu yanlış
  // okumasına yol açar, bu yüzden açık bir uyarı olarak raporlanır.
  for (const s of findStepBoundaryIssues(tiers, {
    minQuantity: variant.minQuantity,
    maxQuantity: variant.maxQuantity,
    quantityStep: variant.quantityStep,
  })) {
    const declared = `${s.declaredFrom}–${s.declaredTo ?? '∞'}`
    issues.push({
      severity: 'warning',
      code: 'TIER_BOUNDARY_UNREACHABLE',
      message:
        s.kind === 'EMPTY'
          ? `${declared} kademesi ${variant.quantityStep} adetlik artış nedeniyle hiç seçilemiyor: ` +
            `bu aralıkta geçerli bir miktar yok. Kademe sınırlarını ${variant.quantityStep}'in ` +
            `katlarına göre ayarlayın.`
          : `${declared} kademesinin son miktarı (${s.declaredTo}) ${variant.quantityStep} adetlik ` +
            `artış nedeniyle seçilemiyor. Bu kademe pratikte ${s.lastSelectable} adette bitiyor. ` +
            `Üst sınırı ${s.lastSelectable} yapmak tabloyu netleştirir.`,
      tierIds: [s.tierId],
      range: { from: s.declaredFrom, to: s.declaredTo },
    })
  }

  return {
    variantId: variant.id,
    variantLabel: variant.customerLabel,
    serviceName: variant.service.name,
    platformName: variant.service.platform.name,
    minQuantity: variant.minQuantity,
    maxQuantity: variant.maxQuantity,
    ok: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  }
}

/** Tüm katalog için doğrulama raporu — admin dashboard uyarıları buradan gelir. */
export async function validateAllPricing(): Promise<PricingValidationResult[]> {
  const variants = await db.serviceVariant.findMany({
    where: { isActive: true },
    select: { id: true },
  })
  const results: PricingValidationResult[] = []
  for (const v of variants) results.push(await validatePricingTable(v.id))
  return results.filter((r) => r.issues.length > 0)
}
