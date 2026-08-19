-- Faz 10 — DAĞITIM DAMGASI
--
-- Veritabanının hangi ortama ait olduğunu veritabanının KENDİSİNDE saklar.
-- Salt eklemeli (additive): mevcut hiçbir tabloya dokunmaz, veri taşımaz.
--
-- Damgasız bir veritabanı hatalı değildir ve yalnızca uyarı üretir. Yanlış
-- damgalı bir veritabanına bağlanmak ise uygulamayı AÇTIRMAZ.

CREATE TABLE IF NOT EXISTS "DeploymentStamp" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "stage" TEXT NOT NULL,
    "label" TEXT,
    "stampedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stampedBy" TEXT,

    CONSTRAINT "DeploymentStamp_pkey" PRIMARY KEY ("id")
);

-- Tek satır garantisi: ikinci bir damga satırı oluşturulamaz.
ALTER TABLE "DeploymentStamp"
    DROP CONSTRAINT IF EXISTS "DeploymentStamp_singleton_check";
ALTER TABLE "DeploymentStamp"
    ADD CONSTRAINT "DeploymentStamp_singleton_check" CHECK ("id" = 'singleton');

-- Serbest metin bir aşama yazılamaz.
ALTER TABLE "DeploymentStamp"
    DROP CONSTRAINT IF EXISTS "DeploymentStamp_stage_check";
ALTER TABLE "DeploymentStamp"
    ADD CONSTRAINT "DeploymentStamp_stage_check"
    CHECK ("stage" IN ('production', 'staging', 'e2e', 'development'));
