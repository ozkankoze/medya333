import 'server-only'

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'

/**
 * SİPARİŞ NUMARASI
 *
 * Biçim: M333-XXXXXXXX  (Crockford Base32 — I, L, O, U çıkarılmış)
 * Örnek: M333-7F4K2P9X
 *
 * SIRALI DEĞİL — sequential integer ID kullanıcıya HİÇBİR yerde gösterilmez.
 * Misafir sorgusu (sipariş no + e-posta) doğrudan sipariş döndürdüğü için
 * numara tahmin edilemez olmalı: 8 karakter × 32 alfabe = 2^40 olasılık.
 * Rate limit (5/saat/IP) + e-posta eşleşme zorunluluğu ile kaba kuvvet
 * pratikte imkânsız (order enumeration koruması).
 *
 * `randomBytes` modulo bias'ı: 256 % 32 == 0 olduğu için bias YOKTUR.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // I, L, O, U yok
const ORDER_NO_LENGTH = 8

export function generateOrderNo(): string {
  const bytes = randomBytes(ORDER_NO_LENGTH)
  let out = ''
  for (let i = 0; i < ORDER_NO_LENGTH; i++) out += ALPHABET[bytes[i]! % ALPHABET.length]
  return `M333-${out}`
}

export const ORDER_NO_REGEX = /^M333-[0-9A-HJKMNP-TV-Z]{8}$/

export function normalizeOrderNo(input: string): string {
  return input.trim().toUpperCase().replace(/\s/g, '')
}

export function isValidOrderNo(input: string): boolean {
  return ORDER_NO_REGEX.test(normalizeOrderNo(input))
}

// ---------------------------------------------------------------------------
// Misafir takip token'ı
// ---------------------------------------------------------------------------

/**
 * İmzalı takip linki üretir. Token'ın KENDİSİ e-postayla gönderilir,
 * veritabanında yalnızca HASH'İ saklanır — DB sızıntısı takip linklerini
 * kullanılabilir hale getirmez.
 */
export function createAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashAccessToken(token) }
}

export function hashAccessToken(token: string): string {
  return createHmac('sha256', env.ORDER_TOKEN_SECRET).update(token).digest('hex')
}

/** Sabit süreli karşılaştırma — zamanlama saldırısına kapalı. */
export function verifyAccessToken(token: string, storedHash: string): boolean {
  const computed = Buffer.from(hashAccessToken(token))
  const stored = Buffer.from(storedHash)
  if (computed.length !== stored.length) return false
  return timingSafeEqual(computed, stored)
}

/** E-posta karşılaştırması da sabit sürede yapılır (misafir sorgusu). */
export function safeEmailEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a.trim().toLowerCase())
  const bufB = Buffer.from(b.trim().toLowerCase())
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
