-- Категории: цвет-метка и порядок, который задаёт владелец.
--
-- Миграция только ДОБАВЛЯЕТ и повторно-запускаема (IF NOT EXISTS), в том числе
-- если колонки раньше создал `prisma db push`. Старый бэкенд на новой схеме
-- продолжает работать: color nullable, sortOrder имеет default 0.
--
-- Запуск:  npm run db:categories
--
-- Данные не трогаем: у существующих категорий color = NULL («без цвета»),
-- sortOrder = 0 у всех, поэтому список сортируется по (sortOrder, name) —
-- то есть по алфавиту, пока владелец не расставит порядок сам.

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "color" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "Category_marketId_sortOrder_idx" ON "Category"("marketId", "sortOrder");
