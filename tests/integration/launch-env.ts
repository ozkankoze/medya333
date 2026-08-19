/**
 * ⚠️ BU MODÜL, TEST DOSYASININ İLK `import`'U OLMAK ZORUNDADIR.
 *
 * Neden ayrı bir dosya?
 *
 * ESM'de `import` ifadeleri, dosyanın en üstünde yazılmış olsalar bile TÜM
 * top-level atamalardan ÖNCE değerlendirilir. Yani şu sıralama YANILTICIDIR:
 *
 *     process.env.APP_BASE_URL = 'https://www.medya333.com'   // 2. çalışır
 *     import { appBaseUrl } from '@/server/base-url'           // 1. çalışır
 *
 * `@t3-oss/env-nextjs` ortamı modül yüklenirken bir kez okuyup dondurur;
 * atama geç kaldığı için hiçbir etkisi olmaz ve test, `.env`'deki geliştirme
 * adresini görür. Bu tuzak sessizdir: test "localhost bekliyordum, localhost
 * geldi" diye GEÇEBİLİR de — yani yanlış bir güven verir.
 *
 * Ayrı bir modül olarak İLK sırada import edilince, atamalar `@/env` zinciri
 * yüklenmeden önce çalışır.
 */

/** ⭐ CANLI ALAN ADI — bağlantıların bundan üretildiğini kanıtlamak için. */
process.env.APP_BASE_URL = 'https://www.medya333.com'
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.medya333.com'

process.env.DEFAULT_TAX_RATE_BP = '2000'
process.env.IP_HASH_SALT = 'test-salt-test-salt-test'
process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.ORDER_TOKEN_SECRET = 'test-token-secret-test-token-secret-0123'
process.env.PAYMENT_PROVIDER = 'mock'
process.env.PAYMENT_ENVIRONMENT = 'sandbox'

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://medya333:medya333@127.0.0.1:5432/medya333_test?schema=public'

// Rate limit testleri bellek-içi yedeği kullanır.
delete process.env.REDIS_URL

export {}
