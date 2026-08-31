-- SİPARİŞ DEFTERİNE "SİPARİŞ İÇERİĞİ" ALANI
--
-- Defterde siparişin NE OLDUĞUNU yazan bir alan yoktu. Kullanıcı adı, tutar
-- ve tarih vardı ama "Instagram 10K Türk takipçi" mi yoksa "Web site
-- tasarımı" mı olduğu hiçbir yerde durmuyordu. Birkaç hafta sonra defter
-- okunamaz hâle gelirdi: aynı müşteriye aynı gün girilen iki satır
-- birbirinden ayırt edilemezdi.
--
-- ⚠️ ALAN ZORUNLUDUR (NOT NULL + boş dize yasak). İsteğe bağlı olsaydı
-- pratikte çoğu satır boş kalır ve alan hiç eklenmemiş gibi olurdu.
--
-- ⚠️ ÜÇ ADIMLI EKLEME — DOĞRUDAN "NOT NULL" DEĞİL.
-- Tabloda kayıt varsa doğrudan NOT NULL eklemek migration'ı düşürür. Adımlar:
--   1) Sütun NULL kabul ederek eklenir
--   2) Eski satırlar AÇIK bir yer tutucuyla doldurulur
--   3) NOT NULL ve boşluk yasağı sonra konur
--
-- ⚠️ YER TUTUCU BOŞ DİZE DEĞİL, OKUNABİLİR BİR METİNDİR. Boş dize
-- konsaydı ekranda hiçbir şey görünmez ve kullanıcı "içerik girmiş ama
-- kaybolmuş" sanırdı. Açık metin, o satırın alan eklenmeden ÖNCE girildiğini
-- söyler.

ALTER TABLE "ManualOrder" ADD COLUMN IF NOT EXISTS "description" TEXT;

UPDATE "ManualOrder"
SET "description" = '(alan eklenmeden önce girildi)'
WHERE "description" IS NULL OR btrim("description") = '';

ALTER TABLE "ManualOrder" ALTER COLUMN "description" SET NOT NULL;

-- ⚠️ NOT NULL TEK BAŞINA YETMEZ: boş dize de "null değil"dir. Zorunluluk,
-- boşluktan ibaret bir değerin de reddedilmesi demektir.
DO $$ BEGIN
    ALTER TABLE "ManualOrder"
        ADD CONSTRAINT "ManualOrder_description_notblank" CHECK (btrim("description") <> '');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
