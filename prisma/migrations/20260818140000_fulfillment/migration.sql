-- FAZ 4 — FULFILLMENT (MANUEL OPERASYON)
--
-- Elle yazıldı: @prisma/schema-engine-wasm bu ortamda mevcut veritabanını
-- tarif ederken "Column type 'char' could not be deserialized" hatası veriyor
-- (Faz 1'den beri bilinen sınırlama). Değişikliklerin TAMAMI eklemedir —
-- hiçbir sütun/tip düşürülmez, veri kaybı riski yoktur.

-- 1) Yeni enum tipleri
CREATE TYPE "FulfillmentStatus" AS ENUM (
  'READY', 'PROCESSING', 'STARTED', 'PARTIAL', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED');

CREATE TYPE "FulfillmentEventType" AS ENUM (
  'CREATED', 'ASSIGNED', 'REASSIGNED', 'STARTED', 'PROGRESS_UPDATED',
  'METRIC_DECREASED', 'PARTIAL_DELIVERY', 'NOTE_ADDED', 'COMPLETED', 'FAILED',
  'REVIEW_REQUIRED', 'REPLACEMENT_CREATED', 'REPLACEMENT_APPROVED',
  'REPLACEMENT_STARTED', 'REPLACEMENT_COMPLETED');

CREATE TYPE "ReplacementStatus" AS ENUM (
  'DROP_DETECTED', 'REVIEW_REQUIRED', 'APPROVED', 'REPLACEMENT_PROCESSING',
  'COMPLETED', 'REJECTED');

-- 2) Sipariş olay tipleri: otomatik onay ve fulfillment tamamlanması
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ORDER_CONFIRMED' AFTER 'ORDER_CREATED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'FULFILLMENT_COMPLETED' AFTER 'ORDER_CONFIRMED';

-- 3) Fulfillment
CREATE TABLE "Fulfillment" (
  "id"                TEXT NOT NULL,
  -- ⚠️ 1 Order → 1 Fulfillment. Duplicate webhook ikinci kayıt AÇAMAZ.
  "orderId"           TEXT NOT NULL,
  "status"            "FulfillmentStatus" NOT NULL DEFAULT 'READY',
  "targetSnapshot"    JSONB NOT NULL,
  "requestedQuantity" INTEGER NOT NULL,
  "deliveredQuantity" INTEGER NOT NULL DEFAULT 0,
  "initialMetric"     INTEGER,
  "currentMetric"     INTEGER,
  "assignedToUserId"  TEXT,
  "assignedById"      TEXT,
  "assignedAt"        TIMESTAMP(3),
  "startedAt"         TIMESTAMP(3),
  "completedAt"       TIMESTAMP(3),
  "failedAt"          TIMESTAMP(3),
  "guaranteeDays"     INTEGER,
  "guaranteeEndsAt"   TIMESTAMP(3),
  "internalNote"      TEXT,
  "customerNote"      TEXT,
  "failureReason"     TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Fulfillment_orderId_key" ON "Fulfillment"("orderId");
CREATE INDEX "Fulfillment_status_createdAt_idx" ON "Fulfillment"("status", "createdAt");
CREATE INDEX "Fulfillment_assignedToUserId_status_idx" ON "Fulfillment"("assignedToUserId", "status");
CREATE INDEX "Fulfillment_createdAt_idx" ON "Fulfillment"("createdAt");

ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) FulfillmentEvent
CREATE TABLE "FulfillmentEvent" (
  "id"                TEXT NOT NULL,
  "fulfillmentId"     TEXT NOT NULL,
  "type"              "FulfillmentEventType" NOT NULL,
  "actorUserId"       TEXT,
  "quantity"          INTEGER,
  "previousMetric"    INTEGER,
  "currentMetric"     INTEGER,
  "fromStatus"        "FulfillmentStatus",
  "toStatus"          "FulfillmentStatus",
  "note"              TEXT,
  "isCustomerVisible" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FulfillmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FulfillmentEvent_fulfillmentId_createdAt_idx" ON "FulfillmentEvent"("fulfillmentId", "createdAt");
CREATE INDEX "FulfillmentEvent_type_createdAt_idx" ON "FulfillmentEvent"("type", "createdAt");

ALTER TABLE "FulfillmentEvent" ADD CONSTRAINT "FulfillmentEvent_fulfillmentId_fkey"
  FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FulfillmentEvent" ADD CONSTRAINT "FulfillmentEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) ReplacementCase — garanti telafisi, TAMAMEN MANUEL
CREATE TABLE "ReplacementCase" (
  "id"                  TEXT NOT NULL,
  "fulfillmentId"       TEXT NOT NULL,
  "reason"              TEXT NOT NULL,
  "initialDelivered"    INTEGER NOT NULL,
  "currentMetric"       INTEGER,
  "droppedQuantity"     INTEGER,
  "replacementQuantity" INTEGER NOT NULL,
  "status"              "ReplacementStatus" NOT NULL DEFAULT 'DROP_DETECTED',
  "assignedToUserId"    TEXT,
  "createdById"         TEXT,
  "approvedById"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"         TIMESTAMP(3),
  CONSTRAINT "ReplacementCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReplacementCase_fulfillmentId_idx" ON "ReplacementCase"("fulfillmentId");
CREATE INDEX "ReplacementCase_status_createdAt_idx" ON "ReplacementCase"("status", "createdAt");

ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_fulfillmentId_fkey"
  FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
