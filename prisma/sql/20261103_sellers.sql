-- Продавцы: отключение вместо удаления и отмена выплаты встречной записью.
--
-- Миграция только ДОБАВЛЯЕТ и повторно-запускаема (IF NOT EXISTS), в том числе
-- если колонки раньше создал `prisma db push`. Старый бэкенд на новой схеме
-- продолжает работать: isActive имеет default true, остальное nullable.
--
-- Запуск:  npm run db:sellers
--
-- Данные не трогаем: все существующие пользователи остаются активными
-- (isActive = true), выплаты остаются как есть (reversalOfId = NULL).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "User_marketId_role_isActive_idx" ON "User"("marketId", "role", "isActive");

ALTER TABLE "SellerCredit" ADD COLUMN IF NOT EXISTS "reversalOfId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "SellerCredit_reversalOfId_key" ON "SellerCredit"("reversalOfId");
CREATE INDEX IF NOT EXISTS "SellerCredit_sellerId_createdAt_idx" ON "SellerCredit"("sellerId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SellerCredit_reversalOfId_fkey'
  ) THEN
    ALTER TABLE "SellerCredit"
      ADD CONSTRAINT "SellerCredit_reversalOfId_fkey"
      FOREIGN KEY ("reversalOfId") REFERENCES "SellerCredit"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
