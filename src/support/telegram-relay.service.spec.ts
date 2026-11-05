import { TelegramRelay } from './telegram-relay.service'
import { NormalizedMessage } from './support-message.util'

describe('TelegramRelay', () => {
	let api: { call: jest.Mock; sendFile: jest.Mock; downloadFile: jest.Mock }
	let relay: TelegramRelay
	let nextId: number

	beforeEach(() => {
		nextId = 100
		api = {
			call: jest.fn().mockImplementation(async () => ({ message_id: nextId++ })),
			sendFile: jest.fn().mockImplementation(async (_b, _m, field) => ({
				message_id: nextId++,
				...(field === 'photo'
					? { photo: [{ file_id: 'p-small' }, { file_id: 'p-big' }] }
					: { [field]: { file_id: `${field}-new` } })
			})),
			downloadFile: jest.fn().mockResolvedValue(Buffer.from('data'))
		}
		relay = new TelegramRelay(api as any)
	})

	const base = { from: 'support', to: 'admin', chatId: 5 } as const

	it('text: prefix is added, no parse_mode, markup on the message', async () => {
		const markup = { inline_keyboard: [] }
		const result = await relay.relay({
			...base,
			message: { kind: 'text', text: '<b>hi</b>' },
			prefix: '#12 Али',
			replyMarkup: markup
		})
		expect(api.call).toHaveBeenCalledWith('admin', 'sendMessage', {
			chat_id: 5,
			text: '#12 Али\n<b>hi</b>',
			reply_markup: markup
		})
		expect(result.messageIds).toEqual([100])
	})

	it('admin → client: no prefix', async () => {
		await relay.relay({
			from: 'admin',
			to: 'support',
			chatId: 9,
			message: { kind: 'text', text: 'ответ' }
		})
		expect(api.call).toHaveBeenCalledWith('support', 'sendMessage', {
			chat_id: 9,
			text: 'ответ'
		})
	})

	it('long text is split into chunks, markup only on the last one', async () => {
		const markup = { inline_keyboard: [] }
		const result = await relay.relay({
			...base,
			message: { kind: 'text', text: 'x'.repeat(9000) },
			prefix: '#1 A',
			replyMarkup: markup
		})
		expect(result.messageIds).toHaveLength(3)
		const withMarkup = api.call.mock.calls.filter(([, , p]) => p.reply_markup)
		expect(withMarkup).toHaveLength(1)
	})

	it('photo: downloads from source bot, uploads to target, returns the new file_id', async () => {
		const message: NormalizedMessage = { kind: 'photo', text: 'чек', fileId: 'src-id', fileSize: 10 }
		const result = await relay.relay({ ...base, message, prefix: '#12 Али' })
		expect(api.downloadFile).toHaveBeenCalledWith('support', 'src-id')
		expect(api.sendFile).toHaveBeenCalledWith(
			'admin',
			'sendPhoto',
			'photo',
			expect.objectContaining({ filename: 'photo.jpg' }),
			{ chat_id: 5, caption: '#12 Али\nчек' }
		)
		expect(result.fileId).toBe('p-big')
	})

	it('caption longer than 1024 goes as a separate text, file is sent without it', async () => {
		const result = await relay.relay({
			...base,
			message: { kind: 'document', text: 'z'.repeat(1500), fileId: 'f', fileName: 'a.pdf' },
			prefix: '#1 A'
		})
		expect(api.call).toHaveBeenCalledTimes(1)
		expect(api.call.mock.calls[0][1]).toBe('sendMessage')
		expect(api.sendFile.mock.calls[0][4]).toEqual({ chat_id: 5 })
		expect(result.messageIds).toHaveLength(2)
	})

	it('video note: prefix is a separate message (no captions on circles)', async () => {
		await relay.relay({
			...base,
			message: { kind: 'video_note', text: null, fileId: 'vn' },
			prefix: '#1 A'
		})
		expect(api.call).toHaveBeenCalledWith('admin', 'sendMessage', { chat_id: 5, text: '#1 A' })
		expect(api.sendFile.mock.calls[0][1]).toBe('sendVideoNote')
	})

	it('file over 20 MB is not transferred, admin gets a note instead', async () => {
		const result = await relay.relay({
			...base,
			message: { kind: 'video', text: null, fileId: 'big', fileSize: 30 * 1024 * 1024 },
			prefix: '#1 A'
		})
		expect(result.tooLarge).toBe(true)
		expect(api.downloadFile).not.toHaveBeenCalled()
		expect(api.sendFile).not.toHaveBeenCalled()
		expect(api.call.mock.calls[0][2].text).toContain('слишком большой')
	})

	it('location and contact: prefix first, then the object', async () => {
		await relay.relay({
			...base,
			message: { kind: 'location', text: null, latitude: 38.5, longitude: 68.7 },
			prefix: '#1 A'
		})
		expect(api.call.mock.calls.map((c) => c[1])).toEqual(['sendMessage', 'sendLocation'])
		api.call.mockClear()
		await relay.relay({
			...base,
			message: { kind: 'contact', text: null, contact: { phone: '+992', firstName: 'Али' } },
			prefix: '#1 A'
		})
		expect(api.call.mock.calls.map((c) => c[1])).toEqual(['sendMessage', 'sendContact'])
	})

	it('sticker is relayed as text with the emoji', async () => {
		await relay.relay({ ...base, message: { kind: 'sticker', text: '😀' }, prefix: '#1 A' })
		expect(api.call.mock.calls[0][2].text).toBe('#1 A\n[стикер 😀]')
	})
})
