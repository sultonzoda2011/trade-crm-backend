import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/decorators/public.decorator'
import { SupportWebhookService } from './support-webhook.service'
import { TgUpdate } from './telegram.types'

const SECRET_HEADER = 'x-telegram-bot-api-secret-token'

/**
 * Webhook'и Telegram. Публичные (JWT не нужен) и вне лимита по IP: запросы
 * идут с адресов Telegram, а подлинность проверяет секрет в заголовке.
 * Тело — `TgUpdate` (интерфейс): глобальный ValidationPipe его не трогает.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('telegram')
export class SupportController {
	constructor(private readonly webhook: SupportWebhookService) {}

	@Post('support/webhook')
	@HttpCode(200)
	support(@Headers(SECRET_HEADER) secret: string | undefined, @Body() update: TgUpdate) {
		return this.webhook.process('support', secret, update)
	}

	@Post('admin/webhook')
	@HttpCode(200)
	admin(@Headers(SECRET_HEADER) secret: string | undefined, @Body() update: TgUpdate) {
		return this.webhook.process('admin', secret, update)
	}
}
