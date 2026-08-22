-- ============================================================================
--  MEDYA 333 — FACEBOOK ve TIKTOK'ta "TÜRK TAKİPÇİ" VARYANTINI KAPAT
--
--  Bu iki platformda Türk takipçi tedarik edilemiyor; satın alınabilir bir
--  seçenek olarak durması teslim edilemeyecek bir söz demektir.
--
--  ⚠️ SİLMEZ, PASİFLEŞTİRİR. `isActive = false` yapılır; satırlar durur.
--     Bu varyanttan verilmiş GEÇMİŞ SİPARİŞLER kırılmaz — sipariş kayıtları
--     hâlâ kendi varyantına ve fiyat kuralına bakabilir. (Seed'in
--     `deactivateStaleCatalog` fonksiyonu da tam olarak bunu yapar.)
--
--  ⚠️ INSTAGRAM'A DOKUNMAZ. Instagram'ın kendi `takipci/turk` varyantı
--     satılmaya devam eder; filtre platform bazlıdır.
--
--  ⚠️ SIRA ÖNEMLİ: bu script `2026-08-22-serbest-miktar.sql` dosyasından
--     ÖNCE çalıştırılmalıdır. Aksi hâlde kapatılacak varyantlar da önce
--     slider'a çevrilir ve arada bir süre satışa açık kalır.
-- ============================================================================
BEGIN;

-- 1) Varyantın fiyat kurallarını pasifleştir
UPDATE "PricingRule" r
SET "isActive" = false, "updatedAt" = now()
FROM "ServiceVariant" v
JOIN "Service" s  ON s.id = v."serviceId"
JOIN "Platform" p ON p.id = s."platformId"
WHERE r."serviceVariantId" = v.id
  AND r."isActive"
  AND p.slug IN ('facebook', 'tiktok')
  AND s.slug = 'takipci'
  AND v.slug = 'turk';

-- 2) Varyantı katalogdan kaldır
--    ⚠️ `isDefault` da düşürülür: pasif bir varyant varsayılan kalırsa
--    sihirbaz açılışta seçilemeyen bir seçeneği işaretlemeye çalışır.
UPDATE "ServiceVariant" v
SET "isActive" = false, "isDefault" = false, "updatedAt" = now()
FROM "Service" s, "Platform" p
WHERE v."serviceId" = s.id AND s."platformId" = p.id
  AND p.slug IN ('facebook', 'tiktok')
  AND s.slug = 'takipci'
  AND v.slug = 'turk';

COMMIT;

-- ============================================================================
--  BEKLENEN SONUÇ: kontrol sorgusu 29 satır yerine 27 satır döndürür.
--  Facebook ve TikTok'un `takipci / turk` satırları listeden çıkar,
--  `takipci / yabanci` satırları KALIR.
--
--  ⚠️ Sonrasında önbellek düşürülmelidir (bkz. serbest-miktar scriptinin sonu).
--
--  DOĞRULANDI (2026-08-22): canlıya birebir benzeyen bir kopyada
--  (29 varyant, hepsi PACKAGE + presetOnly) bu script → serbest-miktar
--  scripti sırasıyla çalıştırıldı; sonuç, seed'in ürettiği duruma
--  BİREBİR eşit çıktı (27 varyant, 183 kademe).
-- ============================================================================
