import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BotName } from './telegram.types'

/**
 * Настройки поддержки из env. Секреты (токены ботов, секреты webhook) читаются
 * только отсюда и нигде не логируются. Пока переменная не задана, бот
 * «выключен»: webhook отвечает 401, исходящие вызовы падают с понятной ошибкой.
 */
@Injectable()
export class SupportConfig {
	constructor(private readonly config: ConfigService) {}

	token(bot: BotName): string | undefined {
		return this.read(bot === 'support' ? 'SUPPORT_BOT_TOKEN' : 'ADMIN_BOT_TOKEN')
	}

	webhookSecret(bot: BotName): string | undefined {
		return this.read(
			bot === 'support' ? 'SUPPORT_WEBHOOK_SECRET' : 'ADMIN_WEBHOOK_SECRET'
		)
	}

	/** Разрешённые Telegram user ID админов (`TELEGRAM_ADMIN_IDS=1,2`). */
	get adminIds(): number[] {
		const raw = this.read('TELEGRAM_ADMIN_IDS') ?? ''
		return raw
			.split(',')
			.map((part) => Number(part.trim()))
			.filter((id) => Number.isSafeInteger(id) && id > 0)
	}

	isAdmin(telegramUserId: number | undefined): boolean {
		return telegramUserId !== undefined && this.adminIds.includes(telegramUserId)
	}

	/** Часовой пояс времени в «Истории» (по умолчанию Душанбе). */
	get timezone(): string {
		return this.read('SUPPORT_TIMEZONE') ?? 'Asia/Dushanbe'
	}

	private read(key: string): string | undefined {
		const value = this.config.get<string>(key)
		return value && value.trim() ? value.trim() : undefined
	}
}
