-- Telegram-поддержка: постоянный чат на клиента, сообщения, привязка сообщений
-- Admin-бота к чатам, режим «Ответить» и журнал webhook-апдейтов.
--
-- Миграция только СОЗДАЁТ новые таблицы и индексы и повторно-запускаема
-- (IF NOT EXISTS / проверка pg_constraint). Существующие таблицы и данные не
-- трогаются; старый бэкенд на новой схеме работает как раньше.
--
-- Результат должен совпадать с тем, что создаёт `prisma db push` для моделей
-- SupportConversation, SupportMessage, SupportAdminMessage, SupportAdminState
-- и SupportUpdate из prisma/schema.prisma.
--
-- Запуск:  npm run db:support

CREATE TABLE IF NOT EXISTS "SupportConversation" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "telegramUserId" BIGINT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "languageCode" TEXT,
  "needsReply" BOOLEAN NOT NULL DEFAULT false,
  "isBlocked" BOOLEAN NOT NULL DEFAULT false,
  "botBlockedAt" TIMESTAMP(3),
  "lastInboundAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportConversation_number_key" ON "SupportConversation"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "SupportConversation_telegramUserId_key" ON "SupportConversation"("telegramUserId");
CREATE INDEX IF NOT EXISTS "SupportConversation_needsReply_lastMessageAt_idx" ON "SupportConversation"("needsReply", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "SupportConversation_lastMessageAt_idx" ON "SupportConversation"("lastMessageAt");

CREATE TABLE IF NOT EXISTS "SupportMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "text" TEXT,
  "fileName" TEXT,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "sourceFileId" TEXT,
  "targetFileId" TEXT,
  "sourceMessageId" INTEGER,
  "targetMessageId" INTEGER,
  "deliveredAt" TIMESTAMP(3),
  "deliveryError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportMessage_conversationId_direction_sourceMessageId_key" ON "SupportMessage"("conversationId", "direction", "sourceMessageId");
CREATE INDEX IF NOT EXISTS "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "SupportAdminMessage" (
  "id" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "messageId" INTEGER NOT NULL,
  "conversationId" TEXT NOT NULL,
  "hasKeyboard" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportAdminMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportAdminMessage_chatId_messageId_key" ON "SupportAdminMessage"("chatId", "messageId");
CREATE INDEX IF NOT EXISTS "SupportAdminMessage_conversationId_hasKeyboard_idx" ON "SupportAdminMessage"("conversationId", "hasKeyboard");

CREATE TABLE IF NOT EXISTS "SupportAdminState" (
  "adminTelegramId" BIGINT NOT NULL,
  "activeConversationId" TEXT,
  "activeUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportAdminState_pkey" PRIMARY KEY ("adminTelegramId")
);

CREATE TABLE IF NOT EXISTS "SupportUpdate" (
  "bot" TEXT NOT NULL,
  "updateId" BIGINT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportUpdate_pkey" PRIMARY KEY ("bot", "updateId")
);
CREATE INDEX IF NOT EXISTS "SupportUpdate_createdAt_idx" ON "SupportUpdate"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportMessage_conversationId_fkey'
  ) THEN
    ALTER TABLE "SupportMessage"
      ADD CONSTRAINT "SupportMessage_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportAdminMessage_conversationId_fkey'
  ) THEN
    ALTER TABLE "SupportAdminMessage"
      ADD CONSTRAINT "SupportAdminMessage_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
