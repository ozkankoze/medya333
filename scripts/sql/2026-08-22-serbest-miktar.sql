-- ============================================================================
--  MEDYA 333 — SERBEST MİKTAR (SLIDER) İÇİN KATALOG DÖNÜŞÜMÜ
--
--  ⚠️ HİÇBİR FİYAT SABİTİ İÇERMEZ. Birim fiyat, veritabanındaki MEVCUT paket
--     fiyatından türetilir: ceil(paket / miktar). Yani bu script bir fiyat
--     listesi taşımaz; yanlış rakam yazma ihtimali YOKTUR.
--
--  ⚠️ SATIR SİLMEZ, SATIR EKLEMEZ. Yalnızca UPDATE yapar; PricingRule id'leri
--     değişmez, mevcut Order/OrderItem foreign key'leri bozulmaz.
--
--  ⚠️ `packagePriceMinor` DOKUNULMADAN KALIR. Yeni fiyat motorunda bu alan
--     ÇAPA TAVANI'dır: 500 takipçi her zaman tam 324,90 ₺ öder. Katalog
--     fiyatları birebir korunur.
--
--  Kapsam: `maxQuantity > 1` olan varyantlar (ölçülebilir hizmetler).
--  Sabit paketler (keşfet, aylık paket — maxQuantity = 1) DIŞARIDA kalır.
-- ============================================================================
BEGIN;

-- 1) PACKAGE kademeleri → FLAT_TIER bantları
WITH bands AS (
  SELECT r.id,
         ceil(r."packagePriceMinor"::numeric / r."minQuantity")::int AS unit,
         lead(r."minQuantity") OVER (
           PARTITION BY r."serviceVariantId" ORDER BY r."minQuantity"
         ) - 1 AS next_max
  FROM "PricingRule" r
  JOIN "ServiceVariant" v ON v.id = r."serviceVariantId"
  WHERE r."isActive" AND v."isActive" AND v."maxQuantity" > 1
    AND r.mode = 'PACKAGE' AND r."packagePriceMinor" IS NOT NULL
)
UPDATE "PricingRule" r
SET mode = 'FLAT_TIER',
    "unitPriceMinor" = b.unit,
    -- Son bant açık uçludur (NULL): varyantın tavanına kadar geçerli.
    "maxQuantity" = b.next_max,
    "updatedAt" = now()
FROM bands b
WHERE r.id = b.id;

-- 2) Varyantı serbest miktara aç
UPDATE "ServiceVariant"
SET "presetOnly" = false, "updatedAt" = now()
WHERE "isActive" AND "maxQuantity" > 1 AND "presetOnly";

COMMIT;

-- ============================================================================
--  DOĞRULAMA (uygulamadan ÖNCE ve SONRA çalıştırın)
--
--  Öncesi: kademe sayısı kadar `PACKAGE`, `presetOnly = t`
--  Sonrası: aynı sayıda `FLAT_TIER`, `presetOnly = f`, `capa` dolu
-- ============================================================================
-- SELECT p.slug platform, s.slug hizmet, v.slug varyant, v."presetOnly",
--        count(r.id) kademe, min(r.mode::text) mod,
--        count(r."packagePriceMinor") capa
-- FROM "ServiceVariant" v
-- JOIN "Service" s  ON s.id = v."serviceId"
-- JOIN "Platform" p ON p.id = s."platformId"
-- LEFT JOIN "PricingRule" r ON r."serviceVariantId" = v.id AND r."isActive"
-- WHERE v."isActive"
-- GROUP BY 1,2,3,4 ORDER BY mod, 1,2,3;

-- ============================================================================
--  ⚠️ UYGULAMADAN SONRA ÖNBELLEK DÜŞÜRÜLMELİDİR
--
--  Katalog snapshot'ı Redis'te ve Next cache'inde `CATALOG_REVALIDATE_SECONDS`
--  (300 sn) boyunca tutulur. SQL ile doğrudan yazmak `revalidateCatalog()`
--  tetiklemez; değişiklik 5 dakikaya kadar görünmeyebilir. Hızlandırmak için
--  yönetim panelinden herhangi bir katalog kaydını kaydedin (revalidate
--  tetiklenir) ya da Redis'teki katalog anahtarını düşürün.
--
--  ⚠️ BU DOSYA BİR PRISMA MIGRATION'I DEĞİLDİR ve olmamalıdır. Şema değil
--  VERİ değiştirir; migration klasörüne konursa her ortamda körlemesine
--  çalışır. Katalog verisi PRODUCTION_RUNBOOK § 6'ya göre elle yönetilir.
--
--  DOĞRULANDI (2026-08-22): Bu script, doğru seed'lenmiş bir veritabanı
--  "eski hâle" (PACKAGE + presetOnly) döndürülüp üzerine çalıştırıldığında
--  183 kademenin tamamını BİREBİR seed durumuna geri getirdi. İki kez
--  çalıştırmak güvenlidir (idempotent).
-- ============================================================================
