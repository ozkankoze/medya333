import 'server-only'

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'
import { db } from '@/server/db'
import { writeAudit } from '@/server/audit'

/**
 * MİSAFİR SİPARİŞİNİ HESABA BAĞLAMA (guest → account claim)
 *
 * ⚠️ YALNIZCA E-POSTA EŞLEŞMESİNE GÜVENİLMEZ.
 * Biri başkasının e-postasıyla kayıt olup o kişinin siparişlerini göremez.
 * İki koşuldan biri sağlanmalı:
 *   1. Kullanıcının e-postası DOĞRULANMIŞ (emailVerified dolu), veya
 *   2. E-postaya gönderilen tek kullanımlık claim token'ı ibraz edilmiş
 *
 * Token DB'de ham saklanmaz; HMAC hash'i tutulur ve tek kullanımlıktır.
 *
 * Gölge kullanıcı birleştirme:
 * `createOrder` misafir için e-posta bazlı upsert yaptığından, aynı e-posta
 * zaten TEK gölge kullanıcıya bağlıdır. Kişi kayıt olduğunda gölge kaydın
 * kendisi gerçek hesaba dönüşür — FK'ler değişmez, veri taşınmaz.
 */

const CLAIM_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 gün

export class ClaimError extends Error {
  constructor(
    readonly code: 'INVALID_TOKEN' | 'EMAIL_NOT_VERIFIED' | 'NOTHING_TO_CLAIM',
    message: string,
  ) {
    super(message)
    this.name = 'ClaimError'
  }
}

function hashToken(token: string): string {
  return createHmac('sha256', env.ORDER_TOKEN_SECRET).update(token).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** E-posta ile gönderilecek tek kullanımlık claim token'ı üretir. */
export async function issueClaimToken(userId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.guestClaimToken.create({
    data: {
      tokenHash: hashToken(token),
      email: email.trim().toLowerCase(),
      userId,
      expiresAt: new Date(Date.now() + CLAIM_TOKEN_TTL_MS),
    },
  })
  return token
}

export interface ClaimResult {
  claimedOrders: number
  method: 'verified_email' | 'claim_token'
}

/**
 * Devralmayı gerçekleştirir.
 *
 * Not: Aynı e-posta tek gölge kullanıcıya bağlı olduğu için çoğu durumda
 * "devralınacak" ayrı bir kullanıcı yoktur — gölge kayıt zaten kullanıcının
 * kendisidir ve yalnızca `isGuest` bayrağı düşürülür.
 */
export async function claimGuestOrders(input: {
  userId: string
  token?: string | null
  ipHash?: string | null
}): Promise<ClaimResult> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { id: true, email: true, emailVerified: true, isGuest: true },
  })

  let method: ClaimResult['method']

  if (input.token) {
    const hash = hashToken(input.token)
    const record = await db.guestClaimToken.findUnique({ where: { tokenHash: hash } })
    if (
      !record ||
      record.usedAt ||
      record.expiresAt < new Date() ||
      !safeEqual(record.email, user.email.toLowerCase())
    ) {
      throw new ClaimError('INVALID_TOKEN', 'Bağlantı geçersiz veya süresi dolmuş.')
    }
    await db.guestClaimToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
    method = 'claim_token'
  } else if (user.emailVerified) {
    method = 'verified_email'
  } else {
    throw new ClaimError(
      'EMAIL_NOT_VERIFIED',
      'Geçmiş siparişleri hesabınıza bağlamak için önce e-posta adresinizi doğrulayın.',
    )
  }

  const result = await db.$transaction(async (tx) => {
    // Gölge kaydı gerçek hesaba dönüştür
    if (user.isGuest) {
      await tx.user.update({
        where: { id: user.id },
        data: { isGuest: false, claimedAt: new Date() },
      })
    }

    // Aynı e-postaya bağlı BAŞKA gölge kullanıcılar varsa (eski veri) siparişleri taşı
    const otherShadows = await tx.user.findMany({
      where: { email: user.email, isGuest: true, id: { not: user.id } },
      select: { id: true },
    })
    let moved = 0
    for (const shadow of otherShadows) {
      const res = await tx.order.updateMany({
        where: { userId: shadow.id },
        data: { userId: user.id },
      })
      moved += res.count
    }

    const total = await tx.order.count({ where: { userId: user.id } })

    // Devralınan siparişlere olay yaz
    const orders = await tx.order.findMany({
      where: { userId: user.id, isGuestOrder: true },
      select: { id: true },
    })
    if (orders.length > 0) {
      await tx.orderEvent.createMany({
        data: orders.map((o) => ({
          orderId: o.id,
          type: 'GUEST_CLAIMED' as const,
          message: 'Sipariş hesaba bağlandı.',
          actorType: 'CUSTOMER',
          actorId: user.id,
          isCustomerVisible: false,
        })),
      })
    }

    return { total, moved }
  })

  await writeAudit({
    actorId: user.id,
    actorIpHash: input.ipHash ?? null,
    action: 'order.guest_claim',
    entityType: 'User',
    entityId: user.id,
    // PII yazılmaz — yalnızca yöntem ve sayı
    after: { method, claimedOrders: result.total, movedFromShadows: result.moved },
  })

  return { claimedOrders: result.total, method }
}
