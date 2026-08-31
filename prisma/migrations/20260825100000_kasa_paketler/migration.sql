-- AYLIK MÜŞTERİ PAKETLERİ
--
-- Salt EKLEMELİ. Mevcut hiçbir tabloya veya veriye dokunmaz.
--
-- ⚠️ BU BİR ABONELİK SİSTEMİ DEĞİLDİR. Otomatik yenileme, otomatik
-- tahakkuk ve zamanlanmış iş YOKTUR. Süresi dolan paket yalnızca öyle
-- GÖSTERİLİR, yeni kayıt üretilmez.
--
-- ⚠️ "DURUM" SÜTUNU YOKTUR ve eklenmemelidir. aktif / süresi doldu
-- tarihlerden türetilir. Saklansaydı bayatlardı, çünkü onu gece yarısı
-- çevirecek bir iş yok. Tek istisna "canceledAt" -- o bir karardır.
--
-- ⚠️ "NET KAR" SÜTUNU DA YOKTUR. salePriceMinor - costMinor ile
-- hesaplanır. Saklansaydı satış veya maliyet düzeltildiğinde
-- güncellenmeyi unutabilir ve üç alan birbiriyle çelişirdi.

CREATE TABLE IF NOT EXISTS "ServicePackage" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "salePriceMinor" INTEGER NOT NULL,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    -- Ödeme ALINDIĞINDA dolar. Ayrı bir "isPaid" bayrağı YOKTUR, çünkü
    -- bayrak ile tarih er geç ayrışır.
    "paidAt" TIMESTAMP(3),
    -- Paket açılınca banka bakiyesi ARTMAZ. Gelir hareketi yalnızca
    -- "tahsil edildi" işleminde oluşur ve buraya bağlanır.
    "paymentEntryId" TEXT,
    "costEntryId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id")
);

-- ⚠️ KISITLAR VERİTABANINDA DA VAR. Uygulama katmanı atlanabilir, parayı
-- bozan bir satırın veritabanına girmesi ise geri alınamaz.

-- Satış negatif olamaz. Sıfıra izin var, çünkü bedelsiz deneme paketi
-- meşru bir durumdur.
DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_sale_nonnegative" CHECK ("salePriceMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_cost_nonnegative" CHECK ("costMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ⚠️ BİTİŞ, BAŞLANGIÇTAN ÖNCE OLAMAZ. Ters aralık, durum türetimini
-- anlamsızlaştırır: paket hem başlamamış hem bitmiş görünürdü.
DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_date_order" CHECK ("endDate" >= "startDate");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ⚠️ BİR HAREKET EN FAZLA BİR PAKETE BAĞLANIR.
-- Aksi hâlde tek bir tahsilat iki paketi birden "ödendi" gösterebilir ve
-- aynı para iki kez sayılırdı.
CREATE UNIQUE INDEX IF NOT EXISTS "ServicePackage_paymentEntryId_key"
    ON "ServicePackage" ("paymentEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "ServicePackage_costEntryId_key"
    ON "ServicePackage" ("costEntryId");

-- ⚠️ HAREKET SİLİNİRSE BAĞ KOPAR, PAKET SİLİNMEZ (SET NULL).
-- CASCADE olsaydı bir kasa hareketini silmek müşteri paketini de silerdi.
DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_paymentEntryId_fkey"
        FOREIGN KEY ("paymentEntryId") REFERENCES "CashEntry"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_costEntryId_fkey"
        FOREIGN KEY ("costEntryId") REFERENCES "CashEntry"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ServicePackage_customerName_idx"
    ON "ServicePackage" ("customerName");
CREATE INDEX IF NOT EXISTS "ServicePackage_startDate_idx"
    ON "ServicePackage" ("startDate");
CREATE INDEX IF NOT EXISTS "ServicePackage_endDate_canceledAt_idx"
    ON "ServicePackage" ("endDate", "canceledAt");
