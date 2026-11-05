import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Prisma, SupportConversation, SupportMessage } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { NormalizedMessage } from './support-message.util'
import { BotName, TgUser } from './telegram.types'

export const MESSAGES_PER_MINUTE = 20
export const ACTIVE_REPLY_MINUTES = 15
export const ACK_PAUSE_HOURS = 24
export const MAX_UPDATE_ATTEMPTS = 3
export const HISTORY_PAGE_SIZE = 10
export const LIST_SIZE = 10

export type UpdateDecision = 'process' | 'last' | 'skip'

export type ConversationWithLast = SupportConversation & {
	messages: Pick<SupportMessage, 'direction' | 'kind' | 'text' | 'createdAt'>[]
}

const isUniqueViolation = (error: unknown): boolean =>
	error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'

/** Все обращения к БД поддержки. Бизнес-правила ботов живут в handlers. */
@Injectable()
export class SupportService implements OnModuleInit {
	private readonly logger = new Logger(SupportService.name)

	constructor(private readonly prisma: PrismaService) {}

	/** Чистим журнал webhook-апдейтов старше недели (try/catch: миграция может быть не применена). */
	async onModuleInit() {
		try {
			await this.prisma.supportUpdate.deleteMany({
				where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }
			})
		} catch (error) {
			this.logger.warn(
				`SupportUpdate cleanup skipped: ${(error as Error).message.split('\n')[0]}`
			)
		}
	}

	// ── идемпотентность webhook ──────────────────────────────────────────────

	/**
	 * `process` — обработать; `last` — последняя попытка (при ошибке отвечаем 200
	 * и сдаёмся, чтобы один «ядовитый» апдейт не блокировал очередь Telegram);
	 * `skip` — уже обработан.
	 */
	async beginUpdate(bot: BotName, updateId: number): Promise<UpdateDecision> {
		const key = { bot_updateId: { bot, updateId: BigInt(updateId) } }
		try {
			await this.prisma.supportUpdate.create({
				data: { bot, updateId: BigInt(updateId) }
			})
			return 'process'
		} catch (error) {
			if (!isUniqueViolation(error)) throw error
		}
		const existing = await this.prisma.supportUpdate.findUnique({ where: key })
		if (!existing || existing.done) return 'skip'
		const updated = await this.prisma.supportUpdate.update({
			where: key,
			data: { attempts: { increment: 1 } }
		})
		return updated.attempts >= MAX_UPDATE_ATTEMPTS ? 'last' : 'process'
	}

	async finishUpdate(bot: BotName, updateId: number) {
		await this.prisma.supportUpdate.updateMany({
			where: { bot, updateId: BigInt(updateId) },
			data: { done: true }
		})
	}

	// ── клиенты и чаты ───────────────────────────────────────────────────────

	/** Создаёт чат клиента при первом сообщении и обновляет его профиль Telegram. */
	upsertContact(from: TgUser): Promise<SupportConversation> {
		const profile = {
			username: from.username ?? null,
			firstName: from.first_name ?? null,
			lastName: from.last_name ?? null,
			languageCode: from.language_code ?? null
		}
		return this.prisma.supportConversation.upsert({
			where: { telegramUserId: BigInt(from.id) },
			create: { telegramUserId: BigInt(from.id), ...profile },
			update: profile
		})
	}

	findByNumber(number: number) {
		return this.prisma.supportConversation.findUnique({ where: { number } })
	}

	findById(id: string) {
		return this.prisma.supportConversation.findUnique({ where: { id } })
	}

	async isRateLimited(conversationId: string): Promise<boolean> {
		const recent = await this.prisma.supportMessage.count({
			where: {
				conversationId,
				direction: 'IN',
				createdAt: { gte: new Date(Date.now() - 60_000) }
			}
		})
		return recent >= MESSAGES_PER_MINUTE
	}

	setBlocked(id: string, isBlocked: boolean) {
		return this.prisma.supportConversation.update({
			where: { id },
			data: { isBlocked }
		})
	}

	setNeedsReply(id: string, needsReply: boolean) {
		return this.prisma.supportConversation.update({
			where: { id },
			data: { needsReply }
		})
	}

	markBotBlocked(id: string) {
		return this.prisma.supportConversation.update({
			where: { id },
			data: { botBlockedAt: new Date() }
		})
	}

	// ── сообщения ────────────────────────────────────────────────────────────

	/**
	 * Сохраняет сообщение клиента. Повторная доставка того же webhook находит
	 * уже сохранённую строку (unique по сообщению клиента) и не создаёт дубль.
	 */
	async recordInbound(
		conversationId: string,
		message: NormalizedMessage,
		sourceMessageId: number
	): Promise<{ row: SupportMessage; created: boolean }> {
		try {
			const row = await this.prisma.supportMessage.create({
				data: {
					conversationId,
					direction: 'IN',
					kind: message.kind,
					text: message.text,
					fileName: message.fileName,
					mimeType: message.mimeType,
					fileSize: message.fileSize,
					sourceFileId: message.fileId,
					sourceMessageId
				}
			})
			return { row, created: true }
		} catch (error) {
			if (!isUniqueViolation(error)) throw error
			const row = await this.prisma.supportMessage.findUniqueOrThrow({
				where: {
					conversationId_direction_sourceMessageId: {
						conversationId,
						direction: 'IN',
						sourceMessageId
					}
				}
			})
			return { row, created: false }
		}
	}

	/** Клиент написал: чат ждёт ответа, бот снова доступен. */
	touchInbound(conversationId: string) {
		const now = new Date()
		return this.prisma.supportConversation.update({
			where: { id: conversationId },
			data: {
				needsReply: true,
				botBlockedAt: null,
				lastInboundAt: now,
				lastMessageAt: now
			}
		})
	}

	/** Сохраняет ответ админа до отправки; повтор того же сообщения вернёт ту же строку. */
	async recordOutbound(
		conversationId: string,
		message: NormalizedMessage,
		sourceMessageId: number
	): Promise<SupportMessage> {
		try {
			return await this.prisma.supportMessage.create({
				data: {
					conversationId,
					direction: 'OUT',
					kind: message.kind,
					text: message.text,
					fileName: message.fileName,
					mimeType: message.mimeType,
					fileSize: message.fileSize,
					sourceFileId: message.fileId,
					sourceMessageId
				}
			})
		} catch (error) {
			if (!isUniqueViolation(error)) throw error
			return this.prisma.supportMessage.findUniqueOrThrow({
				where: {
					conversationId_direction_sourceMessageId: {
						conversationId,
						direction: 'OUT',
						sourceMessageId
					}
				}
			})
		}
	}

	markDelivered(
		id: string,
		data: { targetMessageId?: number; targetFileId?: string | null }
	) {
		return this.prisma.supportMessage.update({
			where: { id },
			data: {
				deliveredAt: new Date(),
				deliveryError: null,
				targetMessageId: data.targetMessageId,
				targetFileId: data.targetFileId ?? undefined
			}
		})
	}

	markDeliveryError(id: string, error: string) {
		return this.prisma.supportMessage.update({
			where: { id },
			data: { deliveryError: error.slice(0, 300) }
		})
	}

	/** После успешного ответа: клиент ответ получил, чат больше не ждёт. */
	async markReplied(conversationId: string) {
		await this.prisma.supportConversation.update({
			where: { id: conversationId },
			data: { needsReply: false, lastMessageAt: new Date() }
		})
	}

	// ── связь «сообщение в Admin-боте → чат» ──────────────────────────────────

	async saveAdminMessages(
		chatId: number,
		conversationId: string,
		messageIds: number[]
	) {
		if (messageIds.length === 0) return
		const lastId = messageIds[messageIds.length - 1]
		await this.prisma.supportAdminMessage.createMany({
			data: messageIds.map((messageId) => ({
				chatId: BigInt(chatId),
				messageId,
				conversationId,
				hasKeyboard: messageId === lastId
			})),
			skipDuplicates: true
		})
	}

	/** Сообщения этого чата с inline-кнопками, у которых их надо снять. */
	async takeKeyboardMessages(chatId: number, conversationId: string): Promise<number[]> {
		const rows = await this.prisma.supportAdminMessage.findMany({
			where: { chatId: BigInt(chatId), conversationId, hasKeyboard: true },
			select: { id: true, messageId: true }
		})
		if (rows.length === 0) return []
		await this.prisma.supportAdminMessage.updateMany({
			where: { id: { in: rows.map((row) => row.id) } },
			data: { hasKeyboard: false }
		})
		return rows.map((row) => row.messageId)
	}

	async findConversationByAdminMessage(chatId: number, messageId: number) {
		const row = await this.prisma.supportAdminMessage.findUnique({
			where: { chatId_messageId: { chatId: BigInt(chatId), messageId } },
			include: { conversation: true }
		})
		return row?.conversation ?? null
	}

	// ── режим «Ответить» ─────────────────────────────────────────────────────

	async setActive(adminTelegramId: number, conversationId: string) {
		const activeUntil = new Date(Date.now() + ACTIVE_REPLY_MINUTES * 60_000)
		await this.prisma.supportAdminState.upsert({
			where: { adminTelegramId: BigInt(adminTelegramId) },
			create: {
				adminTelegramId: BigInt(adminTelegramId),
				activeConversationId: conversationId,
				activeUntil
			},
			update: { activeConversationId: conversationId, activeUntil }
		})
	}

	async clearActive(adminTelegramId: number) {
		await this.prisma.supportAdminState.updateMany({
			where: { adminTelegramId: BigInt(adminTelegramId) },
			data: { activeConversationId: null, activeUntil: null }
		})
	}

	/** Активный чат админа или null, если режим выключен или истёк. */
	async getActive(adminTelegramId: number): Promise<SupportConversation | null> {
		const state = await this.prisma.supportAdminState.findUnique({
			where: { adminTelegramId: BigInt(adminTelegramId) }
		})
		if (
			!state?.activeConversationId ||
			!state.activeUntil ||
			state.activeUntil.getTime() <= Date.now()
		) {
			return null
		}
		return this.findById(state.activeConversationId)
	}

	// ── списки и история для Admin-бота ───────────────────────────────────────

	listNeedingReply(): Promise<ConversationWithLast[]> {
		return this.prisma.supportConversation.findMany({
			where: { needsReply: true, isBlocked: false },
			orderBy: { lastMessageAt: 'asc' },
			take: LIST_SIZE,
			include: this.lastMessageInclude()
		})
	}

	listRecent(): Promise<ConversationWithLast[]> {
		return this.prisma.supportConversation.findMany({
			orderBy: { lastMessageAt: 'desc' },
			take: LIST_SIZE,
			include: this.lastMessageInclude()
		})
	}

	countNeedingReply() {
		return this.prisma.supportConversation.count({
			where: { needsReply: true, isBlocked: false }
		})
	}

	/** Страница истории: `skip` сообщений от самого свежего; внутри страницы — по времени. */
	async history(conversationId: string, skip: number) {
		const rows = await this.prisma.supportMessage.findMany({
			where: { conversationId },
			orderBy: { createdAt: 'desc' },
			skip,
			take: HISTORY_PAGE_SIZE + 1
		})
		return {
			messages: rows.slice(0, HISTORY_PAGE_SIZE).reverse(),
			hasMore: rows.length > HISTORY_PAGE_SIZE
		}
	}

	countMessages(conversationId: string) {
		return this.prisma.supportMessage.count({ where: { conversationId } })
	}

	private lastMessageInclude() {
		return {
			messages: {
				orderBy: { createdAt: 'desc' as const },
				take: 1,
				select: { direction: true, kind: true, text: true, createdAt: true }
			}
		}
	}
}
