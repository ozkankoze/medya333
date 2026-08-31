-- KASA — BAŞLANGIÇ HESAPLARI
--
-- Tablodaki dört hesabı oluşturur. BİR KEZ çalıştırılır.
--
-- ⚠️ AÇILIŞ BAKİYELERİNİ SEN GİRECEKSİN. Aşağıdaki değerler 0'dır ve
-- bilerek öyle bırakıldı: uydurma bir açılış bakiyesi, ilk günden itibaren
-- her rakamı yanlış yapar ve hatanın nereden geldiği bir daha bulunamaz.
-- Her hesabın BUGÜNKÜ gerçek bakiyesini yaz, defter oradan devam etsin.
--
-- ⚠️ TUTARLAR KURUŞ CİNSİNDEN TAM SAYIDIR. 12.500,75 ₺ → 1250075.
--
-- ⚠️ TEKRAR ÇALIŞTIRMAK GÜVENLİDİR. "ON CONFLICT DO NOTHING" sayesinde
-- ikinci çalıştırma mevcut hesapları ÇOĞALTMAZ ve açılış bakiyelerini
-- EZMEZ — yanlışlıkla iki kez çalıştırmak paranı silmez.

INSERT INTO "CashAccount" (id, name, owner, "openingBalanceMinor", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
    (gen_random_uuid()::text, 'Vakıfbank', 'Özkan Köse', 0, 1, true, now(), now()),
    (gen_random_uuid()::text, 'Shopier',   'Özkan Köse', 0, 2, true, now(), now()),
    (gen_random_uuid()::text, 'Yapıkredi', 'Ayhan Köse', 0, 1, true, now(), now()),
    (gen_random_uuid()::text, 'Akbank',    'Ayhan Köse', 0, 2, true, now(), now())
ON CONFLICT (owner, name) DO NOTHING;

-- Dolar kuru — ELLE girilir, dış servisten çekilmez.
-- 1 USD kaç KURUŞ? 43,48 ₺ → 4348. Kuru değiştirmek GEÇMİŞ kayıtların
-- dolar karşılığını da değiştirir; bu yüzden ay içinde oynatmamak en iyisidir.
INSERT INTO "KasaSetting" (id, "usdRateMinor", "updatedAt")
VALUES ('singleton', 4348, now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- AÇILIŞ BAKİYELERİNİ GİRMEK İÇİN (rakamları kendin değiştir):
--
--   UPDATE "CashAccount" SET "openingBalanceMinor" = 1250075
--   WHERE owner = 'Özkan Köse' AND name = 'Vakıfbank';
--
-- KONTROL — hesapların türetilmiş bakiyesi:
--
--   SELECT a.owner, a.name,
--          (a."openingBalanceMinor" + COALESCE(SUM(
--             CASE WHEN e.direction = 'IN' THEN e."amountMinor"
--                  ELSE -e."amountMinor" END), 0)) / 100.0 AS bakiye
--   FROM "CashAccount" a
--   LEFT JOIN "CashEntry" e ON e."accountId" = a.id
--   GROUP BY a.id, a.owner, a.name
--   ORDER BY a.owner, a.name;
-- ---------------------------------------------------------------------------
