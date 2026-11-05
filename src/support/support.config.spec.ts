import { SupportConfig } from './support.config'

const make = (env: Record<string, string | undefined>) =>
	new SupportConfig({ get: (key: string) => env[key] } as any)

describe('SupportConfig', () => {
	it('parses admin IDs, ignoring junk, spaces and non-positive numbers', () => {
		const config = make({ TELEGRAM_ADMIN_IDS: ' 1000000001, abc,0,-5, 42 ,' })
		expect(config.adminIds).toEqual([1000000001, 42])
		expect(config.isAdmin(1000000001)).toBe(true)
		expect(config.isAdmin(1)).toBe(false)
		expect(config.isAdmin(undefined)).toBe(false)
	})

	it('no admin IDs configured means nobody is an admin', () => {
		const config = make({})
		expect(config.adminIds).toEqual([])
		expect(config.isAdmin(1000000001)).toBe(false)
	})

	it('blank secrets count as not configured', () => {
		const config = make({ SUPPORT_WEBHOOK_SECRET: '   ', ADMIN_WEBHOOK_SECRET: 's' })
		expect(config.webhookSecret('support')).toBeUndefined()
		expect(config.webhookSecret('admin')).toBe('s')
	})

	it('timezone defaults to Dushanbe', () => {
		expect(make({}).timezone).toBe('Asia/Dushanbe')
	})
})
