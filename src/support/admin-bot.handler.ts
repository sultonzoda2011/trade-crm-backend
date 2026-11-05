import { Injectable, Logger } from '@nestjs/common'
import { SupportConversation } from '@prisma/client'
import {
	MENU_ALL,
	MENU_PENDING,
	cancelKeyboard,
	chatKeyboard,
	chatPrefix,
	displayName,
	formatAgo,
	formatTime,
	listButtons,
	menuKeyboard,
	parseCallback
} from './support-format.util'
import {
	NormalizedMessage,
	normalizeMessage,
	previewOf
} from './support-message.util'
import { SupportConfig } from './support.config'
import {
	ConversationWithLast,
	HISTORY_PAGE_SIZE,
	SupportService
} from './support.service'
import { ADMIN_TEXTS } from './support.texts'
import { TelegramApi, TelegramApiError } from './telegram-api.service'
import { TelegramRelay } from './telegram-relay.service'
import {
	TgCallbackQuery,
	TgMessage,
	TgReplyMarkup,
	TgUpdate
} from './telegram.types'

const START_COMMAND = /^\/(start|help)(@\w+)?(\s|$)/i

/**
 * Приватный админ-бот. Каждый апдейт и каждая кнопка проходят проверку
 * Telegram ID по TELEGRAM_ADMIN_IDS; чужим бот не отвечает вообще (не
 * подтверждает даже своё существование). Ответ клиенту всегда привязан к
 * конкретному чату: свайп-reply находит чат по сообщению, режим «Ответить»
 * хранится в БД с таймаутом, а при отсутствии цели сообщение никому не уходит.
 */
@Injectable()
export class AdminBotHandler {
	private readonly logger = new Logger(AdminBotHandler.name)

	constructor(
		private readonly service: SupportService,
		private readonly api: TelegramApi,
		private readonly relay: TelegramRelay,
		private readonly config: SupportConfig
	) {}

	async handle(update: TgUpdate): Promise<void> {
		if (update.callback_query) {
			const query = update.callback_query
			if (!this.config.isAdmin(query.from?.id)) return
			await this.handleCallback(query)
			return
		}
		const msg = update.message
		if (!msg || !msg.from || msg.chat.type !== 'private') return
		if (!this.config.isAdmin(msg.from.id)) return
		await this.handleMessage(msg)
	}

	// ── сообщения админа ─────────────────────────────────────────────────────

	private async handleMessage(msg: TgMessage): Promise<void> {
		const adminId = msg.from!.id
		const chatId = msg.chat.id
		const text = msg.text?.trim()

		if (text && START_COMMAND.test(text)) {
			await this.say(chatId, ADMIN_TEXTS.welcome, menuKeyboard)
			return
		}
		// Кнопки меню — только когда это не ответ на сообщение клиента.
		if (!msg.reply_to_message && text === MENU_PENDING) {
			await this.showList(chatId, 'pending')
			return
		}
		if (!msg.reply_to_message && text === MENU_ALL) {
			await this.showList(chatId, 'all')
			return
		}

		const conversation = await this.resolveTarget(adminId, msg)
		if (!conversation) {
			await this.say(chatId, ADMIN_TEXTS.noTarget)
			return
		}

		const normalized = normalizeMessage(msg)
		if (!normalized) {
			await this.say(chatId, ADMIN_TEXTS.unsupported)
			return
		}
		await this.deliverToClient(conversation, msg, normalized)
	}

	/** 1) свайп-reply на сообщение клиента; 2) режим «Ответить»; 3) никому. */
	private async resolveTarget(
		adminId: number,
		msg: TgMessage
	): Promise<SupportConversation | null> {
		if (msg.reply_to_message) {
			return this.service.findConversationByAdminMessage(
				msg.chat.id,
				msg.reply_to_message.message_id
			)
		}
		return this.service.getActive(adminId)
	}

