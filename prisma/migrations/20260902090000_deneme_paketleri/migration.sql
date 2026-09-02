-- ⭐ DENEME PAKETLERİ
--
-- ⚠️⚠️ NEDEN AYRI TABLO DEĞİL?
--
-- Deneme paketi, süresi ve fiyatı dışında normal paketten farklı bir şey
-- değil. Aynı müşteri, aynı hizmet, aynı tahsilat, aynı maliyet, aynı
-- düzenleme kuralları. Ayrı bir tablo açmak, tahsilat akışını ve tutar
-- dondurma tetikleyicilerini, silme korumalarını ve düzenleme uçlarını
-- İKİNCİ KEZ yazmak demekti. İki kopya er geç ayrışır: birinde düzeltilen
-- bir kusur diğerinde yaşamaya devam eder.
--
-- Tek bir bayrak, bütün o korumaları olduğu gibi devralır.
--
-- ⚠️ NOT NULL DEFAULT false: mevcut satırların hepsi normal pakettir.
ALTER TABLE "ServicePackage"
  ADD COLUMN IF NOT EXISTS "isTrial" BOOLEAN NOT NULL DEFAULT false;

-- ⚠️ KISMİ İNDEKS: deneme paketleri toplamın küçük bir azınlığı olacak.
--    Tam indeks, binlerce normal paketi de taşıyıp boşuna büyürdü.
CREATE INDEX IF NOT EXISTS "ServicePackage_deneme_idx"
  ON "ServicePackage" ("startDate")
  WHERE "isTrial" = true;
