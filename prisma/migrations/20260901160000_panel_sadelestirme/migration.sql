-- ⭐ PANEL SADELEŞTİRME
--
-- İki ekleme yapar:
--   1) ManualOrder."dueDate" — siparişin BEKLENEN ödeme günü
--   2) CashCategory.DUZELTME — elle bakiye düzeltmesi için ayrı kategori
--
-- ⚠️⚠️ "dueDate" NEDEN AYRI BİR ALACAK KAYDI DEĞİL?
--
-- İlk tasarım, ödeme tarihi yazılan her sipariş için ayrıca bir "Receivable"
-- satırı açıyordu. Bu, TEK BİR SATIŞI İKİ KAYDA bölerdi: alacak tahsil
-- edilince kasaya satış geliri yazılır, ama siparişin kendi "paidAt" alanı
-- boş kalırdı. Sipariş defteri o işi sonsuza dek "ödenmedi" gösterirken
-- para kasada duruyor olurdu ve iki ekran birbirini yalanlardı.
--
-- Beklenen tarih siparişin KENDİ alanı olunca tek kayıt kalır: tarih
-- yazılır, ana sayfada alacak olarak görünür, para gelince aynı satır
-- tahsil edilir ve listeden düşer.

ALTER TABLE "ManualOrder" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

-- ⚠️ KISMİ İNDEKS: ana sayfadaki alacak listesi yalnızca ÖDENMEMİŞ ve
--    tarihi olan satırları okur. Tam indeks, tahsil edilmiş binlerce
--    geçmiş siparişi de taşıyıp boşuna büyürdü.
CREATE INDEX IF NOT EXISTS "ManualOrder_alacak_idx"
  ON "ManualOrder" ("dueDate")
  WHERE "paidAt" IS NULL AND "dueDate" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ⚠️ DÜZELTME KATEGORİSİ AYRI OLMALI.
--
-- "DIGER" kullanmak kolay olurdu ama elle yapılan bakiye düzeltmeleri o
-- kutuya girince gerçek "diğer" harcamalarla karışırdı. Sonra "bu ay 3.000
-- TL diğer gider var" diye bakan biri, aslında bir sayım farkına baktığını
-- anlayamazdı. Kâr hesabı bu kategoriyi kâra KATMAZ.
-- ⚠️ TEK İFADE, "DO" BLOĞU YOK. Projenin migration çalıştırıcısı SQL'i
--    noktalı virgülden bölüyor. Bir "DO" bloğunun içindeki noktalı
--    virgüller bu bölmeyi kırardı. "IF NOT EXISTS" zaten tekrar
--    çalıştırılabilirliği sağlıyor.
ALTER TYPE "CashCategory" ADD VALUE IF NOT EXISTS 'DUZELTME';