	/**
	 * Ответ клиенту: «не больше одного раза». Ошибку не повторяем автоматически,
	 * чтобы не отправить клиенту дубль, а честно показываем админу.
	 */
	private async deliverToClient(
		conversation: SupportConversation,
		adminMessage: TgMessage,
		normalized: NormalizedMessage
	): Promise<void> {
		const adminChatId = adminMessage.chat.id
		const row = await this.service.recordOutbound(
			conversation.id,
			normalized,
			adminMessage.message_id
		)
		if (row.deliveredAt) return // этот ответ уже ушёл (повтор webhook)

		try {
			const result = await this.relay.relay({
				from: 'admin',
				to: 'support',
				chatId: Number(conversation.telegramUserId),
				message: normalized
			})
			await this.service.markDelivered(row.id, {
				targetMessageId: result.messageIds[0],
				targetFileId: result.fileId
			})
			await this.service.markReplied(conversation.id)
			// Режим «Ответить» продлеваем, чтобы длинный ответ в несколько
			// сообщений не оборвался на таймауте.
			if (!adminMessage.reply_to_message) {
				await this.service.setActive(adminMessage.from!.id, conversation.id)
			}
			await this.react(adminChatId, adminMessage.message_id)
		} catch (error) {
			const blocked = error instanceof TelegramApiError && error.code === 403
			await this.service.markDeliveryError(
				row.id,
				error instanceof Error ? error.message : 'delivery failed'
			)
			if (blocked) await this.service.markBotBlocked(conversation.id)
			this.logger.warn(
				`Reply to chat #${conversation.number} failed: ${error instanceof TelegramApiError ? error.message : 'unexpected error'}`
			)
			await this.say(
				adminChatId,
				`#${conversation.number}: ${blocked ? ADMIN_TEXTS.botBlocked : ADMIN_TEXTS.deliveryFailed}`
			)
		}
	}

	// ── кнопки ───────────────────────────────────────────────────────────────

	private async handleCallback(query: TgCallbackQuery): Promise<void> {
		const chatId = query.message?.chat.id ?? query.from.id
		const parsed = parseCallback(query.data)
		if (!parsed) {
			await this.answer(query.id)
			return
		}

		if (parsed.action === 'c') {
			await this.service.clearActive(query.from.id)
			await this.answer(query.id, ADMIN_TEXTS.cancelled)
			await this.stripKeyboard(chatId, query.message?.message_id)
			return
		}

		const conversation = await this.service.findByNumber(parsed.number)
		if (!conversation) {
			await this.answer(query.id, ADMIN_TEXTS.chatNotFound, true)
			return
		}

		switch (parsed.action) {
			case 'r':
				await this.service.setActive(query.from.id, conversation.id)
				await this.answer(query.id)
				await this.say(
					chatId,
					`Пишешь клиенту ${chatPrefix(conversation)}. Следующие сообщения уйдут ему (15 минут).`,
					cancelKeyboard
				)
				break

			case 'd':
				await this.service.setNeedsReply(conversation.id, false)
				await this.answer(query.id, `#${conversation.number} готово ✅`)
				await this.stripKeyboard(chatId, query.message?.message_id)
				break

			case 'b': {
				const blocking = !conversation.isBlocked
				if (blocking && this.config.isAdmin(Number(conversation.telegramUserId))) {
					await this.answer(query.id, ADMIN_TEXTS.cannotBlockAdmin, true)
					break
				}
				const updated = await this.service.setBlocked(conversation.id, blocking)
				await this.answer(
					query.id,
					blocking ? `#${conversation.number} заблокирован` : `#${conversation.number} разблокирован`
				)
				// Обновляем подпись кнопки на этом же сообщении.
				if (query.message) {
					await this.api
						.call('admin', 'editMessageReplyMarkup', {
							chat_id: chatId,
							message_id: query.message.message_id,
							reply_markup: chatKeyboard(updated)
						})
						.catch(() => undefined)
				}
				break
			}

			case 'h':
				await this.answer(query.id)
				await this.showHistory(chatId, conversation, parsed.arg)
				break

			case 'v':
				await this.answer(query.id)
				await this.showCard(chatId, conversation)
				break
		}
	}

	// ── списки, карточка, история ────────────────────────────────────────────

