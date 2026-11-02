-- Рынок: контакты и настройки.
--
-- Миграция только ДОБАВЛЯЕТ и повторно-запускаема (IF NOT EXISTS), в том числе
-- если колонки раньше создал `prisma db push`. Старый бэкенд на новой схеме
-- продолжает работать: phone и workHours nullable, allowSellerSales имеет
-- default false (= как было: продавец оформляет только долги).
--
-- Запуск:  npm run db:market-settings
--
-- Данные не трогаем: у существующих рынков phone и workHours = NULL
-- («не указан»), allowSellerSales = false.

ALTER TABLE "Market" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Market" ADD COLUMN IF NOT EXISTS "workHours" TEXT;
ALTER TABLE "Market" ADD COLUMN IF NOT EXISTS "allowSellerSales" BOOLEAN NOT NULL DEFAULT false;
