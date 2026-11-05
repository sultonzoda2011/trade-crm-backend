import { SupportBotHandler } from './support-bot.handler'

const ADMIN = 1000000001
const conv = (over: Record<string, unknown> = {}) => ({
	id: 'c1',
	number: 12,
	telegramUserId: BigInt(555),
	username: 'ali',
	firstName: 'Али',
	lastName: null,
	isBlocked: false,
	needsReply: false,
	lastInboundAt: null,
	...over
})

describe('SupportBotHandler', () => {
	let service: any
	let api: { call: jest.Mock }
	let relay: { relay: jest.Mock }
	let config: any
	let handler: SupportBotHandler

	beforeEach(() => {
		service = {
			upsertContact: jest.fn().mockResolvedValue(conv()),
			isRateLimited: jest.fn().mockResolvedValue(false),
			recordInbound: jest.fn().mockResolvedValue({ row: { id: 'm1', deliveredAt: null }, created: true }),
			touchInbound: jest.fn().mockResolvedValue(undefined),
			takeKeyboardMessages: jest.fn().mockResolvedValue([]),
			saveAdminMessages: jest.fn().mockResolvedValue(undefined),
			markDelivered: jest.fn().mockResolvedValue(undefined)
		}
		api = { call: jest.fn().mockResolvedValue({}) }
		relay = { relay: jest.fn().mockResolvedValue({ messageIds: [900, 901], fileId: 'af', tooLarge: false }) }
		config = { adminIds: [ADMIN] }
		handler = new SupportBotHandler(service, api as any, relay as any, config)
	})

	const update = (over: Record<string, unknown> = {}, fromId = 555) => ({
		update_id: 1,
		message: {
			message_id: 10,
			from: { id: fromId, first_name: 'Али', username: 'ali' },
			chat: { id: fromId, type: 'private' },
			text: 'Нужен доступ',
			...over
		}
	})

	it('/start greets and registers the client but creates no message', async () => {
		await handler.handle(update({ text: '/start' }) as any)
		expect(service.upsertContact).toHaveBeenCalled()
		expect(service.recordInbound).not.toHaveBeenCalled()
		expect(api.call).toHaveBeenCalledWith('support', 'sendMessage', expect.objectContaining({ chat_id: 555 }))
	})

	it('a client message is saved, acknowledged and forwarded with chat number and keyboard', async () => {
		await handler.handle(update() as any)
		expect(service.recordInbound).toHaveBeenCalledWith('c1', expect.objectContaining({ kind: 'text', text: 'Нужен доступ' }), 10)
		expect(service.touchInbound).toHaveBeenCalledWith('c1')
		expect(api.call).toHaveBeenCalledWith('support', 'sendMessage', expect.objectContaining({ text: expect.stringContaining('Принято') }))
		const call = relay.relay.mock.calls[0][0]
		expect(call).toMatchObject({ from: 'support', to: 'admin', chatId: ADMIN })
		expect(call.prefix).toBe('#12 Али (@ali)')
		expect(call.replyMarkup.inline_keyboard[0][0].callback_data).toBe('r:12')
		expect(service.saveAdminMessages).toHaveBeenCalledWith(ADMIN, 'c1', [900, 901])
		expect(service.markDelivered).toHaveBeenCalledWith('m1', { targetMessageId: 900, targetFileId: 'af' })
	})

	it('old inline buttons of that chat are removed before the new message', async () => {
		service.takeKeyboardMessages.mockResolvedValue([41, 42])
		await handler.handle(update() as any)
		const edits = api.call.mock.calls.filter(([, method]) => method === 'editMessageReplyMarkup')
		expect(edits.map(([, , p]) => p.message_id)).toEqual([41, 42])
	})

	it('"Принято" is sent only for the first message or after a long pause', async () => {
		service.upsertContact.mockResolvedValue(conv({ lastInboundAt: new Date(Date.now() - 60_000) }))
		await handler.handle(update() as any)
		expect(api.call.mock.calls.filter(([bot]) => bot === 'support')).toHaveLength(0)

		api.call.mockClear()
		service.upsertContact.mockResolvedValue(conv({ lastInboundAt: new Date(Date.now() - 30 * 3600 * 1000) }))
		await handler.handle(update() as any)
		expect(api.call.mock.calls.filter(([bot]) => bot === 'support')).toHaveLength(1)
	})

	it('a repeated webhook (message already saved and delivered) neither acks nor forwards again', async () => {
		service.recordInbound.mockResolvedValue({ row: { id: 'm1', deliveredAt: new Date() }, created: false })
		await handler.handle(update() as any)
		expect(api.call).not.toHaveBeenCalled()
		expect(relay.relay).not.toHaveBeenCalled()
	})

	it('a retry after a failed forward forwards again but does not ack twice', async () => {
		service.recordInbound.mockResolvedValue({ row: { id: 'm1', deliveredAt: null }, created: false })
		await handler.handle(update() as any)
		expect(api.call.mock.calls.filter(([bot]) => bot === 'support')).toHaveLength(0)
		expect(relay.relay).toHaveBeenCalledTimes(1)
	})

	it('a blocked client is ignored silently: nothing saved, nothing forwarded', async () => {
		service.upsertContact.mockResolvedValue(conv({ isBlocked: true }))
		await handler.handle(update() as any)
		expect(service.recordInbound).not.toHaveBeenCalled()
		expect(relay.relay).not.toHaveBeenCalled()
		expect(api.call).not.toHaveBeenCalled()
	})

	it('over the rate limit the message is dropped silently', async () => {
		service.isRateLimited.mockResolvedValue(true)
		await handler.handle(update() as any)
		expect(service.recordInbound).not.toHaveBeenCalled()
		expect(relay.relay).not.toHaveBeenCalled()
	})

	it('unsupported types get an explanation and are not stored', async () => {
		await handler.handle(update({ text: undefined, poll: {} }) as any)
		expect(service.recordInbound).not.toHaveBeenCalled()
		expect(api.call.mock.calls[0][2].text).toContain('не принимаю')
	})

	it('groups, bots and edited messages are ignored', async () => {
		const group = update() as any
		group.message.chat.type = 'supergroup'
		await handler.handle(group)
		const bot = update() as any
		bot.message.from.is_bot = true
		await handler.handle(bot)
		await handler.handle({ update_id: 3, edited_message: {} } as any)
		expect(service.upsertContact).not.toHaveBeenCalled()
	})

	it('an admin writing to the Support bot is just a client (no special rights)', async () => {
		service.upsertContact.mockResolvedValue(conv({ telegramUserId: BigInt(ADMIN) }))
		await handler.handle(update({}, ADMIN) as any)
		expect(service.recordInbound).toHaveBeenCalled()
		expect(relay.relay).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin' }))
	})

	it('if the message cannot reach any admin the webhook fails (Telegram retries), the message stays saved', async () => {
		relay.relay.mockRejectedValue(new Error('boom'))
		await expect(handler.handle(update() as any)).rejects.toThrow('boom')
		expect(service.recordInbound).toHaveBeenCalled()
		expect(service.markDelivered).not.toHaveBeenCalled()
	})

	it('no admins configured: saved but not forwarded, no crash', async () => {
		config.adminIds = []
		await expect(handler.handle(update() as any)).resolves.toBeUndefined()
		expect(relay.relay).not.toHaveBeenCalled()
	})
})
