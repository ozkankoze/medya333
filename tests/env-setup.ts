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

/**
 * ⚠️ SON ÇARE ADRESİ — `.env` hiç yoksa veya `DATABASE_URL` içermiyorsa.
 *
 * `src/env.ts` içinde `DATABASE_URL` ZORUNLUDUR (`z.string().url()`). Aşağıdaki
 * `??=` satırları yazılırken bu alan atlanmıştı ve boşluk uzun süre GÖRÜNMEDİ:
 * geliştirme makinelerinde `.env` zaten dolu olduğu için `dotenv` değeri
 * sağlıyordu. `.env`'i yalnızca birkaç anahtar için oluşturan bir makinede ise
 * `env.ts`'i IMPORT EDEN HER test dosyası import anında patlıyor —
 * `client-ip`, `notifications`, `mail-contract`, `payment-*` dahil. Yani bu bir
 * Instagram sorunu değil, test kurulumundaki bir boşluktu.
 *
 * ⚠️ BU ADRESE BAĞLANILMAZ. Yalnızca Zod'un biçim doğrulamasını geçmek için
 *    vardır; birim testleri veritabanına hiç dokunmaz.
 *
 * ⚠️ GERÇEK BİR VERİTABANINA İŞARET ETMEMESİ BİLİNÇLİDİR. Yukarıdaki güvenlik
 *    kuralı ("testler geliştirme veritabanına yazamasın") burada da geçerli:
 *    adres kasıtlı olarak var olmayan bir sunucu/veritabanıdır. Entegrasyon
 *    testleri bu değeri KULLANMAZ — `tests/integration/db-setup.ts` kararını
 *    `TEST_DATABASE_URL`'e bakarak verir ve yoksa Testcontainers ile ayağa
 *    kaldırdığı konteynerin adresini `DATABASE_URL`'e kendisi yazar.
 */
process.env.DATABASE_URL ??=
  'postgresql://vitest:vitest@127.0.0.1:1/medya333_vitest_placeholder?schema=public'

// Zod doğrulaması boot'ta çalışır; testlerde eksik anahtar olmasın.
process.env.AUTH_SECRET ??= 'test-only-auth-secret-at-least-32-characters-long'
process.env.ORDER_TOKEN_SECRET ??= 'test-only-order-token-secret-at-least-32-chars'
process.env.IP_HASH_SALT ??= 'test-only-ip-hash-salt'
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000'
process.env.DEFAULT_TAX_RATE_BP ??= '2000'

/**
 * ⭐ SORGU SAYACI (Faz 10)
 *
 * N+1 testleri bir işlemin kaç SQL sorgusu ürettiğini SAYAR. Sayaç
 * `src/server/db.ts` içinde bu değişkenle açılır ve yalnızca ARTAR —
 * sorgu metni ve parametreler hiçbir yerde tutulmaz.
 */
process.env.PRISMA_QUERY_METRICS ??= '1'
