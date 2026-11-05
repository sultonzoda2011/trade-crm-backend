import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	Logger,
	UnauthorizedException
} from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { AdminBotHandler } from './admin-bot.handler'
import { SupportBotHandler } from './support-bot.handler'
import { SupportConfig } from './support.config'
import { SupportService } from './support.service'
import { BotName, TgUpdate } from './telegram.types'

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Вход webhook'ов: проверка секрета, защита от повторной доставки и политика
 * ошибок. Ошибка обработки → 500, Telegram повторит; после третьей попытки
 * отвечаем 200, чтобы один сломанный апдейт не держал очередь.
 */
@Injectable()
export class SupportWebhookService {
	private readonly logger = new Logger(SupportWebhookService.name)

	constructor(
		private readonly config: SupportConfig,
		private readonly service: SupportService,
		private readonly supportBot: SupportBotHandler,
		private readonly adminBot: AdminBotHandler
	) {}

	async process(
		bot: BotName,
		providedSecret: string | undefined,
		update: TgUpdate
	): Promise<{ ok: true }> {
		this.verifySecret(bot, providedSecret)
		if (!update || typeof update.update_id !== 'number') {
			throw new BadRequestException('Invalid update')
		}

		const decision = await this.service.beginUpdate(bot, update.update_id)
		if (decision === 'skip') return { ok: true }

		try {
			if (bot === 'support') await this.supportBot.handle(update)
			else await this.adminBot.handle(update)
			await this.service.finishUpdate(bot, update.update_id)
			return { ok: true }
		} catch (error) {
			// В лог — только первая строка сообщения: Prisma-ошибки могут цитировать
			// данные запроса (в том числе текст клиента).
			const reason = (error instanceof Error ? error.message : 'unknown error')
				.split('\n')[0]
				.slice(0, 200)
			this.logger.error(`${bot} update ${update.update_id} failed: ${reason}`)
			if (decision === 'last') {
				await this.service.finishUpdate(bot, update.update_id).catch(() => undefined)
				return { ok: true }
			}
			throw new InternalServerErrorException()
		}
	}

	/** Fail-closed: без настроенного секрета webhook не принимает ничего. */
	private verifySecret(bot: BotName, provided: string | undefined): void {
		const expected = this.config.webhookSecret(bot)
		if (!expected) {
			this.logger.error(`${bot} webhook secret is not configured`)
			throw new UnauthorizedException()
		}
		if (!provided || !timingSafeEqual(digest(expected), digest(provided))) {
			throw new UnauthorizedException()
		}
	}
}