	private async showList(chatId: number, mode: 'pending' | 'all'): Promise<void> {
		const rows =
			mode === 'pending'
				? await this.service.listNeedingReply()
				: await this.service.listRecent()
		if (rows.length === 0) {
			await this.say(chatId, mode === 'pending' ? ADMIN_TEXTS.noPending : ADMIN_TEXTS.noChats)
			return
		}

		const title = mode === 'pending' ? '🔴 Требуют ответа' : '📋 Последние чаты'
		const lines = rows.map((row) => this.listLine(row))
		await this.say(chatId, `${title}:\n\n${lines.join('\n')}`, {
			inline_keyboard: listButtons(
				rows.map((row) => ({
					number: row.number,
					label: `${row.needsReply ? '🔴' : '✅'} #${row.number} ${displayName(row)}`
				}))
			)
		})
	}

	private listLine(row: ConversationWithLast): string {
		const last = row.messages[0]
		const preview = last ? previewOf(last.kind, last.text, 60) : 'нет сообщений'
		const who = last?.direction === 'OUT' ? '↩️ вы: ' : '💬 '
		const flag = row.needsReply ? '🔴 ' : ''
		return `${flag}#${row.number} ${displayName(row)} · ${formatAgo(row.lastMessageAt)}\n${who}${preview}`
	}

	private async showCard(chatId: number, conversation: SupportConversation): Promise<void> {
		const total = await this.service.countMessages(conversation.id)
		const status = [
			conversation.needsReply ? '🔴 ждёт ответа' : '✅ без ожидания',
			conversation.isBlocked ? '🚫 заблокирован' : null,
			conversation.botBlockedAt ? '⏸ остановил бота' : null
		]
			.filter(Boolean)
			.join(', ')
		await this.say(
			chatId,
			`${chatPrefix(conversation)}\nСообщений: ${total} · ${status}`,
			chatKeyboard(conversation)
		)
	}

	private async showHistory(
		chatId: number,
		conversation: SupportConversation,
		skip: number
	): Promise<void> {
		const { messages, hasMore } = await this.service.history(conversation.id, skip)
		if (messages.length === 0) {
			await this.say(chatId, `#${conversation.number}: сообщений нет.`)
			return
		}
		const zone = this.config.timezone
		const lines = messages.map((message) => {
			const who = message.direction === 'IN' ? '👤 Клиент' : '↩️ Вы'
			return `${who} · ${formatTime(message.createdAt, zone)}\n${previewOf(message.kind, message.text, 200)}`
		})
		const more: TgReplyMarkup | undefined = hasMore
			? {
					inline_keyboard: [
						[
							{
								text: 'Ещё (раньше)',
								callback_data: `h:${conversation.number}:${skip + HISTORY_PAGE_SIZE}`
							}
						]
					]
				}
			: undefined
		await this.say(
			chatId,
			`🗂 История ${chatPrefix(conversation)}:\n\n${lines.join('\n\n')}`,
			more
		)
	}

	// ── вспомогательное ──────────────────────────────────────────────────────

	private async say(
		chatId: number,
		text: string,
		replyMarkup?: TgReplyMarkup
	): Promise<void> {
		await this.api.call('admin', 'sendMessage', {
			chat_id: chatId,
			text,
			...(replyMarkup ? { reply_markup: replyMarkup } : {})
		})
	}

	private async answer(id: string, text?: string, alert = false): Promise<void> {
		await this.api
			.call('admin', 'answerCallbackQuery', {
				callback_query_id: id,
				...(text ? { text, show_alert: alert } : {})
			})
			.catch(() => undefined)
	}

	private async stripKeyboard(chatId: number, messageId?: number): Promise<void> {
		if (!messageId) return
		await this.api
			.call('admin', 'editMessageReplyMarkup', {
				chat_id: chatId,
				message_id: messageId,
				reply_markup: { inline_keyboard: [] }
			})
			.catch(() => undefined)
	}

	/** Подтверждение доставки: 👍 на сообщение админа (без лишнего текста в чате). */
	private async react(chatId: number, messageId: number): Promise<void> {
		await this.api
			.call('admin', 'setMessageReaction', {
				chat_id: chatId,
				message_id: messageId,
				reaction: [{ type: 'emoji', emoji: '👍' }]
			})
			.catch(() => undefined)
	}
}
