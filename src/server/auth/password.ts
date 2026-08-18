import 'server-only'

import { hash, verify } from '@node-rs/argon2'

/**
 * Şifre hash'leme — argon2id (bcrypt DEĞİL).
 * Parametreler OWASP 2024+ önerisi: 19 MiB bellek, 2 tur, 1 paralellik.
 */
const ARGON2_OPTS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/** Kolayca tahmin edilen şifreler için asgari kontrol. */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'parola123', 'qwerty123',
  'admin123', '11111111', 'medya333', 'sifre123', 'password1', 'iloveyou',
])

export interface PasswordCheck {
  ok: boolean
  reason?: string
}

export function checkPasswordStrength(password: string): PasswordCheck {
  if (password.length < 10) return { ok: false, reason: 'Şifre en az 10 karakter olmalıdır.' }
  if (password.length > 200) return { ok: false, reason: 'Şifre çok uzun.' }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: 'Bu şifre çok yaygın. Lütfen farklı bir şifre seçin.' }
  }
  if (!/[a-zA-ZğüşıöçĞÜŞİÖÇ]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: 'Şifre en az bir harf ve bir rakam içermelidir.' }
  }
  return { ok: true }
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

/**
 * Kullanıcı numaralandırmasını engellemek için: e-posta bulunamadığında da
 * hash doğrulaması yapılmış kadar zaman harcanır.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$7Ff8p1zJ0f6xg0hZ4x1Y3fF9r8sQ2mN5tR7kL0aB1cE'

export async function fakeVerifyDelay(): Promise<void> {
  await verify(DUMMY_HASH, 'dummy-password-for-timing').catch(() => false)
}
