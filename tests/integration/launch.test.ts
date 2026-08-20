/**
 * ⭐ FAZ 9 — CANLIYA ÇIKIŞ ENTEGRASYON TESTLERİ
 *
 * Kilitlenen üç şey:
 *   1. Üretim alan adı (`https://www.medya333.com`) e-posta ve takip
 *      bağlantılarında GERÇEKTEN kullanılıyor; localhost sızmıyor.
 *   2. Rol yükseltme (privilege escalation) sunucuda engelli.
 *   3. Bildirim paneli PII sızdırmıyor; yeniden gönderim idempotency'yi bozmuyor.
 */

/**
 * ⚠️ BU IMPORT İLK SIRADA OLMALI — ortam değişkenlerini `@/env` zinciri
 * yüklenmeden önce ayarlar. Ayrıntılı gerekçe: `launch-env.ts`.
 */
import './launch-env'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import { seedAll } from '../../prisma/seed/index'
import {
  pickCatalogVariant,
  setupTestDatabase,
  truncateTransactional,
  type TestDatabase,
} from './db-setup'

import { createOrder } from '@/server/orders/create'
import { MemoryMailProvider, setMailProvider } from '@/server/mail'
import { appBaseUrl } from '@/server/base-url'
import {
  assignableRoles,
  canEditRole,
  changeUserRole,
  listUsers,
  UserAdminError,
} from '@/server/users/admin'
import {
  getOperationAlerts,
  listNotifications,
  retryNotification,
} from '@/server/notifications/admin'
import type { CreateOrderInput } from '@/lib/validation'
import type { UserRole } from '@/lib/enums'

let ctx: TestDatabase
let db: PrismaClient
let variantId: string
let platformId: string
let qty: number
let mail: MemoryMailProvider

const users: Record<'customer' | 'support' | 'operator' | 'admin' | 'admin2' | 'super', string> = {
  customer: '',
  support: '',
  operator: '',
  admin: '',
  admin2: '',
  super: '',
}

let seq = 0
const nextKey = () => `launch-key-${Date.now()}-${++seq}-padding`

async function makeOrder(email: string, handle: string) {
  const target = await db.target.create({
    data: {
      platformId,
      targetType: 'PROFILE',
      rawInput: `@${handle}`,
      normalized: handle,
      canonicalUrl: `https://instagram.com/${handle}`,
      status: 'UNVERIFIED',
      verifyMethod: 'format_only',
      handle,
    },
    select: { id: true },
  })
  const res = await createOrder(
    {
      serviceVariantId: variantId,
      quantity: qty,
      targetId: target.id,
      targetConfirmed: true,
      customerFirstName: 'Ayşe',
      customerLastName: 'Yılmaz',
      guestEmail: email,
      acceptedTerms: true,
      acceptedRefund: true,
      acceptedPrivacy: true,
    } as CreateOrderInput,
    { userId: null, idempotencyKey: nextKey(), ipHash: 'iphash', userAgent: 'vitest' },
  )
  return res
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  db = ctx.db
  await seedAll(db)

  const fixture = await pickCatalogVariant(db, { atLeast: 1000 })
  variantId = fixture.variantId
  platformId = fixture.platformId
  qty = fixture.quantity

  for (const [key, email, role] of [
    ['customer', 'faz9-customer@roles.test', 'CUSTOMER'],
    ['support', 'faz9-support@roles.test', 'SUPPORT'],
    ['operator', 'faz9-operator@roles.test', 'OPERATOR'],
    ['admin', 'faz9-admin@roles.test', 'ADMIN'],
    ['admin2', 'faz9-admin2@roles.test', 'ADMIN'],
    ['super', 'faz9-super@roles.test', 'SUPERADMIN'],
  ] as const) {
    const u = await db.user.upsert({
      where: { email },
      update: { role, isGuest: false },
      create: { email, role },
      select: { id: true },
    })
    users[key] = u.id
  }
}, 240_000)

afterAll(async () => {
  setMailProvider(null)
  await ctx?.stop()
})

beforeEach(async () => {
  await truncateTransactional(db)
  await db.user.deleteMany({ where: { email: { contains: 'ornek.test' } } })
  // Rolleri her testte sıfırla — bir testin değişikliği diğerine sızmasın.
  for (const [key, role] of [
    ['customer', 'CUSTOMER'],
    ['support', 'SUPPORT'],
    ['operator', 'OPERATOR'],
    ['admin', 'ADMIN'],
    ['admin2', 'ADMIN'],
    ['super', 'SUPERADMIN'],
  ] as const) {
    await db.user.update({ where: { id: users[key] }, data: { role } })
  }
  mail = new MemoryMailProvider()
  setMailProvider(mail)
})

