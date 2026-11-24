-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "combinesOrder" BOOLEAN NOT NULL DEFAULT false,
    "combinesProduct" BOOLEAN NOT NULL DEFAULT false,
    "combinesShipping" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "shopifyDiscountId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "syncedVersion" INTEGER,
    "syncedConfig" JSONB,
    "syncError" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Rule_shop_priority_idx" ON "Rule"("shop", "priority");

-- CreateIndex
CREATE INDEX "Rule_shop_syncStatus_idx" ON "Rule"("shop", "syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_shop_shopifyDiscountId_key" ON "Rule"("shop", "shopifyDiscountId");

-- CreateIndex
CREATE INDEX "SyncEvent_shop_createdAt_idx" ON "SyncEvent"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SyncEvent_ruleId_idx" ON "SyncEvent"("ruleId");
