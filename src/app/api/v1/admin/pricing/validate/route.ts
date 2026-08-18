import { adminHandler } from '../../_handler'
import { validateAllPricing, validatePricingTable } from '@/server/catalog/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/admin/pricing/validate?variantId=...
 *
 * variantId verilirse tek varyantı, verilmezse SORUNU OLAN tüm varyantları
 * raporlar. Admin dashboard uyarıları bu endpoint'ten beslenir.
 */
export const GET = adminHandler({ minimumRole: 'SUPPORT' }, async ({ req }) => {
  const variantId = req.nextUrl.searchParams.get('variantId')
  if (variantId) return { results: [await validatePricingTable(variantId)] }

  const results = await validateAllPricing()
  return {
    results,
    summary: {
      variantsWithIssues: results.length,
      errors: results.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'error').length, 0),
      warnings: results.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'warning').length, 0),
    },
  }
})