// ===========================================================================
describe('⭐ ÜRETİM ALAN ADI', () => {
  it('appBaseUrl() APP_BASE_URL değerini döner', () => {
    expect(appBaseUrl()).toBe('https://www.medya333.com')
  })

  it('⚠️ SİPARİŞ E-POSTASINDAKİ takip bağlantısı üretim alan adını kullanır', async () => {
    await makeOrder('domain@ornek.test', 'domainhedef')

    const sent = mail.outbox.find((m) => m.template === 'ORDER_CREATED')
    expect(sent, 'sipariş e-postası üretilmedi').toBeTruthy()

    expect(sent!.text).toContain('https://www.medya333.com/siparisler/')
    expect(sent!.html).toContain('https://www.medya333.com/siparisler/')
  })

  it('⚠️ E-POSTADA localhost / 127.0.0.1 / example.com GEÇMEZ', async () => {
    await makeOrder('leak@ornek.test', 'leakhedef')
    const blob = JSON.stringify(mail.outbox)
    for (const bad of ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'staging.']) {
      expect(blob, `e-postada geliştirme adresi: ${bad}`).not.toContain(bad)
    }
  })

  it('⚠️ CANLI ROBOTS ÜRETİM ALAN ADINI KULLANIR (Faz 11)', async () => {
    const { buildRobots } = await import('@/lib/seo/robots-rules')

    /**
     * ⚠️ Rota dosyası test ortamının aşamasını okur; burada CANLI dal
     * doğrudan çağrılır ki "canlıda hangi alan adı yazacak?" sorusu canlıya
     * çıkmadan cevaplansın.
     */
    const live = buildRobots({ base: 'https://www.medya333.com', live: true })
    expect(live.sitemap).toBe('https://www.medya333.com/sitemap.xml')
    expect(live.host).toBe('https://www.medya333.com')

    // Canlı olmayan dal hiçbir alan adı sızdırmaz.
    const preview = buildRobots({ base: 'https://www.medya333.com', live: false })
    expect(JSON.stringify(preview)).not.toContain('medya333.com')
  })

  it('⚠️ WEB MANIFEST üretim alan adını kullanır ve olmayan varlık uydurmaz', async () => {
    const { default: manifest } = await import('@/app/manifest')
    const m = manifest()

    expect(m.start_url).toBe('https://www.medya333.com/')
    expect(m.scope).toBe('https://www.medya333.com/')

    // ⚠️ Olmayan varlık üretilmedi: PNG ikon ve ekran görüntüsü YOK.
    expect(m.icons).toHaveLength(1)
    expect(m.icons![0]!.src).toBe('/icon.svg')
    expect(JSON.stringify(m)).not.toContain('.png')
    expect(JSON.stringify(m)).not.toContain('screenshot')

    // ⚠️ Ödeme akışında adres çubuğu bir güvenlik özelliğidir.
    expect(m.display).toBe('browser')
  })

  it('⚠️ TAKİP TOKEN\'ı bildirim kaydına YAZILMAZ', async () => {
    const res = await makeOrder('token@ornek.test', 'tokenhedef')
    expect(res.accessToken, 'takip token\'ı üretilmedi').toBeTruthy()

    const notification = await db.notification.findFirstOrThrow({
      where: { orderId: res.order.id },
    })
    expect(JSON.stringify(notification)).not.toContain(res.accessToken!)
  })
})

