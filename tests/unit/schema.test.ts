/**
 * ŞEMA BÜTÜNLÜK TESTLERİ (Prisma engine binary GEREKTİRMEZ)
 *
 * `prisma validate` Rust schema-engine indirmek zorundadır; kısıtlı ağlarda ve
 * bazı CI ortamlarında bu mümkün olmaz. Bu suite saf TS parser ile aynı sınıftaki
 * hataları yakalar ve `npm test` içinde her zaman çalışır.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getSchema } from '@mrleebo/prisma-ast'
import { describe, expect, it } from 'vitest'
import {
  DISCOUNT_TYPE, INVOICE_STATUS, MEASUREMENT_MODE, ORDER_EVENT_TYPE, ORDER_STATUS,
  PAYMENT_STATUS, PRICING_MODE, REFUND_STATUS, TARGET_STATUS, TARGET_TYPE, USER_ROLE,
} from '@/lib/enums'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any

const source = readFileSync('prisma/schema.prisma', 'utf8')
const ast = getSchema(source)

const models = new Map<string, AnyNode>()
const enums = new Map<string, string[]>()

for (const block of ast.list as AnyNode[]) {
  if (block.type === 'model') models.set(block.name, block)
  if (block.type === 'enum') {
    enums.set(
      block.name,
      (block.enumerators ?? []).filter((e: AnyNode) => e.type === 'enumerator').map((e: AnyNode) => e.name as string),
    )
  }
}

const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
])

interface FieldInfo {
  name: string
  typeName: string
  attrs: AnyNode[]
}

function fieldsOf(model: AnyNode): FieldInfo[] {
  return (model.properties ?? [])
    .filter((p: AnyNode) => p.type === 'field')
    .map((f: AnyNode) => ({
      name: f.name as string,
      typeName: typeof f.fieldType === 'string' ? f.fieldType : String(f.fieldType?.name ?? ''),
      attrs: (f.attributes ?? []) as AnyNode[],
    }))
}

function relationArgs(f: FieldInfo, key: 'fields' | 'references'): string[] {
  const rel = f.attrs.find((a: AnyNode) => a.name === 'relation')
  if (!rel) return []
  const arg = (rel.args ?? []).find(
    (a: AnyNode) => a.value?.type === 'keyValue' && a.value.key === key,
  )
  const raw = arg?.value?.value
  if (!raw) return []
  const items: AnyNode[] = Array.isArray(raw) ? raw : (raw.args ?? raw.values ?? [])
  return items.map((i) => String(typeof i === 'string' ? i : (i?.name ?? i)).replace(/["[\]]/g, '').trim())
}

// ---------------------------------------------------------------------------

describe('şema yapısı', () => {
  it('model ve enum blokları parse edilebiliyor', () => {
    expect(models.size).toBeGreaterThanOrEqual(18)
    expect(enums.size).toBeGreaterThanOrEqual(10)
  })

  it('tüm alan tipleri tanımlı (skaler, enum veya model)', () => {
    const unknown: string[] = []
    for (const [name, model] of models) {
      for (const f of fieldsOf(model)) {
        if (!SCALARS.has(f.typeName) && !enums.has(f.typeName) && !models.has(f.typeName)) {
          unknown.push(`${name}.${f.name}: ${f.typeName}`)
        }
      }
    }
    expect(unknown).toEqual([])
  })

  it('@relation(fields:) yerel alanları mevcut', () => {
    const bad: string[] = []
    for (const [name, model] of models) {
      const own = new Set(fieldsOf(model).map((f) => f.name))
      for (const f of fieldsOf(model)) {
        if (!models.has(f.typeName)) continue
        for (const local of relationArgs(f, 'fields')) {
          if (!own.has(local)) bad.push(`${name}.${f.name} → fields:[${local}]`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('@relation(references:) hedef alanları mevcut', () => {
    const bad: string[] = []
    for (const [name, model] of models) {
      for (const f of fieldsOf(model)) {
        const target = models.get(f.typeName)
        if (!target) continue
        const targetFields = new Set(fieldsOf(target).map((tf) => tf.name))
        for (const remote of relationArgs(f, 'references')) {
          if (!targetFields.has(remote)) bad.push(`${name}.${f.name} → ${f.typeName}.${remote}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('her ilişkinin karşı tarafı tanımlı', () => {
    const missing: string[] = []
    for (const [name, model] of models) {
      for (const f of fieldsOf(model)) {
        const target = models.get(f.typeName)
        if (!target) continue
        if (!fieldsOf(target).some((tf) => tf.typeName === name)) {
          missing.push(`${name}.${f.name} → ${f.typeName}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe('para ve vergi alanı tipleri', () => {
  it('…Minor alanları Int/BigInt (Float ve Decimal YASAK)', () => {
    const bad: string[] = []
    for (const [name, model] of models) {
      for (const f of fieldsOf(model)) {
        if (/Minor$/.test(f.name) && f.typeName !== 'Int' && f.typeName !== 'BigInt') {
          bad.push(`${name}.${f.name}: ${f.typeName}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('basis point alanları Int', () => {
    const bad: string[] = []
    for (const [name, model] of models) {
      for (const f of fieldsOf(model)) {
        if (/Bp$/.test(f.name) && f.typeName !== 'Int') bad.push(`${name}.${f.name}: ${f.typeName}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('enum senkronu (schema.prisma ↔ src/lib/enums.ts)', () => {
  const pairs: Array<[string, readonly string[]]> = [
    ['OrderStatus', ORDER_STATUS],
    ['OrderEventType', ORDER_EVENT_TYPE],
    ['TargetType', TARGET_TYPE],
    ['TargetStatus', TARGET_STATUS],
    ['PricingMode', PRICING_MODE],
    ['DiscountType', DISCOUNT_TYPE],
    ['MeasurementMode', MEASUREMENT_MODE],
    ['UserRole', USER_ROLE],
    ['InvoiceStatus', INVOICE_STATUS],
    ['PaymentStatus', PAYMENT_STATUS],
    ['RefundStatus', REFUND_STATUS],
  ]

  for (const [prismaName, tsValues] of pairs) {
    it(`${prismaName} birebir eşleşiyor`, () => {
      const schemaValues = enums.get(prismaName)
      expect(schemaValues, `${prismaName} şemada yok`).toBeDefined()
      expect([...schemaValues!].sort()).toEqual([...tsValues].sort())
    })
  }
})

describe('Faz 0 gereksinim alanları', () => {
  it('Order sipariş sistemi alanlarını taşıyor', () => {
    const names = new Set(fieldsOf(models.get('Order')!).map((f) => f.name))
    for (const req of [
      'orderNo', 'userId', 'isGuestOrder', 'guestEmail', 'guestName', 'guestPhone',
      'platformId', 'serviceId', 'serviceVariantId', 'targetId', 'quantity',
      'currency', 'unitPriceMinor', 'totalMinor', 'status', 'createdAt', 'updatedAt',
    ]) {
      expect(names.has(req), `Order.${req} eksik`).toBe(true)
    }
  })

  it('Order KDV snapshot alanlarını taşıyor (Faz 0 kararı #4)', () => {
    const names = new Set(fieldsOf(models.get('Order')!).map((f) => f.name))
    for (const req of ['subtotalMinor', 'taxRateBp', 'taxAmountMinor', 'totalMinor']) {
      expect(names.has(req), `Order.${req} eksik`).toBe(true)
    }
  })

  it('Order fatura alanlarını taşıyor (Faz 0 kararı #5)', () => {
    const names = new Set(fieldsOf(models.get('Order')!).map((f) => f.name))
    for (const req of ['invoiceStatus', 'invoiceNumber', 'invoiceProvider', 'invoiceId', 'invoiceUrl']) {
      expect(names.has(req), `Order.${req} eksik`).toBe(true)
    }
  })

  it('OrderItem manuel fulfillment ilerleme alanlarını taşıyor', () => {
    const names = new Set(fieldsOf(models.get('OrderItem')!).map((f) => f.name))
    for (const req of ['startCount', 'goalCount', 'currentCount', 'deliveredQuantity']) {
      expect(names.has(req), `OrderItem.${req} eksik`).toBe(true)
    }
  })

  it('Service hedef girdisini DB\'den sürüyor (yeni hizmet = 0 satır frontend)', () => {
    const names = new Set(fieldsOf(models.get('Service')!).map((f) => f.name))
    for (const req of ['inputLabel', 'inputPlaceholder', 'inputHelpText', 'inputExample', 'measurementMode']) {
      expect(names.has(req), `Service.${req} eksik`).toBe(true)
    }
  })

  it('ServiceVariant müşteri/iç ad ayrımını taşıyor', () => {
    const names = new Set(fieldsOf(models.get('ServiceVariant')!).map((f) => f.name))
    for (const req of ['internalName', 'customerLabel', 'tagline', 'badge', 'isDefault', 'isVisible']) {
      expect(names.has(req), `ServiceVariant.${req} eksik`).toBe(true)
    }
  })

  it('Platform adapterKey taşıyor (slug\'dan bağımsız)', () => {
    const names = new Set(fieldsOf(models.get('Platform')!).map((f) => f.name))
    expect(names.has('adapterKey')).toBe(true)
  })

  it('Target kullanıcı onayı alanını taşıyor (Instagram fallback)', () => {
    const names = new Set(fieldsOf(models.get('Target')!).map((f) => f.name))
    for (const req of ['userConfirmed', 'canonicalUrl', 'normalized', 'verifyMethod']) {
      expect(names.has(req), `Target.${req} eksik`).toBe(true)
    }
  })

  it('PaymentEvent webhook replay korumasını taşıyor', () => {
    expect(source).toMatch(/@@unique\(\[provider,\s*providerEventId\]\)/)
  })
})

// ---------------------------------------------------------------------------

describe('oturum çerezi tek kaynak', () => {
  /**
   * middleware.ts Edge runtime'da çalıştığı için `server-only` işaretli
   * cookies.ts'i import EDEMEZ ve isimleri elle taşır. İkisi ayrışırsa
   * oturumu olan kullanıcı korumalı sayfada girişe atılır — sessiz bir hata.
   * Bu test o ayrışmayı derleme zamanı yerine test zamanında yakalar.
   */
  it('middleware ve cookies.ts aynı çerez adlarını biliyor', () => {
    const middleware = readFileSync(path.resolve('src/middleware.ts'), 'utf8')
    const cookiesSrc = readFileSync(path.resolve('src/server/auth/cookies.ts'), 'utf8')

    const namesIn = (src: string) =>
      [...src.matchAll(/'((?:__Secure-)?medya333\.session)'/g)].map((m) => m[1]).sort()

    const mw = [...new Set(namesIn(middleware))]
    const ck = [...new Set(namesIn(cookiesSrc))]

    expect(mw).toHaveLength(2)
    expect(mw).toEqual(ck)
  })

  it('çerez HttpOnly ve SameSite=Lax olarak yapılandırılmış', () => {
    const src = readFileSync(path.resolve('src/server/auth/cookies.ts'), 'utf8')
    expect(src).toMatch(/httpOnly:\s*true/)
    expect(src).toMatch(/sameSite:\s*'lax'/)
  })
})
