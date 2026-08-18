-- FAZ 3 — ÖDEME ALTYAPISI
--
-- Elle yazıldı: @prisma/schema-engine-wasm bu ortamda mevcut veritabanını
-- tarif ederken "Column type 'char' could not be deserialized" hatası veriyor
-- (bkz. Faz 1 notları). Değişikliklerin TAMAMI eklemelidir — hiçbir sütun
-- düşürülmez, hiçbir tip yeniden yaratılmaz, veri kaybı riski yoktur.

-- 1) PaymentStatus'e genel bekleme durumu: 3DS dışı sağlayıcı beklemeleri
--    (PayTR iframe açıldı, sonuç bekleniyor) için PENDING_3DS yanlış isimdi.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING' AFTER 'INITIATED';

-- 2) Payment: deneme numarası, snapshot alanları, ortam ve checkout bilgisi
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "attemptNumber"     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "orderNoSnapshot"   TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "environment"       TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "checkoutUrl"       TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "checkoutToken"     TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "checkoutExpiresAt" TIMESTAMP(3);

-- Aynı siparişe aynı deneme numarasıyla ikinci kayıt açılamaz.
-- Çift tıklama / yarış durumunda ikinci INSERT veritabanı seviyesinde düşer.
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_orderId_attemptNumber_key"
  ON "Payment"("orderId", "attemptNumber");

-- 3) Refund: idempotency ve sağlayıcı sonucu
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "providerStatus"  TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "failureMessage"  TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "idempotencyKey"  TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_idempotencyKey_key"
  ON "Refund"("idempotencyKey");
