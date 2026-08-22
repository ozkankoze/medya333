-- ============================================================================
--  GERİ ALMA — serbest miktar dönüşümünü ESKİ HÂLE (hazır paket) döndürür
--
--  `2026-08-22-serbest-miktar.sql` uygulandıktan sonra bir sorun görülürse
--  bu script katalogu paket kartlarına geri çevirir.
--
--  ⚠️ FİYATLAR YİNE KORUNUR. `packagePriceMinor` hiç değişmediği için paket
--     fiyatları olduğu gibi geri gelir; bu script de satır silmez/eklemez.
--
--  DOĞRULANDI (2026-08-22): ileri script → bu script → ileri script döngüsü
--  183 kademenin tamamını birebir aynı bıraktı.
-- ============================================================================
BEGIN;

-- 1) FLAT_TIER bantları → tek miktara kilitli PACKAGE kademeleri
UPDATE "PricingRule" r
SET mode = 'PACKAGE',
    "unitPriceMinor" = 0,
    "maxQuantity" = r."minQuantity",
    "updatedAt" = now()
FROM "ServiceVariant" v
WHERE r."serviceVariantId" = v.id
  AND r."isActive" AND v."isActive"
  AND v."maxQuantity" > 1
  AND r.mode = 'FLAT_TIER';

-- 2) Varyantı yeniden hazır miktarlara kilitle
UPDATE "ServiceVariant"
SET "presetOnly" = true, "updatedAt" = now()
WHERE "isActive" AND "maxQuantity" > 1 AND NOT "presetOnly";

COMMIT;

-- ⚠️ Bundan sonra da önbellek düşürülmelidir (bkz. ileri scriptin sonu).
