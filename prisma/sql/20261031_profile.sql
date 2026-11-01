-- Профиль: телефон и дата последней смены пароля.
--
-- Миграция только ДОБАВЛЯЕТ и повторно-запускаема (IF NOT EXISTS), в том числе
-- если колонки раньше создал `prisma db push`. Старый бэкенд на новой схеме
-- продолжает работать: обе колонки nullable.
--
-- Запуск:  npm run db:profile
--
-- Данные не трогаем: у существующих пользователей phone и passwordChangedAt = NULL
-- («телефон не указан», «пароль не менялся»).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
