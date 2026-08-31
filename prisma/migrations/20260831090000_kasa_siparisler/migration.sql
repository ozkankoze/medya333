-- KASA — ELLE GİRİLEN GÜNLÜK SİPARİŞ DEFTERİ
--
-- Salt EKLEMELİ. Mevcut hiçbir tabloya veya veriye dokunmaz.
--
-- ⚠️⚠️ BU TABLO SİTEDEKİ "Order" TABLOSU DEĞİLDİR ve onunla hiçbir bağı
-- yoktur. "Order" gerçek müşteri siparişidir: ödeme akışı üretir, denetim
-- izi taşır, silinemez. Bu tablo ise işletmenin KENDİ defteridir -- elle
-- girilir, elle silinir ve yalnızca SUPERADMIN görür.
--
-- İkisini tek tabloda birleştirmek cazipti ve yanlış olurdu: gerçek bir
-- siparişte "maliyet" alanı yoktur, gerçek bir sipariş silinemez, ve
-- silinebilir bir defteri müşteri kayıtlarıyla aynı tabloya koymak, bir
-- gün yanlış satırın silinmesiyle biterdi.
--
-- ⚠️ "NET KAR" SÜTUNU YOKTUR. salePriceMinor - costMinor ile hesaplanır.
-- Saklansaydı satış veya maliyet düzeltildiğinde güncellenmeyi unutabilir
-- ve üç alan birbiriyle çelişirdi.
--
-- ⚠️ "ÖDEME DURUMU" SÜTUNU DA YOKTUR. paidAt doludur ya da değildir.
-- Ayrı bir bayrak + tarih tutmak er geç ayrışır ve hangisinin doğru
-- olduğu bilinemez.

DO $$ BEGIN
    CREATE TYPE "ManualOrderStatus" AS ENUM (
        'BEKLIYOR',
        'DEVAM_EDIYOR',
        'TAMAMLANDI',
        'IPTAL'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ManualOrder" (
    "id" TEXT NOT NULL,
    -- Tabloda "Kullanıcı adı"
    "customerName" TEXT NOT NULL,
    -- İşin TAKVİM GÜNÜ. Gün başlangıcına sabitlenir, saat tutulmaz --
    -- defter gün bazlıdır ve saat dilimi kayması ay dağılımını bozardı.
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "salePriceMinor" INTEGER NOT NULL,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    -- ⚠️ İŞ DURUMU, ÖDEME DURUMU DEĞİL. İkisi bağımsızdır: tamamlanmış ama
    -- tahsil edilmemiş bir sipariş olağandır.
    "status" "ManualOrderStatus" NOT NULL DEFAULT 'BEKLIYOR',
    -- Ödeme ALINDIĞINDA dolar.
    "paidAt" TIMESTAMP(3),
    -- ⚠️ SİPARİŞ GİRMEK BANKA BAKİYESİNİ ARTIRMAZ. Gelir hareketi yalnızca
    -- "tahsil edildi" işleminde oluşur ve buraya bağlanır.
    "paymentEntryId" TEXT,
    "costEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ManualOrder_pkey" PRIMARY KEY ("id")
);

-- ⚠️ KISITLAR VERİTABANINDA DA VAR. Uygulama katmanı atlanabilir (elle SQL,
-- ileride bir script, hatalı bir migration), parayı bozan bir satırın
-- veritabanına girmesi ise geri alınamaz.

