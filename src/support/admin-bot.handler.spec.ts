import { AdminBotHandler } from './admin-bot.handler'
import { MENU_PENDING } from './support-format.util'
import { TelegramApiError } from './telegram-api.service'

const ADMIN = 1000000001
const conv = (over: Record<string, unknown> = {}) => ({
	id: 'c1',
	number: 12,
	telegramUserId: BigInt(555),
	username: 'ali',
	firstName: 'Али',
	lastName: null,
	isBlocked: false,
	needsReply: true,
	botBlockedAt: null,
	lastMessageAt: new Date(),
	...over
})

describe('AdminBotHandler', () => {
	let service: any
	let api: { call: jest.Mock }
	let relay: { relay: jest.Mock }
	let config: any
	let handler: AdminBotHandler

	beforeEach(() => {
		service = {
			findConversationByAdminMessage: jest.fn().mockResolvedValue(null),
			getActive: jest.fn().mockResolvedValue(null),
			findByNumber: jest.fn().mockResolvedValue(conv()),
			recordOutbound: jest.fn().mockResolvedValue({ id: 'm1', deliveredAt: null }),
			markDelivered: jest.fn().mockResolvedValue(undefined),
			markDeliveryError: jest.fn().mockResolvedValue(undefined),
			markBotBlocked: jest.fn().mockResolvedValue(undefined),
			markReplied: jest.fn().mockResolvedValue(undefined),
			setActive: jest.fn().mockResolvedValue(undefined),
			clearActive: jest.fn().mockResolvedValue(undefined),
			setNeedsReply: jest.fn().mockResolvedValue(undefined),
			setBlocked: jest.fn().mockImplementation(async (_id, isBlocked) => conv({ isBlocked })),
			listNeedingReply: jest.fn().mockResolvedValue([]),
			listRecent: jest.fn().mockResolvedValue([]),
			history: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
			countMessages: jest.fn().mockResolvedValue(3)
		}
		api = { call: jest.fn().mockResolvedValue({ message_id: 1 }) }
		relay = { relay: jest.fn().mockResolvedValue({ messageIds: [900], fileId: null, tooLarge: false }) }
		config = {
			isAdmin: (id?: number) => id === ADMIN,
			timezone: 'Asia/Dushanbe'
		}
		handler = new AdminBotHandler(service, api as any, relay as any, config)
	})

	const message = (over: Record<string, unknown> = {}, fromId = ADMIN) => ({
		update_id: 1,
		message: {
			message_id: 50,
			from: { id: fromId },
			chat: { id: fromId, type: 'private' },
			text: 'ответ',
			...over
		}
	})
	const callback = (data: string, fromId = ADMIN) => ({
		update_id: 2,
		callback_query: {
			id: 'q1',
			from: { id: fromId },
			data,
			message: { message_id: 60, chat: { id: fromId, type: 'private' } }
		}
	})

	describe('access control', () => {
		it('a stranger gets no reply, no DB access and nothing is sent to clients', async () => {
			await handler.handle(message({}, 999) as any)
			await handler.handle(message({ text: '/start' }, 999) as any)
			await handler.handle(message({ reply_to_message: { message_id: 1 } }, 999) as any)
			expect(api.call).not.toHaveBeenCalled()
			expect(relay.relay).not.toHaveBeenCalled()
			expect(service.findConversationByAdminMessage).not.toHaveBeenCalled()
			expect(service.recordOutbound).not.toHaveBeenCalled()
		})

		it('a stranger cannot press buttons (reply, done, block, history)', async () => {
			for (const data of ['r:12', 'd:12', 'b:12', 'h:12:0', 'v:12']) {
				await handler.handle(callback(data, 999) as any)
			}
			expect(service.findByNumber).not.toHaveBeenCalled()
			expect(service.setActive).not.toHaveBeenCalled()
			expect(service.setNeedsReply).not.toHaveBeenCalled()
			expect(service.setBlocked).not.toHaveBeenCalled()
			expect(api.call).not.toHaveBeenCalled()
		})

		it('messages from a group chat are ignored even from an admin', async () => {
			const update = message() as any
			update.message.chat.type = 'group'
			await handler.handle(update)
			expect(relay.relay).not.toHaveBeenCalled()
		})
	})

	describe('routing a reply to the right chat', () => {
		it('swipe-reply goes to the chat of the replied-to message, not the active one', async () => {
			service.findConversationByAdminMessage.mockResolvedValue(conv({ id: 'c-swipe', number: 5, telegramUserId: BigInt(111) }))
			service.getActive.mockResolvedValue(conv({ id: 'c-active', telegramUserId: BigInt(222) }))

			await handler.handle(message({ reply_to_message: { message_id: 77 } }) as any)

			expect(service.findConversationByAdminMessage).toHaveBeenCalledWith(ADMIN, 77)
			expect(relay.relay).toHaveBeenCalledWith(
				expect.objectContaining({ from: 'admin', to: 'support', chatId: 111 })
			)
			expect(service.recordOutbound).toHaveBeenCalledWith('c-swipe', expect.anything(), 50)
		})

		it('swipe-reply on an unknown message sends nothing (never falls back to "the last chat")', async () => {
			service.findConversationByAdminMessage.mockResolvedValue(null)
			service.getActive.mockResolvedValue(conv())
			await handler.handle(message({ reply_to_message: { message_id: 77 } }) as any)
			expect(relay.relay).not.toHaveBeenCalled()
			expect(api.call.mock.calls[0][2].text).toContain('Сообщение никому не отправлено')
		})

		it('without reply, the active "Ответить" mode is used', async () => {
			service.getActive.mockResolvedValue(conv({ telegramUserId: BigInt(333) }))
			await handler.handle(message() as any)
			expect(relay.relay).toHaveBeenCalledWith(expect.objectContaining({ chatId: 333 }))
		})

		it('no reply and no active mode (or it expired): hint, nothing sent to any client', async () => {
			service.getActive.mockResolvedValue(null)
			await handler.handle(message() as any)
			expect(relay.relay).not.toHaveBeenCalled()
			expect(service.recordOutbound).not.toHaveBeenCalled()
			expect(api.call).toHaveBeenCalledWith('admin', 'sendMessage', expect.objectContaining({ chat_id: ADMIN }))
		})

		it('a successful reply clears "needs reply" and reacts with 👍', async () => {
			service.findConversationByAdminMessage.mockResolvedValue(conv())
			await handler.handle(message({ reply_to_message: { message_id: 77 } }) as any)
			expect(service.markDelivered).toHaveBeenCalledWith('m1', { targetMessageId: 900, targetFileId: null })
			expect(service.markReplied).toHaveBeenCalledWith('c1')
			expect(api.call).toHaveBeenCalledWith(
				'admin',
				'setMessageReaction',
				expect.objectContaining({ message_id: 50 })
			)
		})

		it('a repeated delivery of the same webhook does not send twice', async () => {
			service.findConversationByAdminMessage.mockResolvedValue(conv())
			service.recordOutbound.mockResolvedValue({ id: 'm1', deliveredAt: new Date() })
			await handler.handle(message({ reply_to_message: { message_id: 77 } }) as any)
			expect(relay.relay).not.toHaveBeenCalled()
		})

		it('an unsupported type is not sent to the client', async () => {
			service.getActive.mockResolvedValue(conv())
			await handler.handle(message({ text: undefined, poll: {} }) as any)
			expect(relay.relay).not.toHaveBeenCalled()
		})
	})

	describe('delivery failures', () => {
		it('403 from Telegram: marks the client as having stopped the bot and tells the admin', async () => {
			service.findConversationByAdminMessage.mockResolvedValue(conv())
			relay.relay.mockRejectedValue(new TelegramApiError('sendMessage', 403, 'Forbidden: bot was blocked by the user'))
			await handler.handle(message({ reply_to_message: { message_id: 77 } }) as any)
			expect(service.markBotBlocked).toHaveBeenCalledWith('c1')
			expect(service.markReplied).not.toHaveBeenCalled()
			const text = api.call.mock.calls.at(-1)![2].text
			expect(text).toContain('#12')
			expect(text).toContain('заблокировал')
		})

		it('other errors are shown to the admin and are not retried automatically', async () => {
			service.findConversationByAdminMessage.mockResolvedValue(conv())
			relay.relay.mockRejectedValue(new TelegramApiError('sendMessage', 500, 'oops'))
			await expect(
				handler.handle(message({ reply_to_message: { message_id: 77 } }) as any)
			).resolves.toBeUndefined()
			expect(relay.relay).toHaveBeenCalledTimes(1)
			expect(service.markDeliveryError).toHaveBeenCalled()
			expect(service.markBotBlocked).not.toHaveBeenCalled()
		})
	})

	describe('buttons', () => {
		it('"Ответить" turns on the reply mode for that chat', async () => {
			await handler.handle(callback('r:12') as any)
			expect(service.findByNumber).toHaveBeenCalledWith(12)
			expect(service.setActive).toHaveBeenCalledWith(ADMIN, 'c1')
		})

		it('"✅ Готово" clears needsReply', async () => {
			await handler.handle(callback('d:12') as any)
			expect(service.setNeedsReply).toHaveBeenCalledWith('c1', false)
		})

		it('"✖️ Отмена" turns the mode off', async () => {
			await handler.handle(callback('c:0') as any)
			expect(service.clearActive).toHaveBeenCalledWith(ADMIN)
		})

		it('blocks and unblocks a client', async () => {
			await handler.handle(callback('b:12') as any)
			expect(service.setBlocked).toHaveBeenCalledWith('c1', true)
			service.findByNumber.mockResolvedValue(conv({ isBlocked: true }))
			await handler.handle(callback('b:12') as any)
			expect(service.setBlocked).toHaveBeenLastCalledWith('c1', false)
		})

		it('an admin cannot block an account that is an admin (testing from one account)', async () => {
			service.findByNumber.mockResolvedValue(conv({ telegramUserId: BigInt(ADMIN) }))
			await handler.handle(callback('b:12') as any)
			expect(service.setBlocked).not.toHaveBeenCalled()
		})

		it('a stale button for a deleted chat answers "not found"', async () => {
			service.findByNumber.mockResolvedValue(null)
			await handler.handle(callback('d:99') as any)
			expect(service.setNeedsReply).not.toHaveBeenCalled()
			expect(api.call).toHaveBeenCalledWith(
				'admin',
				'answerCallbackQuery',
				expect.objectContaining({ show_alert: true })
			)
		})

		it('garbage callback data is ignored', async () => {
			await handler.handle(callback('r:12;DROP') as any)
			await handler.handle(callback('zzz') as any)
			expect(service.findByNumber).not.toHaveBeenCalled()
		})

		it('history pages through older messages', async () => {
			service.history.mockResolvedValue({
				messages: [
					{ direction: 'IN', kind: 'text', text: 'привет', createdAt: new Date('2026-11-05T10:00:00Z') },
					{ direction: 'OUT', kind: 'photo', text: null, createdAt: new Date('2026-11-05T10:05:00Z') }
				],
				hasMore: true
			})
			await handler.handle(callback('h:12:10') as any)
			expect(service.history).toHaveBeenCalledWith('c1', 10)
			const sent = api.call.mock.calls.find(([, m]) => m === 'sendMessage')![2]
			expect(sent.text).toContain('Клиент')
			expect(sent.text).toContain('[фото]')
			expect(sent.reply_markup.inline_keyboard[0][0].callback_data).toBe('h:12:20')
		})
	})

	describe('menu', () => {
		it('"Требуют ответа" lists chats waiting for a reply', async () => {
			service.listNeedingReply.mockResolvedValue([
				{ ...conv(), messages: [{ direction: 'IN', kind: 'text', text: 'нужен доступ', createdAt: new Date() }] }
			])
			await handler.handle(message({ text: MENU_PENDING }) as any)
			const sent = api.call.mock.calls[0][2]
			expect(sent.text).toContain('#12 Али')
			expect(sent.reply_markup.inline_keyboard[0][0].callback_data).toBe('v:12')
		})

		it('menu text sent as a swipe-reply is a reply to the client, not a menu command', async () => {
			service.findConversationByAdminMessage.mockResolvedValue(conv())
			await handler.handle(message({ text: MENU_PENDING, reply_to_message: { message_id: 77 } }) as any)
			expect(service.listNeedingReply).not.toHaveBeenCalled()
			expect(relay.relay).toHaveBeenCalled()
		})
	})
})
