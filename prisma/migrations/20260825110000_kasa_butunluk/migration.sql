-- KASA — FİNANSAL BÜTÜNLÜK KİLİTLERİ
--
-- Bir denetim, paket ile kasa hareketi arasındaki bağın DÖRT ayrı yoldan
-- sessizce bozulabildiğini gösterdi. Hepsi kanıtlandı, hepsi burada
-- kapatılıyor. Kurallar UYGULAMADA DEĞİL, VERİTABANINDA duruyor: uygulama
-- katmanı atlanabilir (elle SQL, ileride bir script, hatalı bir migration),
-- parayı bozan bir satırın veritabanına girmesi ise geri alınamaz.
--
-- ⚠️ Salt eklemeli. Var olan veriye dokunmaz, yalnızca kural ekler.

-- ---------------------------------------------------------------------------
-- 1) BAĞLI HAREKET SİLİNEMEZ (SET NULL yerine RESTRICT)
--
-- Eski davranış SET NULL idi. Denetimde şu çıktı: bağlı hareket silinince
-- "paymentEntryId" NULL oluyor ama "paidAt" DOLU kalıyordu. Paket ekranda
-- "Tahsil edildi" görünüyor, karşılığında hiçbir para yok. Sessiz yalan.
--
-- Artık bağlı bir hareketi silmek REDDEDİLİR. Gerçekten silinmesi
-- gerekiyorsa önce paketten bağ koparılır -- bu da aşağıdaki CHECK yüzünden
-- "paidAt"i temizlemeyi zorunlu kılar. İki adımlı ve bilinçli.
-- ---------------------------------------------------------------------------
ALTER TABLE "ServicePackage" DROP CONSTRAINT IF EXISTS "ServicePackage_paymentEntryId_fkey";
ALTER TABLE "ServicePackage" DROP CONSTRAINT IF EXISTS "ServicePackage_costEntryId_fkey";

DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_paymentEntryId_fkey"
        FOREIGN KEY ("paymentEntryId") REFERENCES "CashEntry"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_costEntryId_fkey"
        FOREIGN KEY ("costEntryId") REFERENCES "CashEntry"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2) "ÖDENDİ TARİHİ" İLE "BAĞLI HAREKET" BİRLİKTE YAŞAR
--
-- İkisi ayrı ayrı değiştirilebildiği sürece er geç ayrışır ve hangisinin
-- doğru olduğu bilinemez. Ya ikisi de dolu, ya ikisi de boş.
-- ---------------------------------------------------------------------------
UPDATE "ServicePackage" SET "paidAt" = NULL
WHERE "paidAt" IS NOT NULL AND "paymentEntryId" IS NULL;

DO $$ BEGIN
    ALTER TABLE "ServicePackage"
        ADD CONSTRAINT "ServicePackage_paid_pair"
        CHECK (("paidAt" IS NULL) = ("paymentEntryId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3) FİNANS HAREKETİ OLUŞTUKTAN SONRA TUTAR DONAR (snapshot)
--
-- Denetimde kanıtlanan en pahalı kusur: tahsil edilmiş bir paketin satış
-- tutarı 20.000'den 99.000'e çekildiğinde kasa hareketi 20.000'de kaldı ve
-- arada 79.000 TL'lik sessiz bir fark oluştu. Aynısı maliyet için de geçerli.
--
-- Kural: para hareketi oluştuysa o rakam ARTIK DEĞİŞTİRİLEMEZ. Hareket
-- gerçeği temsil eder -- para o tutarda gelmiştir. Rakam yanlışsa doğru yol
-- düzeltme değil, ters kayıt veya iptal + yeni pakettir.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "kasa_paket_tutar_dondur"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."paymentEntryId" IS NOT NULL
       AND NEW."salePriceMinor" IS DISTINCT FROM OLD."salePriceMinor" THEN
        RAISE EXCEPTION
            'Tahsilatı yapılmış paketin satış tutarı değiştirilemez (paket %). Kasa hareketi ile fark oluşurdu.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."costEntryId" IS NOT NULL
       AND NEW."costMinor" IS DISTINCT FROM OLD."costMinor" THEN
        RAISE EXCEPTION
            'Gideri işlenmiş paketin maliyeti değiştirilemez (paket %). Kasa hareketi ile fark oluşurdu.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kasa_paket_tutar_dondur_trg" ON "ServicePackage";
CREATE TRIGGER "kasa_paket_tutar_dondur_trg"
    BEFORE UPDATE ON "ServicePackage"
    FOR EACH ROW EXECUTE FUNCTION "kasa_paket_tutar_dondur"();

-- ---------------------------------------------------------------------------
-- 4) BAĞLI HAREKETİN TUTARI DA DONAR
--
-- 3. kural yalnızca paketi korur. Karşı taraftan -- yani hareketin tutarını
-- değiştirerek -- aynı fark yine açılabilirdi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "kasa_bagli_hareket_dondur"() RETURNS TRIGGER AS $$
DECLARE
    bagli_paket TEXT;
BEGIN
    IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
       OR NEW."accountId" IS DISTINCT FROM OLD."accountId" THEN
        SELECT "id" INTO bagli_paket FROM "ServicePackage"
        WHERE "paymentEntryId" = OLD."id" OR "costEntryId" = OLD."id"
        LIMIT 1;

        IF bagli_paket IS NOT NULL THEN
            RAISE EXCEPTION
                'Bir pakete bağlı hareketin tutarı veya hesabı değiştirilemez (paket %).',
                bagli_paket
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
-- 5) FİNANS HAREKETİ OLAN PAKET SİLİNEMEZ
--
-- Denetimde paket silindi ve kasa hareketi ortada kaldı: para defterde
-- duruyor ama hangi işe ait olduğu bir daha bilinemiyor. Kâr kaydı yok
-- oldu, para kaldı.
--
-- İptal etmek için "canceledAt" vardır -- o kaydı silmez, geçmişi korur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "kasa_paket_silme_engel"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."paymentEntryId" IS NOT NULL OR OLD."costEntryId" IS NOT NULL THEN
        RAISE EXCEPTION
            'Finans hareketi olan paket silinemez (paket %). İptal için canceledAt kullanın.',
            OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kasa_paket_silme_engel_trg" ON "ServicePackage";
CREATE TRIGGER "kasa_paket_silme_engel_trg"
    BEFORE DELETE ON "ServicePackage"
    FOR EACH ROW EXECUTE FUNCTION "kasa_paket_silme_engel"();