// ===========================================================================
describe('⭐ ROL YÖNETİMİ — YETKİ YÜKSELTME ENGELİ', () => {
  it('atanabilir roller: ADMIN kendinden düşük, SUPERADMIN hepsi', () => {
    expect(assignableRoles('ADMIN')).toEqual(['CUSTOMER', 'SUPPORT', 'OPERATOR'])
    expect(assignableRoles('SUPERADMIN')).toEqual([
      'CUSTOMER',
      'SUPPORT',
      'OPERATOR',
      'ADMIN',
      'SUPERADMIN',
    ])
  })

  it('⚠️ KİMSE KENDİ ROLÜNÜ DEĞİŞTİREMEZ (SUPERADMIN dahil)', async () => {
    for (const [key, role] of [
      ['admin', 'ADMIN'],
      ['super', 'SUPERADMIN'],
    ] as const) {
      await expect(
        changeUserRole({
          userId: users[key],
          role: 'SUPERADMIN',
          actorId: users[key],
          actorRole: role as UserRole,
        }),
      ).rejects.toThrow(/SELF_ROLE_CHANGE|Kendi rolünüzü/)
    }
  })

  it('⚠️ ADMIN başkasını ADMIN veya SUPERADMIN YAPAMAZ', async () => {
    for (const target of ['ADMIN', 'SUPERADMIN'] as const) {
      await expect(
        changeUserRole({
          userId: users.customer,
          role: target,
          actorId: users.admin,
          actorRole: 'ADMIN',
        }),
      ).rejects.toThrow(/ROLE_ABOVE_ACTOR|yetki seviyenizde/)
    }
    // Rol gerçekten değişmemiş
    const after = await db.user.findUniqueOrThrow({ where: { id: users.customer } })
    expect(after.role).toBe('CUSTOMER')
  })

  it('⚠️ ADMIN başka bir ADMIN\'i DÜŞÜREMEZ', async () => {
    await expect(
      changeUserRole({
        userId: users.admin2,
        role: 'CUSTOMER',
        actorId: users.admin,
        actorRole: 'ADMIN',
      }),
    ).rejects.toThrow(/TARGET_ABOVE_ACTOR|seviyenizdeki/)
  })

  it('ADMIN kendinden düşük rolleri atayabilir', async () => {
    const res = await changeUserRole({
      userId: users.customer,
      role: 'OPERATOR',
      actorId: users.admin,
      actorRole: 'ADMIN',
    })
    expect(res).toEqual({ userId: users.customer, from: 'CUSTOMER', to: 'OPERATOR' })

    const after = await db.user.findUniqueOrThrow({ where: { id: users.customer } })
    expect(after.role).toBe('OPERATOR')
  })

  it('SUPERADMIN, ADMIN atayabilir', async () => {
    const res = await changeUserRole({
      userId: users.support,
      role: 'ADMIN',
      actorId: users.super,
      actorRole: 'SUPERADMIN',
    })
    expect(res.to).toBe('ADMIN')
  })

  it('⚠️ SON SUPERADMIN DÜŞÜRÜLEMEZ (kilitlenme koruması)', async () => {
    // Seed bir SUPERADMIN oluşturmuş olabilir; hepsini temizleyip tek bırakalım.
    await db.user.updateMany({
      where: { role: 'SUPERADMIN', id: { not: users.super } },
      data: { role: 'ADMIN' },
    })

    await expect(
      changeUserRole({
        userId: users.super,
        role: 'ADMIN',
        actorId: users.admin,
        actorRole: 'SUPERADMIN',
      }),
    ).rejects.toThrow(/LAST_SUPERADMIN|son SUPERADMIN/)
  })

  it('ikinci SUPERADMIN varsa düşürme serbest', async () => {
    await db.user.update({ where: { id: users.admin2 }, data: { role: 'SUPERADMIN' } })

    const res = await changeUserRole({
      userId: users.super,
      role: 'ADMIN',
      actorId: users.admin2,
      actorRole: 'SUPERADMIN',
    })
    expect(res.to).toBe('ADMIN')
  })

  it('⚠️ ROL DEĞİŞİKLİĞİ denetim kaydına yazılır ve PII içermez', async () => {
    await changeUserRole({
      userId: users.customer,
      role: 'SUPPORT',
      actorId: users.admin,
      actorRole: 'ADMIN',
      actorIpHash: 'iphash',
    })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.role_change', entityId: users.customer },
    })
    expect(audit.actorId).toBe(users.admin)
    expect(audit.before).toEqual({ role: 'CUSTOMER' })
    expect(audit.after).toEqual({ role: 'SUPPORT' })

    const raw = JSON.stringify(audit)
    expect(raw).not.toContain('faz9-customer@roles.test')
    expect(raw).not.toContain('@roles.test')
  })

  it('misafir gölge kaydına rol atanamaz', async () => {
    const guest = await db.user.create({
      data: { email: 'misafir@ornek.test', isGuest: true },
      select: { id: true },
    })
    await expect(
      changeUserRole({
        userId: guest.id,
        role: 'OPERATOR',
        actorId: users.admin,
        actorRole: 'ADMIN',
      }),
    ).rejects.toThrow(UserAdminError)
  })

  it('⚠️ KULLANICI LİSTESİ ham e-posta göstermez', async () => {
    const page = await listUsers({}, { id: users.admin, role: 'ADMIN' })
    const raw = JSON.stringify(page.items)
    expect(raw).not.toContain('faz9-admin@roles.test')
    expect(raw).toContain('***@roles.test')
  })

  it('canEditRole: ADMIN kendine ve üstüne dokunamaz', () => {
    const admin = { id: users.admin, role: 'ADMIN' as const }
    expect(canEditRole(admin, { id: users.admin, role: 'ADMIN' })).toBe(false)
    expect(canEditRole(admin, { id: users.admin2, role: 'ADMIN' })).toBe(false)
    expect(canEditRole(admin, { id: users.super, role: 'SUPERADMIN' })).toBe(false)
    expect(canEditRole(admin, { id: users.customer, role: 'CUSTOMER' })).toBe(true)
  })
})

