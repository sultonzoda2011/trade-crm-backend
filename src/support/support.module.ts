import { Module } from '@nestjs/common'
import { AdminBotHandler } from './admin-bot.handler'
import { SupportBotHandler } from './support-bot.handler'
import { SupportConfig } from './support.config'
import { SupportController } from './support.controller'
import { SupportService } from './support.service'
import { SupportWebhookService } from './support-webhook.service'
import { TelegramApi } from './telegram-api.service'
import { TelegramRelay } from './telegram-relay.service'

@Module({
	controllers: [SupportController],
	providers: [
		SupportConfig,
		SupportService,
		TelegramApi,
		TelegramRelay,
		SupportBotHandler,
		AdminBotHandler,
		SupportWebhookService
	]
})
export class SupportModule {}
