-- ============================================================================
--  FAZ 8 — BİLDİRİM KAYDI
--
--  ⚠️ TAMAMEN EKLEMELİ (additive). Hiçbir tablo/kolon düşürülmez, hiçbir
--  mevcut satır değiştirilmez. Geri alınması gerekirse yalnızca bu tablo ve
--  iki enum düşürülür. başka hiçbir veri etkilenmez.
--
--  Prisma'nın WASM şema motoru bu ortamda diff üretemediği için migration
--  ELLE yazılmıştır (bkz. README → "Kısıtlı ağlarda migration").
-- ============================================================================

-- --- Enumlar ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationChannel') THEN
    CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationStatus') THEN
    CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
  END IF;
END
$$;

-- --- Tablo ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"                TEXT NOT NULL,
  "orderId"           TEXT NOT NULL,
  "orderEventId"      TEXT NOT NULL,
  "channel"           "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
  "template"          TEXT NOT NULL,
  "status"            "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  -- ⚠️ Maskeli adres. Ham e-posta buraya YAZILMAZ.
  "recipientMasked"   TEXT NOT NULL,
  "failureReason"     TEXT,
  "providerMessageId" TEXT,
  "provider"          TEXT NOT NULL DEFAULT 'none',
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"            TIMESTAMP(3),

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- ⚠️ IDEMPOTENCY BURADA. Aynı OrderEvent için aynı kanaldan ikinci bir
-- bildirim VERİTABANI SEVİYESİNDE imkânsızdır — uygulama mantığına
-- güvenilmez, yarış koşulunda bile ikinci satır açılamaz.
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_orderEventId_channel_key"
  ON "Notification" ("orderEventId", "channel");

CREATE INDEX IF NOT EXISTS "Notification_orderId_createdAt_idx"
  ON "Notification" ("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_status_createdAt_idx"
  ON "Notification" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_template_createdAt_idx"
  ON "Notification" ("template", "createdAt");

-- --- Yabancı anahtarlar -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_orderId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_orderEventId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_orderEventId_fkey"
      FOREIGN KEY ("orderEventId") REFERENCES "OrderEvent"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- --- OrderEventType genişletmesi -------------------------------------------
-- ⚠️ Yalnızca DEĞER EKLER. Mevcut değerler ve satırlar dokunulmadan kalır.
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'REPLACEMENT_APPROVED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'REPLACEMENT_COMPLETED';
