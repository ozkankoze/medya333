-- KASA — GELİR / GİDER DEFTERİ
--
-- Salt EKLEMELİ (additive): mevcut hiçbir tabloya, sütuna veya veriye
-- dokunmaz. Sipariş sisteminden tamamen bağımsızdır. `Order` ile ilişki
-- KURULMAZ (bkz. schema.prisma'daki blok başlığı).
--
-- ⚠️ BAKİYE SÜTUNU YOKTUR ve eklenmemelidir. Bakiye, `CashEntry`
-- hareketlerinin toplamından türetilir. Saklanan bir bakiye bir kez
-- kayarsa (çift kayıt, yarıda kalan işlem, eşzamanlı güncelleme) hangi
-- rakamın doğru olduğu bir daha bilinemez ve tablo sessizce yalan söyler.

-- ---------------------------------------------------------------------------
-- Enum'lar
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "CashCategory" AS ENUM (
        'SATIS', 'TAHSILAT', 'GIDER', 'MALIYET',
        'BORC_ODEME', 'TRANSFER_IN', 'TRANSFER_OUT', 'DIGER'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Hesaplar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CashAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    -- Sisteme geçmeden önceki para. HAREKET DEĞİLDİR: sahte bir "giriş"
    -- satırı olarak yazılsaydı ciro raporunu şişirirdi.
    "openingBalanceMinor" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAccount_pkey" PRIMARY KEY ("id")
);

-- Aynı kişide aynı isimde iki hesap olamaz: "Özkan / Vakıfbank" tekildir.
-- Aksi hâlde para iki ayrı satıra bölünür ve toplam sessizce eksik kalır.
CREATE UNIQUE INDEX IF NOT EXISTS "CashAccount_owner_name_key"
    ON "CashAccount" ("owner", "name");

CREATE INDEX IF NOT EXISTS "CashAccount_isActive_sortOrder_idx"
    ON "CashAccount" ("isActive", "sortOrder");

-- ---------------------------------------------------------------------------
-- Hareketler
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CashEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    -- Takvim günü. Saat tutulmaz, çünkü saat dilimi kayması haftalık
    -- dağılımı bozardı.
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "category" "CashCategory" NOT NULL,
    -- HER ZAMAN POZİTİF (aşağıdaki CHECK kısıtı). Yönü "direction" taşır.
    "amountMinor" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "customerHandle" TEXT,
    -- İşin bize maliyeti. BANKA HAREKETİ DEĞİLDİR: bakiyeyi düşürmez,
    -- yalnızca kâr hesabına girer.
    "costMinor" INTEGER,
    "note" TEXT,
    "transferGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id")
);

-- ⚠️ KISITLAR VERİTABANINDA DA VAR, yalnızca uygulamada değil.
-- Uygulama katmanı atlanabilir (elle SQL, gelecekteki bir script, hatalı
-- bir migration). Parayı bozan bir satırın veritabanına girmesi ise geri
-- alınamaz. Bu yüzden kural iki yerde birden durur.
DO $$ BEGIN
    ALTER TABLE "CashEntry"
        ADD CONSTRAINT "CashEntry_amount_positive" CHECK ("amountMinor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "CashEntry"
        ADD CONSTRAINT "CashEntry_cost_nonnegative"
        CHECK ("costMinor" IS NULL OR "costMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ⚠️ HESAP SİLİNEMEZ (RESTRICT). Hareketi olan bir hesabı silmek, o
-- hareketleri öksüz bırakır ve geçmiş bakiye bir daha hesaplanamaz.
-- Kullanımdan kaldırmak için "isActive = false" kullanılır.
DO $$ BEGIN
    ALTER TABLE "CashEntry"
        ADD CONSTRAINT "CashEntry_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "CashAccount"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CashEntry_accountId_occurredAt_idx"
    ON "CashEntry" ("accountId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CashEntry_occurredAt_idx"
    ON "CashEntry" ("occurredAt");
CREATE INDEX IF NOT EXISTS "CashEntry_category_occurredAt_idx"
    ON "CashEntry" ("category", "occurredAt");
CREATE INDEX IF NOT EXISTS "CashEntry_transferGroupId_idx"
    ON "CashEntry" ("transferGroupId");

-- ---------------------------------------------------------------------------
-- Alacaklar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Receivable" (
    "id" TEXT NOT NULL,
    "person" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "note" TEXT,
    -- Tahsil edildiğinde doldurulur. Satır SİLİNMEZ, geçmiş kaybolmasın.
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "Receivable"
        ADD CONSTRAINT "Receivable_amount_positive" CHECK ("amountMinor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Receivable_settledAt_dueDate_idx"
    ON "Receivable" ("settledAt", "dueDate");

-- ---------------------------------------------------------------------------
-- Borç takvimi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ScheduledPayment" (
    "id" TEXT NOT NULL,
    "creditor" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "remainingMinor" INTEGER,
    "dueDate" TIMESTAMP(3) NOT NULL,
    -- Ödendiğinde doldurulur. Satır SİLİNMEZ.
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPayment_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "ScheduledPayment"
        ADD CONSTRAINT "ScheduledPayment_amount_positive" CHECK ("amountMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ScheduledPayment_paidAt_dueDate_idx"
    ON "ScheduledPayment" ("paidAt", "dueDate");

-- ---------------------------------------------------------------------------
-- Ayar (tek satır)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "KasaSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    -- 1 USD kaç KURUŞ? (43,50 ₺ → 4350). Elle girilir, dış servis YOK.
    "usdRateMinor" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KasaSetting_pkey" PRIMARY KEY ("id")
);

-- Tek satır garantisi: ikinci bir ayar satırı oluşturulamaz.
DO $$ BEGIN
    ALTER TABLE "KasaSetting"
        ADD CONSTRAINT "KasaSetting_singleton" CHECK ("id" = 'singleton');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
