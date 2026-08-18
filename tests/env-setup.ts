/**
 * TEST ORTAM DEĞİŞKENLERİ
 *
 * Vitest her test dosyasından ÖNCE bunu çalıştırır (pool: 'forks').
 *
 * Amaç iki tane:
 *   1. `.env` yüklenir → `TEST_DATABASE_URL` ve `REDIS_URL` elde edilir.
 *   2. ⚠️ GÜVENLİK: `DATABASE_URL` her zaman TEST veritabanına çevrilir.
 *      Böylece bir test yanlışlıkla geliştirme veritabanına yazamaz —
 *      `truncateTransactional` gerçek veriyi silemez.
 *
 * `TEST_DATABASE_URL` yoksa hiçbir şey zorlanmaz: entegrasyon testleri
 * Testcontainers yoluna düşer (CI'daki standart yol).
 */

import { config } from 'dotenv'

config({ quiet: true })

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}

// Zod doğrulaması boot'ta çalışır; testlerde eksik anahtar olmasın.
process.env.AUTH_SECRET ??= 'test-only-auth-secret-at-least-32-characters-long'
process.env.ORDER_TOKEN_SECRET ??= 'test-only-order-token-secret-at-least-32-chars'
process.env.IP_HASH_SALT ??= 'test-only-ip-hash-salt'
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000'
process.env.DEFAULT_TAX_RATE_BP ??= '2000'
