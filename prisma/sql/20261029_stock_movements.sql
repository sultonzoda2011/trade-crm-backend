-- Журнал движения остатка + архив товаров.
--
-- Миграция БЕЗ потери данных и повторно-запускаемая: каждый шаг проверяет,
-- есть ли уже результат. Порядок с `prisma db push` не важен — если таблицы
-- уже созданы пушем, DDL просто пропустится, а бэкфилл всё равно отработает.
--
-- Запуск:  npm run db:stock-movements
--
-- Бэкфилл записывает текущий остаток каждого товара как OPENING-движение.
-- Историю прошлых продаж задним числом он НЕ восстанавливает: журнал честно
-- начинается с момента включения. После бэкфилла Σ delta по товару = Product.quantity.

-- 1. Тип движения -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "StockMovementType" AS ENUM (
    'OPENING', 'RESTOCK', 'SALE', 'REFUND', 'VOID', 'WRITE_OFF', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Архив товаров: у всех существующих товаров isActive = true -------------
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Product_marketId_isActive_idx" ON "Product"("marketId", "isActive");

-- 3. Таблица журнала --------------------------------------------------------
CREATE TABLE IF NOT EXISTS "StockMovement" (
  "id"            TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "marketId"      TEXT NOT NULL,
  "type"          "StockMovementType" NOT NULL,
  "delta"         INTEGER NOT NULL,
  "balanceAfter"  INTEGER NOT NULL,
  "reason"        TEXT,
  "note"          TEXT,
  "transactionId" TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_marketId_createdAt_idx" ON "StockMovement"("marketId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_transactionId_idx" ON "StockMovement"("transactionId");

DO $$ BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_marketId_fkey"
    FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Бэкфилл: текущий остаток -> OPENING ------------------------------------
-- Только для товаров, у которых в журнале ещё ничего нет и остаток не нулевой
-- (нулевой остаток без движений и так даёт Σ delta = 0). Повторный запуск
-- ничего не дублирует.
INSERT INTO "StockMovement"
  ("id", "productId", "marketId", "type", "delta", "balanceAfter", "note", "createdAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  p."marketId",
  'OPENING',
  p."quantity",
  p."quantity",
  'Остаток на момент включения журнала',
  CURRENT_TIMESTAMP
FROM "Product" p
WHERE p."quantity" <> 0
  AND NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."productId" = p."id");
