import { Injectable, Logger } from '@nestjs/common'
import { SupportConversation, SupportMessage } from '@prisma/client'
import { chatKeyboard, chatPrefix } from './support-format.util'
import { NormalizedMessage, normalizeMessage } from './support-message.util'
import { SupportConfig } from './support.config'
import {
	ACK_PAUSE_HOURS,
	SupportService
} from './support.service'
import { SUPPORT_TEXTS } from './support.texts'
import { TelegramApi, TelegramApiError } from './telegram-api.service'
import { TelegramRelay } from './telegram-relay.service'
import { TgUpdate } from './telegram.types'

const START_COMMAND = /^\/(start|help)(@\w+)?(\s|$)/i

/**
 * Публичный бот: клиент просто пишет, без команд и категорий. Права особым
 * ID не даются: даже если ID совпадает с админским, здесь он обычный клиент.
 */
@Injectable()
export class SupportBotHandler {
	private readonly logger = new Logger(SupportBotHandler.name)

	constructor(
		private readonly service: SupportService,
		private readonly api: TelegramApi,
		private readonly relay: TelegramRelay,
		private readonly config: SupportConfig
	) {}

	async handle(update: TgUpdate): Promise<void> {
		const msg = update.message
		// Только личные чаты с людьми; правки, группы и callback'и игнорируем.
		if (!msg || !msg.from || msg.from.is_bot || msg.chat.type !== 'private') return

		const text = msg.text?.trim()
		if (text && START_COMMAND.test(text)) {
			await this.service.upsertContact(msg.from)
			await this.say(msg.chat.id, SUPPORT_TEXTS.greeting)
			return
		}

		const normalized = normalizeMessage(msg)
		if (!normalized) {
			await this.say(msg.chat.id, SUPPORT_TEXTS.unsupported)
			return
		}

		const conversation = await this.service.upsertContact(msg.from)
		if (conversation.isBlocked) return
		if (await this.service.isRateLimited(conversation.id)) return

		const { row, created } = await this.service.recordInbound(
			conversation.id,
			normalized,
			msg.message_id
		)
		await this.service.touchInbound(conversation.id)

		if (created && this.shouldAck(conversation)) {
			await this.say(msg.chat.id, SUPPORT_TEXTS.received)
		}
		if (!row.deliveredAt) {
			await this.forwardToAdmins(conversation, row, normalized)
		}
	}

	/** «Принято» — на первое сообщение и после паузы больше суток, не на каждое. */
	private shouldAck(conversation: SupportConversation): boolean {
		if (!conversation.lastInboundAt) return true
		const pause = ACK_PAUSE_HOURS * 3600 * 1000
		return Date.now() - conversation.lastInboundAt.getTime() > pause
	}

	private async forwardToAdmins(
		conversation: SupportConversation,
		row: SupportMessage,
		message: NormalizedMessage
	): Promise<void> {
		const adminIds = this.config.adminIds
		if (adminIds.length === 0) {
			this.logger.warn('TELEGRAM_ADMIN_IDS is empty: message saved, not forwarded')
			return
		}

		const prefix = chatPrefix(conversation)
		const replyMarkup = chatKeyboard(conversation)
		let delivered = false
		let firstError: unknown

		for (const adminId of adminIds) {
			try {
				// Кнопки живут только на последнем сообщении чата: со старых снимаем.
				const old = await this.service.takeKeyboardMessages(adminId, conversation.id)
				for (const messageId of old) {
					await this.api
						.call('admin', 'editMessageReplyMarkup', {
							chat_id: adminId,
							message_id: messageId,
							reply_markup: { inline_keyboard: [] }
						})
						.catch(() => undefined)
				}

				const result = await this.relay.relay({
					from: 'support',
					to: 'admin',
					chatId: adminId,
					message,
					prefix,
					replyMarkup
				})
				await this.service.saveAdminMessages(adminId, conversation.id, result.messageIds)
				if (!delivered) {
					await this.service.markDelivered(row.id, {
						targetMessageId: result.messageIds[0],
						targetFileId: result.fileId
					})
				}
				delivered = true
			} catch (error) {
				firstError ??= error
				this.logger.warn(
					`Forward to admin failed: ${error instanceof TelegramApiError ? error.message : 'unexpected error'}`
				)
			}
		}

		// Ни одному админу не дошло: пусть Telegram повторит webhook (до 3 раз).
		// Сообщение уже в БД и видно в «Требуют ответа».
		if (!delivered) throw firstError
	}

	private async say(chatId: number, text: string): Promise<void> {
		await this.api.call('support', 'sendMessage', { chat_id: chatId, text })
	}
}
