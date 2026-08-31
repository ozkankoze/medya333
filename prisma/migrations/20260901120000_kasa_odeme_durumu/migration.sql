-- KASA — "ÖDEME YAPILDI / YAPILMADI"
--
-- "Hareket ekle" formuna ödeme durumu istendi. Doğrudan `CashEntry`e bir
-- "ödendi mi" bayrağı koymak ilk akla gelen çözümdü ve TEHLİKELİ olurdu:
-- o tablodaki her satır tanımı gereği GERÇEKLEŞMİŞ bir para hareketidir.
-- "Ödenmedi" işaretli satırların bakiyeye girmemesi gerekirdi, yani
-- bakiyeyi hesaplayan HER sorguya bir filtre eklemek zorunda kalırdık ve
-- birinde unutulduğunda bakiye sessizce yanlış olurdu.
--
-- ⚠️ ÇÖZÜM: FORMDA KUTU VAR, VERİ DOĞRU TABLOYA GİDİYOR.
-- Kutu işaretli değilse hiç `CashEntry` yazılmaz. Yön giriş ise `Receivable`
-- (alacak), çıkış ise `ScheduledPayment` (borç) satırı açılır. Bakiye
-- YAPISAL OLARAK etkilenemez, çünkü ortada bir hareket yoktur. Para
-- gerçekten geldiğinde/ödendiğinde "Tahsil et" / "Öde" işlemi gerçek
-- hareketi yazar ve bakiye o an değişir.
--
-- Bu iki tablo zaten vardı ve ekranda gösteriliyordu. Eksik olan, giriş
-- formu ve tahsil/ödeme işlemiydi.

-- ---------------------------------------------------------------------------
-- 1) ALACAK — formdan gelen bilgiyi taşıyacak alanlar
-- ---------------------------------------------------------------------------
ALTER TABLE "Receivable" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Receivable" ADD COLUMN IF NOT EXISTS "costMinor" INTEGER;

-- ⚠️⚠️ TAHSİL EDİLİNCE HANGİ KATEGORİ YAZILACAK?
--
-- Bu alan olmadan alacaklar iki farklı anlamı tek kalıba sokardı:
--
--   a) Satış zaten ciroya yazılmış, sadece parası gelmemiş
--      → tahsilat TAHSILAT olmalı, yoksa aynı iş İKİ KEZ ciro sayılır
--   b) Hiçbir şey yazılmamış, satış YALNIZCA alacak olarak duruyor
--      → tahsilat SATIS olmalı, yoksa o satış ciroda HİÇ görünmez
--
-- Yeni formdan gelen satırlar (b) durumudur. Var olan satırlar (a) kabul
-- edilir -- eski `settleReceivable` davranışı buydu ve değiştirmek geçmiş
-- kayıtların anlamını sessizce kaydırırdı.
ALTER TABLE "Receivable"
    ADD COLUMN IF NOT EXISTS "settleCategory" "CashCategory" NOT NULL DEFAULT 'TAHSILAT';

-- Tahsil edildiğinde oluşan hareket buraya bağlanır.
ALTER TABLE "Receivable" ADD COLUMN IF NOT EXISTS "settledEntryId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Receivable_settledEntryId_key"
    ON "Receivable" ("settledEntryId");