DO $$ BEGIN
    ALTER TABLE "ManualOrder"
        ADD CONSTRAINT "ManualOrder_sale_nonnegative" CHECK ("salePriceMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ManualOrder"
        ADD CONSTRAINT "ManualOrder_cost_nonnegative" CHECK ("costMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ⚠️ BİR HAREKET EN FAZLA BİR SİPARİŞE BAĞLANIR. Aksi hâlde tek bir
-- tahsilat iki siparişi birden "ödendi" gösterebilir ve aynı para iki kez
-- sayılırdı.
CREATE UNIQUE INDEX IF NOT EXISTS "ManualOrder_paymentEntryId_key"
    ON "ManualOrder" ("paymentEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "ManualOrder_costEntryId_key"
    ON "ManualOrder" ("costEntryId");

-- ⚠️ RESTRICT, "SET NULL" DEĞİL.
-- Paketlerde bu ders zaten alındı: SET NULL ile bağlı hareket silinince
-- "paymentEntryId" NULL oluyor ama "paidAt" DOLU kalıyordu -- sipariş
-- ekranda "Tahsil edildi" görünüyor, karşılığında hiçbir para yok.
-- Aynı hatayı ikinci tabloda tekrarlamıyoruz.
DO $$ BEGIN
    ALTER TABLE "ManualOrder"
        ADD CONSTRAINT "ManualOrder_paymentEntryId_fkey"
        FOREIGN KEY ("paymentEntryId") REFERENCES "CashEntry"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ManualOrder"
        ADD CONSTRAINT "ManualOrder_costEntryId_fkey"
        FOREIGN KEY ("costEntryId") REFERENCES "CashEntry"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ⚠️ "ÖDENDİ TARİHİ" İLE "BAĞLI HAREKET" BİRLİKTE YAŞAR. Ayrı ayrı
-- değiştirilebildikleri sürece er geç ayrışır ve hangisinin doğru olduğu
-- bilinemez. Ya ikisi de dolu, ya ikisi de boş.
DO $$ BEGIN
    ALTER TABLE "ManualOrder"
        ADD CONSTRAINT "ManualOrder_paid_pair"
        CHECK (("paidAt" IS NULL) = ("paymentEntryId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ManualOrder_occurredAt_idx"
    ON "ManualOrder" ("occurredAt");
CREATE INDEX IF NOT EXISTS "ManualOrder_customerName_idx"
    ON "ManualOrder" ("customerName");

-- ---------------------------------------------------------------------------
-- FİNANS HAREKETİ OLUŞTUKTAN SONRA TUTAR DONAR
--
-- Paketlerde kanıtlanmış en pahalı kusurun aynısı: tahsil edilmiş bir
-- kaydın satış tutarı sonradan değiştirildiğinde kasa hareketi eski
-- tutarda kalır ve arada sessiz bir fark oluşur. Kural: para hareketi
-- oluştuysa o rakam ARTIK DEĞİŞTİRİLEMEZ. Rakam yanlışsa doğru yol
-- düzeltme değil, ters kayıt veya silip yeniden girmektir.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "kasa_siparis_tutar_dondur"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."paymentEntryId" IS NOT NULL
       AND NEW."salePriceMinor" IS DISTINCT FROM OLD."salePriceMinor" THEN
        RAISE EXCEPTION
            'Tahsilatı yapılmış siparişin tutarı değiştirilemez (sipariş %). Kasa hareketi ile fark oluşurdu.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."costEntryId" IS NOT NULL
       AND NEW."costMinor" IS DISTINCT FROM OLD."costMinor" THEN
        RAISE EXCEPTION
            'Gideri işlenmiş siparişin maliyeti değiştirilemez (sipariş %). Kasa hareketi ile fark oluşurdu.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kasa_siparis_tutar_dondur_trg" ON "ManualOrder";
CREATE TRIGGER "kasa_siparis_tutar_dondur_trg"
    BEFORE UPDATE ON "ManualOrder"
    FOR EACH ROW EXECUTE FUNCTION "kasa_siparis_tutar_dondur"();

-- ---------------------------------------------------------------------------
-- ⚠️⚠️ KARŞI TARAFTAN GELEN KAPI DA KAPATILIR
--
-- Yukarıdaki kural yalnızca sipariş satırını korur. Aynı fark, HAREKETİN
-- tutarını değiştirerek karşı taraftan da açılabilirdi.
--
-- "kasa_bagli_hareket_dondur" zaten vardı ama SADECE "ServicePackage"
-- tablosuna bakıyordu. Yeni tablo eklenince o kontrol sessizce eksik
-- kaldı: bir siparişe bağlı hareketin tutarı serbestçe değiştirilebilir
-- olurdu ve hiçbir hata düşmezdi. Fonksiyon burada, İKİ tabloyu birden
-- görecek şekilde yeniden yazılıyor.
--
-- ⚠️ Bu, yeni bir tablo eklendiğinde tekrar gözden geçirilmesi gereken
-- bir yerdir. Üçüncü bir tablo bu hareketlere bağlanırsa buraya da
-- eklenmelidir -- yoksa koruma o tablo için sessizce yok sayılır.
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

-- ---------------------------------------------------------------------------
-- FİNANS HAREKETİ OLAN SİPARİŞ SİLİNEMEZ
--
-- Siparişlerin SİLİNEBİLİR olması istendi ve doğrudur -- yanlış girilen
-- bir satır defterde kalmamalı. Ama kasaya gelir veya gider yazılmış bir
-- siparişi silmek, o parayı öksüz bırakır: hareket defterde durur, hangi
-- işe ait olduğu bir daha bilinemez ve bakiye açıklanamaz hâle gelir.
--
-- Bu yüzden silme, yalnızca finans hareketi OLMAYAN satırlarda serbesttir.
-- Hareket varsa önce o bağ koparılmalı (tahsilat geri alınmalı) --
-- iki adımlı ve bilinçli.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "kasa_siparis_silme_engel"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."paymentEntryId" IS NOT NULL OR OLD."costEntryId" IS NOT NULL THEN
        RAISE EXCEPTION
            'Kasaya hareket yazılmış sipariş silinemez (sipariş %). Önce tahsilatı geri alın.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kasa_siparis_silme_engel_trg" ON "ManualOrder";
CREATE TRIGGER "kasa_siparis_silme_engel_trg"
    BEFORE DELETE ON "ManualOrder"
    FOR EACH ROW EXECUTE FUNCTION "kasa_siparis_silme_engel"();
