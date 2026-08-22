-- ============================================================================
--  FAZ 5 — GERÇEK KATALOG + FİYATLANDIRMA
--
--  TAMAMEN EKLEMELİ (additive) migration:
--    • hiçbir sütun düşürülmedi
--    • hiçbir tipin anlamı değiştirilmedi
--    • tüm yeni sütunların varsayılanı vardır → mevcut satırlar aynen geçerli
--
--  Order / Payment / Fulfillment tabloları YALNIZCA bir snapshot sütunuyla
--  genişletildi (`pricingMode`). mevcut siparişler FLAT_TIER olarak kalır.
-- ============================================================================

-- 1) Sabit paket fiyatlandırma modu -----------------------------------------
ALTER TYPE "PricingMode" ADD VALUE IF NOT EXISTS 'PACKAGE';

-- 2) PricingRule: sabit paket fiyatı ----------------------------------------
--    ⚠️ Gerçek satış fiyatı (örn. 324,90 ₺ = 32490 kuruş) BURADA durur.
--    Birim fiyata bölünmez: 32490 / 500 = 64,98 kuruş tam sayı değildir.
ALTER TABLE "PricingRule" ADD COLUMN IF NOT EXISTS "packagePriceMinor" INTEGER;

-- 3) ServiceVariant: açıklama, paket içeriği, preset kilidi -----------------
ALTER TABLE "ServiceVariant" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "ServiceVariant" ADD COLUMN IF NOT EXISTS "packageItems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ServiceVariant" ADD COLUMN IF NOT EXISTS "presetOnly" BOOLEAN NOT NULL DEFAULT false;

-- 4) Order: fiyat modeli snapshot'ı -----------------------------------------
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pricingMode" "PricingMode" NOT NULL DEFAULT 'FLAT_TIER';