-- ⚠️ RESTRICT — paketlerde ve siparişlerde alınan dersin aynısı.
-- SET NULL olsaydı bağlı hareket silindiğinde "settledEntryId" boşalır ama
-- "settledAt" DOLU kalırdı: alacak "tahsil edildi" görünür, karşılığında
-- hiçbir para olmazdı.
DO $$ BEGIN
    ALTER TABLE "Receivable"
        ADD CONSTRAINT "Receivable_settledEntryId_fkey"
        FOREIGN KEY ("settledEntryId") REFERENCES "CashEntry"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Receivable"
        ADD CONSTRAINT "Receivable_amount_positive" CHECK ("amountMinor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Receivable"
        ADD CONSTRAINT "Receivable_cost_nonnegative"
        CHECK ("costMinor" IS NULL OR "costMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2) BORÇ / YAKLAŞAN ÖDEME — aynı yapı, ters yön
-- ---------------------------------------------------------------------------
ALTER TABLE "ScheduledPayment" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "ScheduledPayment"
    ADD COLUMN IF NOT EXISTS "settleCategory" "CashCategory" NOT NULL DEFAULT 'BORC_ODEME';
ALTER TABLE "ScheduledPayment" ADD COLUMN IF NOT EXISTS "paidEntryId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledPayment_paidEntryId_key"
    ON "ScheduledPayment" ("paidEntryId");

DO $$ BEGIN
    ALTER TABLE "ScheduledPayment"
        ADD CONSTRAINT "ScheduledPayment_paidEntryId_fkey"
        FOREIGN KEY ("paidEntryId") REFERENCES "CashEntry"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ScheduledPayment"
        ADD CONSTRAINT "ScheduledPayment_amount_positive" CHECK ("amountMinor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3) "TAHSİL EDİLDİ TARİHİ" İLE "BAĞLI HAREKET" BİRLİKTE YAŞAR
--
-- Paketlerde ve siparişlerde olduğu gibi: ayrı ayrı değiştirilebildikleri
-- sürece er geç ayrışır ve hangisinin doğru olduğu bilinemez.
--
-- ⚠️ ESKİ SATIRLAR MUAF DEĞİL, ONARILIR. Yeni kısıt konmadan önce
-- karşılığı olmayan "tahsil edildi" işaretleri temizlenir -- aksi hâlde
-- migration düşerdi ve düşmesi de doğru olmazdı: o satırlar zaten yanlıştı.
-- ---------------------------------------------------------------------------
UPDATE "Receivable" SET "settledAt" = NULL
WHERE "settledAt" IS NOT NULL AND "settledEntryId" IS NULL;

DO $$ BEGIN
    ALTER TABLE "Receivable"
        ADD CONSTRAINT "Receivable_settled_pair"
        CHECK (("settledAt" IS NULL) = ("settledEntryId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE "ScheduledPayment" SET "paidAt" = NULL
WHERE "paidAt" IS NOT NULL AND "paidEntryId" IS NULL;

DO $$ BEGIN
    ALTER TABLE "ScheduledPayment"
        ADD CONSTRAINT "ScheduledPayment_paid_pair"
        CHECK (("paidAt" IS NULL) = ("paidEntryId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 4) TUTAR, HAREKET OLUŞTUKTAN SONRA DONAR
--
-- Paketlerde kanıtlanmış kusurun aynısı: tahsil edilmiş bir alacağın tutarı
-- sonradan değiştirilirse kasa hareketi eski tutarda kalır ve arada sessiz
-- bir fark oluşur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "kasa_alacak_tutar_dondur"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."settledEntryId" IS NOT NULL
       AND NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" THEN
        RAISE EXCEPTION
            'Tahsil edilmiş alacağın tutarı değiştirilemez (alacak %). Kasa hareketi ile fark oluşurdu.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kasa_alacak_tutar_dondur_trg" ON "Receivable";
CREATE TRIGGER "kasa_alacak_tutar_dondur_trg"
    BEFORE UPDATE ON "Receivable"
    FOR EACH ROW EXECUTE FUNCTION "kasa_alacak_tutar_dondur"();

CREATE OR REPLACE FUNCTION "kasa_borc_tutar_dondur"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."paidEntryId" IS NOT NULL
       AND NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" THEN
        RAISE EXCEPTION
            'Ödenmiş borcun tutarı değiştirilemez (borç %). Kasa hareketi ile fark oluşurdu.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kasa_borc_tutar_dondur_trg" ON "ScheduledPayment";
CREATE TRIGGER "kasa_borc_tutar_dondur_trg"
    BEFORE UPDATE ON "ScheduledPayment"
    FOR EACH ROW EXECUTE FUNCTION "kasa_borc_tutar_dondur"();

-- ---------------------------------------------------------------------------
-- 5) ⚠️⚠️ KARŞI TARAF: "kasa_bagli_hareket_dondur" DÖRT TABLOYU GÖRÜR
--
-- Bu fonksiyonun başına daha önce şu not yazılmıştı ve aynen gerçekleşti:
-- "Üçüncü bir tablo bu hareketlere bağlanırsa buraya da eklenmelidir --
--  yoksa koruma o tablo için sessizce yok sayılır."
--
-- Şimdi dört tablo var. Eklenmeselerdi, bir alacağa veya borca bağlı
-- hareketin tutarı serbestçe değiştirilebilir ve hiçbir hata düşmezdi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "kasa_bagli_hareket_dondur"() RETURNS TRIGGER AS $$
DECLARE
    bagli_kayit TEXT;
BEGIN
    IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
       OR NEW."accountId" IS DISTINCT FROM OLD."accountId" THEN

        SELECT 'paket ' || "id" INTO bagli_kayit FROM "ServicePackage"
        WHERE "paymentEntryId" = OLD."id" OR "costEntryId" = OLD."id"
        LIMIT 1;

        IF bagli_kayit IS NULL THEN
            SELECT 'sipariş ' || "id" INTO bagli_kayit FROM "ManualOrder"
            WHERE "paymentEntryId" = OLD."id" OR "costEntryId" = OLD."id"
            LIMIT 1;
        END IF;

        IF bagli_kayit IS NULL THEN
            SELECT 'alacak ' || "id" INTO bagli_kayit FROM "Receivable"
            WHERE "settledEntryId" = OLD."id"
            LIMIT 1;
        END IF;

        IF bagli_kayit IS NULL THEN
            SELECT 'borç ' || "id" INTO bagli_kayit FROM "ScheduledPayment"
            WHERE "paidEntryId" = OLD."id"
            LIMIT 1;
        END IF;

        IF bagli_kayit IS NOT NULL THEN
            RAISE EXCEPTION
                'Bir kayda bağlı hareketin tutarı veya hesabı değiştirilemez (%).',
                bagli_kayit
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kasa_bagli_hareket_dondur_trg" ON "CashEntry";
CREATE TRIGGER "kasa_bagli_hareket_dondur_trg"
    BEFORE UPDATE ON "CashEntry"
    FOR EACH ROW EXECUTE FUNCTION "kasa_bagli_hareket_dondur"();

CREATE INDEX IF NOT EXISTS "Receivable_settleCategory_idx"
    ON "Receivable" ("settleCategory");