// ===========================================================================
describe('⭐ BİLDİRİM PANELİ', () => {
  it('başarısız bildirimler listelenir ve maskeli adres gösterir', async () => {
    await makeOrder('panel@ornek.test', 'panelhedef')

    const page = await listNotifications({ filter: 'failed' })
    expect(page.items.length).toBeGreaterThan(0)

    const row = page.items[0]!
    expect(row.recipientMasked).toMatch(/^\w{1,2}\*\*\*@/)
    expect(row.status).toBe('FAILED')

    const raw = JSON.stringify(page.items)
    expect(raw, 'panelde ham e-posta').not.toContain('panel@ornek.test')
  })

  it('⚠️ YENİDEN GÖNDERİM yalnızca ADMIN+', async () => {
    await makeOrder('yetki@ornek.test', 'yetkihedef')
    const n = await db.notification.findFirstOrThrow({ where: { status: 'FAILED' } })

    for (const role of ['CUSTOMER', 'SUPPORT', 'OPERATOR'] as const) {
      await expect(
        retryNotification(n.id, { userId: users.customer, role }),
      ).rejects.toThrow(/FORBIDDEN|yöneticiler/)
    }
  })

  it('⚠️ YENİDEN GÖNDERİM IDEMPOTENCY\'Yİ BOZMAZ (ikinci kayıt açılmaz)', async () => {
    const res = await makeOrder('retry@ornek.test', 'retryhedef')
    const before = await db.notification.findMany({ where: { orderId: res.order.id } })
    expect(before).toHaveLength(1)

    await retryNotification(before[0]!.id, { userId: users.admin, role: 'ADMIN' })

    const after = await db.notification.findMany({ where: { orderId: res.order.id } })
    expect(after, 'yeniden gönderim ikinci kayıt açtı').toHaveLength(1)
    // Deneme sayacı biriktirilir
    expect(after[0]!.attempts).toBeGreaterThan(before[0]!.attempts)
  })

  it('başarılı bildirim yeniden gönderilemez', async () => {
    const res = await makeOrder('sent@ornek.test', 'senthedef')
    const n = await db.notification.findFirstOrThrow({ where: { orderId: res.order.id } })
    await db.notification.update({ where: { id: n.id }, data: { status: 'SENT' } })

    await expect(
      retryNotification(n.id, { userId: users.admin, role: 'ADMIN' }),
    ).rejects.toThrow(/NOT_RETRYABLE|başarısız/)
  })

  it('⚠️ OPERASYON UYARILARI gerçek DB sayılarıdır', async () => {
    await makeOrder('uyari@ornek.test', 'uyarihedef')

    const alerts = await getOperationAlerts()
    const failed = await db.notification.count({ where: { status: 'FAILED' } })

    expect(alerts.failedNotifications).toBe(failed)
    expect(alerts.reviewRequired).toBe(
      await db.fulfillment.count({ where: { status: { in: ['REVIEW_REQUIRED', 'FAILED'] } } }),
    )
    // Garanti tanımsız varyantlar bir HATA değil, bir bilgidir
    expect(alerts.variantsWithoutGuarantee).toBeGreaterThanOrEqual(0)
  })

  it('⚠️ GARANTİ SÜRESİ TAHMİN EDİLMEZ: tanımsız varyantlar null kalır', async () => {
    const withGuarantee = await db.serviceVariant.count({
      where: { isActive: true, refillDays: { gt: 0 } },
    })
    const without = await db.serviceVariant.count({
      where: { isActive: true, OR: [{ refillDays: null }, { refillDays: 0 }] },
    })

    // Instagram Takipçi'de 365 gün tanımlı; başka ürünlerde tanım YOK.
    expect(withGuarantee).toBeGreaterThan(0)
    expect(without).toBeGreaterThan(0)

    const guessed = await db.serviceVariant.findMany({
      where: { isActive: true, refillDays: { gt: 0 } },
      select: { refillDays: true },
    })
    // Tanımlı olanların TAMAMI 365 — ara bir değer "tahmin edilmiş" olurdu.
    for (const v of guessed) {
      expect(v.refillDays, 'tahmin edilmiş garanti süresi').toBe(365)
    }
  })
})
