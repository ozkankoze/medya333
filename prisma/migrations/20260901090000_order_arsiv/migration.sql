-- SİPARİŞ ARŞİVİ — İş Kuyruğu'ndan kaldırma
--
-- İş Kuyruğu'nda biriken siparişleri temizleme yetkisi istendi. Silme tek
-- başına doğru araç değil, çünkü:
--
--   · ÖDEMESİ OLAN SİPARİŞ ZATEN SİLİNEMEZ. "Payment" ve "Refund"
--     tablolarının yabancı anahtarları ON DELETE RESTRICT'tir -- veritabanı
--     reddeder. Arayüzde bir silme düğmesi koymak, tıklandığında anlaşılmaz
--     bir hata veren bir düğme koymak olurdu.
--   · Ödemesi olmayan sipariş silinebilir ama silme CASCADE ile sipariş
--     kalemini, TÜM olay geçmişini, fulfillment kaydını ve bildirimleri de
--     götürür. Bu, terk edilmiş bir sepet için doğru, gerçek bir iş için
--     yanlıştır.
--
-- Arşiv ikisinin arasındaki boşluğu doldurur: kayıt yerinde durur, para izi
-- korunur, sipariş yalnızca kuyruktan kalkar. Geri alınabilir.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Kim arşivledi -- denetim kaydında da var ama satırda durması, kuyruğa
-- bakan kişinin ekranı terk etmeden görmesini sağlar.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;

-- ⚠️ KISMİ İNDEKS: yalnızca arşivlenmiş satırlar indekslenir.
-- Kuyruk sorgusu her seferinde "archivedAt IS NULL" filtresi uygular ve
-- siparişlerin ezici çoğunluğu arşivsizdir. Tam indeks, hiçbir zaman
-- okunmayan yüz binlerce satırı taşırdı.
CREATE INDEX IF NOT EXISTS "Order_archivedAt_idx"
    ON "Order" ("archivedAt") WHERE "archivedAt" IS NOT NULL;

-- ⚠️ "ARŞİVLENDİ" AYRI BİR DURUM DEĞİLDİR, OrderStatus'a EKLENMEDİ.
-- Eklenseydi siparişin gerçek durumunu (PAID, COMPLETED…) EZERDİ: arşivden
-- çıkarıldığında hangi duruma döneceği bilinemezdi. Arşiv, durumdan bağımsız
-- bir görünürlük bayrağıdır.
