/**
 * GEÇİCİ PRISMA TİP STUB ÜRETİCİ — sadece kısıtlı ağlarda typecheck içindir.
 *
 * `prisma generate` Rust schema-engine indirmek zorundadır. Bu erişimin
 * olmadığı ortamlarda (bazı CI runner'ları, kurumsal proxy'ler) tip kontrolü
 * tamamen imkânsız hale gelir. Bu script şemadan alan-farkında bir tip stub'ı
 * üretir; böylece `db.order.create({ data: { ... } })` içindeki ALAN ADI
 * HATALARI yine de yakalanır.
 *
 * ⚠️ Bu GERÇEK istemcinin yerine geçmez — çalışma zamanı davranışı yoktur.
 * Normal geliştirmede `npm run db:generate` çalıştırın; üretilen gerçek istemci
 * bu dosyayı üzerine yazar.
 *
 * Çalıştırma:  npx vite-node scripts/gen-prisma-stub.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { getSchema } from '@mrleebo/prisma-ast'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any

const SCALAR_TS: Record<string, string> = {
  String: 'string',
  Boolean: 'boolean',
  Int: 'number',
  BigInt: 'bigint',
  Float: 'number',
  Decimal: 'number',
  DateTime: 'Date',
  Json: 'any',
  Bytes: 'Uint8Array',
}

const ast = getSchema(readFileSync('prisma/schema.prisma', 'utf8'))

const models = new Map<string, AnyNode>()
const enums = new Map<string, string[]>()
for (const b of ast.list as AnyNode[]) {
  if (b.type === 'model') models.set(b.name, b)
  if (b.type === 'enum') {
    enums.set(b.name, (b.enumerators ?? []).filter((e: AnyNode) => e.type === 'enumerator').map((e: AnyNode) => e.name))
  }
}

interface F {
  name: string
  type: string
  array: boolean
  optional: boolean
  isRelation: boolean
}

function fields(model: AnyNode): F[] {
  return (model.properties ?? [])
    .filter((p: AnyNode) => p.type === 'field')
    .map((f: AnyNode) => {
      const type = typeof f.fieldType === 'string' ? f.fieldType : String(f.fieldType?.name ?? '')
      return {
        name: f.name as string,
        type,
        array: Boolean(f.array),
        optional: Boolean(f.optional),
        isRelation: models.has(type),
      }
    })
}

/** @@unique([a, b]) → "a_b" bileşik anahtar adları */
function compoundUniques(model: AnyNode): string[] {
  return (model.properties ?? [])
    .filter((p: AnyNode) => p.type === 'attribute' && (p.name === 'unique' || p.name === 'id'))
    .flatMap((p: AnyNode) => {
      const raw = p.args?.[0]?.value
      const items: AnyNode[] = Array.isArray(raw) ? raw : (raw?.args ?? [])
      const names = items.map((i) => String(typeof i === 'string' ? i : (i?.name ?? i)).replace(/["[\]]/g, '').trim())
      return names.length > 1 ? [names.join('_')] : []
    })
}

function tsType(f: F): string {
  const base = f.isRelation
    ? f.type
    : enums.has(f.type)
      ? enums.get(f.type)!.map((v) => `'${v}'`).join(' | ')
      : (SCALAR_TS[f.type] ?? 'any')
  const arr = f.array ? `${base}[]` : base
  return f.optional ? `${arr} | null` : arr
}

const out: string[] = [
  '/* AUTO-GENERATED TYPE STUB — DO NOT EDIT, DO NOT COMMIT.',
  ' * `npm run db:generate` bunu gerçek Prisma istemcisiyle değiştirir.',
  ' * Amaç: engine binary indirilemeyen ortamlarda tip kontrolünü mümkün kılmak.',
  ' */',
  '/* eslint-disable @typescript-eslint/no-explicit-any */',
  '',
]

// --- Enum sabitleri ---
for (const [name, values] of enums) {
  out.push(`export type ${name} = ${values.map((v) => `'${v}'`).join(' | ')}`)
}
out.push('')

// --- Model tipleri ---
for (const [name, model] of models) {
  const fs = fields(model)
  out.push(`export interface ${name} {`)
  for (const f of fs) {
    // İlişkiler stub'da opsiyonel DEĞİL: include zincirlerinin tip kontrolünden
    // geçebilmesi için. Gerçek istemcide bu doğru şekilde koşullu olur.
    out.push(`  ${f.name}: ${tsType(f)}`)
  }
  out.push('}')
  out.push('')
}

// --- Delegate tipleri: alan adları TİP GÜVENLİ, argüman içleri gevşek ---
const OPS_NULLABLE = ['findUnique', 'findFirst']
const OPS_ONE = ['findUniqueOrThrow', 'findFirstOrThrow', 'create', 'update', 'upsert', 'delete']
const OPS_BATCH = ['createMany', 'updateMany', 'deleteMany']

for (const [name, model] of models) {
  const fs = fields(model)
  const keys = [...fs.map((f) => f.name), ...compoundUniques(model)]
  const keyUnion = keys.map((k) => `'${k}'`).join(' | ')

  out.push(`type ${name}Keys = ${keyUnion}`)
  out.push(`type ${name}Args = {`)
  out.push(`  where?: Partial<Record<${name}Keys, any>> & { AND?: any; OR?: any; NOT?: any }`)
  out.push(`  data?: Partial<Record<${name}Keys, any>> | Array<Partial<Record<${name}Keys, any>>>`)
  out.push(`  create?: Partial<Record<${name}Keys, any>>`)
  out.push(`  update?: Partial<Record<${name}Keys, any>>`)
  out.push(`  select?: Partial<Record<${name}Keys, any>>`)
  out.push(`  include?: Partial<Record<${name}Keys, any>>`)
  out.push(`  orderBy?: Partial<Record<${name}Keys, any>> | Array<Partial<Record<${name}Keys, any>>>`)
  out.push('  take?: number; skip?: number; cursor?: any; distinct?: any')
  out.push('  by?: any; _count?: any; _sum?: any; _avg?: any; having?: any; skipDuplicates?: boolean')
  out.push('}')

  const delegate = [
    ...OPS_NULLABLE.map((op) => `  ${op}(args?: ${name}Args): Promise<${name} | null>`),
    ...OPS_ONE.map((op) => `  ${op}(args?: ${name}Args): Promise<${name}>`),
    `  findMany(args?: ${name}Args): Promise<${name}[]>`,
    `  count(args?: ${name}Args): Promise<number>`,
    ...OPS_BATCH.map((op) => `  ${op}(args?: ${name}Args): Promise<{ count: number }>`),
    `  aggregate(args?: ${name}Args): Promise<any>`,
    `  groupBy(args?: ${name}Args): Promise<any[]>`,
  ]
  out.push(`export interface ${name}Delegate {`, ...delegate, '}')
  out.push('')
}

// --- PrismaClient ---
const delegateProps = [...models.keys()]
  .map((m) => `  readonly ${m.charAt(0).toLowerCase()}${m.slice(1)}: ${m}Delegate`)
  .join('\n')

out.push(
  'export interface PrismaClientOptions {',
  '  adapter?: unknown',
  "  log?: Array<'query' | 'info' | 'warn' | 'error'>",
  '}',
  '',
  'export interface PrismaClient {',
  delegateProps,
  '  $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>',
  '  $transaction<T>(operations: Array<Promise<T>>): Promise<T[]>',
  '  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>',
  '  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>',
  '  $connect(): Promise<void>',
  '  $disconnect(): Promise<void>',
  '}',
  '',
  '// Çalışma zamanı: bu stub GERÇEK istemci DEĞİLDİR. Kurulum (new) serbesttir ki',
  '// derleme "page data" toplama adımı geçebilsin; herhangi bir sorgu çağrısı ise',
  '// açık bir hata ile durur.',
  'const STUB_ERROR =',
  "  'Prisma tip stub\\'ı kullanılıyor. Gerçek istemci için: npm run db:generate'",
  '',
  'class PrismaClientStub {',
  '  constructor(_options?: PrismaClientOptions) {',
  '    return new Proxy(this, {',
  '      get(_target, prop) {',
  '        if (typeof prop === "symbol") return undefined',
  '        if (prop === "then") return undefined',
  '        return new Proxy(() => {}, {',
  '          get: () => () => { throw new Error(STUB_ERROR) },',
  '          apply: () => { throw new Error(STUB_ERROR) },',
  '        })',
  '      },',
  '    })',
  '  }',
  '}',
  '',
  'export const PrismaClient = PrismaClientStub as unknown as {',
  '  new (options?: PrismaClientOptions): PrismaClient',
  '}',
  '',
  'export const Prisma = {',
  '  sql: (_strings: TemplateStringsArray, ..._values: unknown[]): unknown => {',
  '    throw new Error(STUB_ERROR)',
  '  },',
  '  join: (_values: unknown[], _separator?: string): unknown => {',
  '    throw new Error(STUB_ERROR)',
  '  },',
  '}',
  '',
)

mkdirSync('src/generated/prisma', { recursive: true })
writeFileSync('src/generated/prisma/client.ts', out.join('\n'))
writeFileSync('src/generated/prisma/index.ts', "export * from './client'\n")

console.log(`Stub üretildi: ${models.size} model, ${enums.size} enum → src/generated/prisma/client.ts`)
