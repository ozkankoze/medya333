-- CreateTable
CREATE TABLE "FollowerOrder" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "endCount" INTEGER NOT NULL,
    "note" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "FollowerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowerCheck" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "FollowerCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowerOrder_isArchived_username_idx" ON "FollowerOrder"("isArchived", "username");

-- CreateIndex
CREATE INDEX "FollowerCheck_day_idx" ON "FollowerCheck"("day");

-- CreateIndex
CREATE UNIQUE INDEX "FollowerCheck_orderId_day_key" ON "FollowerCheck"("orderId", "day");

-- AddForeignKey
ALTER TABLE "FollowerCheck" ADD CONSTRAINT "FollowerCheck_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "FollowerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
