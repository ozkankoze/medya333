-- Faz 10 — GEREKSİZ INDEX KALDIRILDI
--
-- `Order.idempotencyKey` hem `@unique` (UNIQUE index) hem de ayrı bir
-- `@@index` ile indexlenmişti. İki index AYNI sütunu AYNI sırada kapsar.
--
-- ÖLÇÜM: pg_stat_user_indexes çıktısında planlayıcı her zaman yalnızca
-- BİRİNİ seçiyordu. diğerinin idx_scan değeri 0'dı. Yani ikinci index hiçbir
-- okumayı hızlandırmıyor, yalnızca her INSERT/UPDATE'te güncellenmenin
-- maliyetini ve disk alanını ekliyordu.
--
-- UNIQUE index kaldırılamaz (kısıt onu gerektirir), bu yüzden fazlalık olan
-- düz index düşürülür. Geri alma: CREATE INDEX ... (aşağıdaki yorumda).
--
-- ⚠️ Bu işlem VERİ KAYBI ÜRETMEZ ve anında tamamlanır.
-- ⚠️ Geri almak için:
--    CREATE INDEX "Order_idempotencyKey_idx" ON "Order"("idempotencyKey")

DROP INDEX IF EXISTS "Order_idempotencyKey_idx";
