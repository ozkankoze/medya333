-- Faz 2 — Sipariş oluşturma + misafir takibi
--
-- NOT: OrderStatus'taki AWAITING_PAYMENT → PENDING_PAYMENT ve
-- PAYMENT_RECEIVED → PAID YENİDEN ADLANDIRMADIR, silme+ekleme değil.
-- Prisma otomatik diff'i yeniden adlandırmayı algılayamaz ve enum'u
-- düşürüp yeniden yaratarak MEVCUT SİPARİŞ DURUMLARINI KAYBEDERDİ.
-- Bu yüzden dönüşüm CASE ile açıkça yazıldı: veri korunur.

-- ---------------------------------------------------------------------------
-- 1) OrderStatus: DRAFT eklendi, iki değer yeniden adlandırıldı
-- ---------------------------------------------------------------------------
CREATE TYPE "OrderStatus_new" AS ENUM (
  'DRAFT', 'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'STARTED',
  'IN_PROGRESS', 'PARTIAL', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED'
);

ALTER TABLE "Order"     ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "OrderItem" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING (
  CASE "status"::text
    WHEN 'AWAITING_PAYMENT' THEN 'PENDING_PAYMENT'
    WHEN 'PAYMENT_RECEIVED' THEN 'PAID'
    ELSE "status"::text
  END
)::"OrderStatus_new";

ALTER TABLE "OrderItem" ALTER COLUMN "status" TYPE "OrderStatus_new" USING (
  CASE "status"::text
    WHEN 'AWAITING_PAYMENT' THEN 'PENDING_PAYMENT'
    WHEN 'PAYMENT_RECEIVED' THEN 'PAID'
    ELSE "status"::text
  END
)::"OrderStatus_new";

ALTER TABLE "OrderEvent" ALTER COLUMN "fromStatus" TYPE "OrderStatus_new" USING (
  CASE "fromStatus"::text
    WHEN 'AWAITING_PAYMENT' THEN 'PENDING_PAYMENT'
    WHEN 'PAYMENT_RECEIVED' THEN 'PAID'
    ELSE "fromStatus"::text
  END
)::"OrderStatus_new";

ALTER TABLE "OrderEvent" ALTER COLUMN "toStatus" TYPE "OrderStatus_new" USING (
  CASE "toStatus"::text
    WHEN 'AWAITING_PAYMENT' THEN 'PENDING_PAYMENT'
    WHEN 'PAYMENT_RECEIVED' THEN 'PAID'
    ELSE "toStatus"::text
  END
)::"OrderStatus_new";

DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";

ALTER TABLE "Order"     ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "OrderItem" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- ---------------------------------------------------------------------------
-- 2) OrderEventType: Faz 2 olayları
-- ---------------------------------------------------------------------------
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'PRICE_CHANGED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'CUSTOMER_INFO_ADDED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'CONSENT_ACCEPTED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'GUEST_CLAIMED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'TRACKING_LINK_SENT';

-- ---------------------------------------------------------------------------
-- 3) Order: müşteri bilgileri, idempotency, sözleşme onay snapshot'ı
-- ---------------------------------------------------------------------------
ALTER TABLE "Order"
  ADD COLUMN "customerFirstName"     TEXT,
  ADD COLUMN "customerLastName"      TEXT,
  ADD COLUMN "customerEmail"         TEXT,
  ADD COLUMN "customerPhone"         TEXT,
  ADD COLUMN "idempotencyKey"        TEXT,
  ADD COLUMN "requestHash"           TEXT,
  ADD COLUMN "consentAcceptedAt"     TIMESTAMP(3),
  ADD COLUMN "consentTermsVersion"   TEXT,
  ADD COLUMN "consentRefundVersion"  TEXT,
  ADD COLUMN "consentPrivacyVersion" TEXT,
  ADD COLUMN "consentSnapshot"       JSONB;

-- Çift sipariş koruması VERİTABANI SEVİYESİNDE garanti altına alınır.
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX "Order_customerEmail_idx"        ON "Order"("customerEmail");
CREATE INDEX "Order_idempotencyKey_idx"       ON "Order"("idempotencyKey");

-- ---------------------------------------------------------------------------
-- 4) GuestClaimToken — misafir siparişini hesaba bağlama
--    Token'ın kendisi değil, HMAC hash'i saklanır.
-- ---------------------------------------------------------------------------
CREATE TABLE "GuestClaimToken" (
  "id"        TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestClaimToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestClaimToken_tokenHash_key" ON "GuestClaimToken"("tokenHash");
CREATE INDEX "GuestClaimToken_email_idx"  ON "GuestClaimToken"("email");
CREATE INDEX "GuestClaimToken_userId_idx" ON "GuestClaimToken"("userId");

ALTER TABLE "GuestClaimToken"
  ADD CONSTRAINT "GuestClaimToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
