import { TelegramApi, TelegramApiError } from './telegram-api.service'

const TOKEN = '123456:SECRET-TOKEN-VALUE'

describe('TelegramApi', () => {
	let api: TelegramApi
	const realFetch = global.fetch

	beforeEach(() => {
		api = new TelegramApi({ token: () => TOKEN } as any)
	})
	afterEach(() => {
		global.fetch = realFetch
	})

	it('returns result on ok', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			status: 200,
			json: async () => ({ ok: true, result: { message_id: 7 } })
		}) as any
		await expect(api.call('support', 'sendMessage', { chat_id: 1 })).resolves.toEqual({
			message_id: 7
		})
		const [url] = (global.fetch as jest.Mock).mock.calls[0]
		expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
	})

	it('API error keeps code and description but never the token', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			status: 403,
			json: async () => ({
				ok: false,
				error_code: 403,
				description: 'Forbidden: bot was blocked by the user'
			})
		}) as any
		const error: any = await api.call('support', 'sendMessage').catch((e) => e)
		expect(error).toBeInstanceOf(TelegramApiError)
		expect(error.code).toBe(403)
		expect(error.message).toContain('blocked')
		expect(error.message).not.toContain(TOKEN)
	})

	it('network errors that quote the URL do not leak the token', async () => {
		global.fetch = jest
			.fn()
			.mockRejectedValue(new Error(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`)) as any
		const error: any = await api.call('support', 'sendMessage').catch((e) => e)
		expect(error).toBeInstanceOf(TelegramApiError)
		expect(error.code).toBe(0)
		expect(`${error.message} ${error.stack}`).not.toContain(TOKEN)
	})

	it('a missing token fails with a clear error, not a request', async () => {
		global.fetch = jest.fn() as any
		const noToken = new TelegramApi({ token: () => undefined } as any)
		await expect(noToken.call('admin', 'sendMessage')).rejects.toThrow('token is not configured')
		expect(global.fetch).not.toHaveBeenCalled()
	})

	it('downloadFile refuses files over 20 MB', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			status: 200,
			json: async () => ({ ok: true, result: { file_path: 'x/y', file_size: 30 * 1024 * 1024 } })
		}) as any
		await expect(api.downloadFile('support', 'f')).rejects.toThrow('too big')
	})
})
