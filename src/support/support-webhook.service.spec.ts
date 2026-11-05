import { BadRequestException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common'
import { SupportWebhookService } from './support-webhook.service'

describe('SupportWebhookService', () => {
	let config: any
	let service: any
	let supportBot: any
	let adminBot: any
	let webhook: SupportWebhookService
	const update = { update_id: 42 }

	beforeEach(() => {
		config = { webhookSecret: jest.fn().mockReturnValue('good-secret') }
		service = {
			beginUpdate: jest.fn().mockResolvedValue('process'),
			finishUpdate: jest.fn().mockResolvedValue(undefined)
		}
		supportBot = { handle: jest.fn().mockResolvedValue(undefined) }
		adminBot = { handle: jest.fn().mockResolvedValue(undefined) }
		webhook = new SupportWebhookService(config, service, supportBot, adminBot)
	})

	it('rejects a missing or wrong secret and touches nothing', async () => {
		await expect(webhook.process('support', undefined, update as any)).rejects.toBeInstanceOf(UnauthorizedException)
		await expect(webhook.process('support', 'bad', update as any)).rejects.toBeInstanceOf(UnauthorizedException)
		await expect(webhook.process('admin', 'good-secret-but-longer', update as any)).rejects.toBeInstanceOf(UnauthorizedException)
		expect(service.beginUpdate).not.toHaveBeenCalled()
		expect(supportBot.handle).not.toHaveBeenCalled()
		expect(adminBot.handle).not.toHaveBeenCalled()
	})

	it('fails closed when the secret is not configured', async () => {
		config.webhookSecret.mockReturnValue(undefined)
		await expect(webhook.process('support', '', update as any)).rejects.toBeInstanceOf(UnauthorizedException)
		await expect(webhook.process('support', undefined, update as any)).rejects.toBeInstanceOf(UnauthorizedException)
		expect(service.beginUpdate).not.toHaveBeenCalled()
	})

	it('each bot has its own secret', async () => {
		config.webhookSecret.mockImplementation((bot: string) => (bot === 'support' ? 'S' : 'A'))
		await expect(webhook.process('admin', 'S', update as any)).rejects.toBeInstanceOf(UnauthorizedException)
		await expect(webhook.process('admin', 'A', update as any)).resolves.toEqual({ ok: true })
		expect(adminBot.handle).toHaveBeenCalledTimes(1)
		expect(supportBot.handle).not.toHaveBeenCalled()
	})

	it('rejects a body without update_id', async () => {
		await expect(webhook.process('support', 'good-secret', {} as any)).rejects.toBeInstanceOf(BadRequestException)
	})

	it('dispatches to the right handler and marks the update done', async () => {
		await webhook.process('support', 'good-secret', update as any)
		expect(supportBot.handle).toHaveBeenCalledWith(update)
		expect(service.finishUpdate).toHaveBeenCalledWith('support', 42)
	})

	it('an already processed update (Telegram retry) is skipped', async () => {
		service.beginUpdate.mockResolvedValue('skip')
		await expect(webhook.process('support', 'good-secret', update as any)).resolves.toEqual({ ok: true })
		expect(supportBot.handle).not.toHaveBeenCalled()
	})

	it('a failure answers 500 so Telegram retries, and is not marked done', async () => {
		supportBot.handle.mockRejectedValue(new Error('db down\nsecret details'))
		await expect(webhook.process('support', 'good-secret', update as any)).rejects.toBeInstanceOf(InternalServerErrorException)
		expect(service.finishUpdate).not.toHaveBeenCalled()
	})

	it('after the last attempt it answers 200 and gives up (no poison update)', async () => {
		service.beginUpdate.mockResolvedValue('last')
		supportBot.handle.mockRejectedValue(new Error('still broken'))
		await expect(webhook.process('support', 'good-secret', update as any)).resolves.toEqual({ ok: true })
		expect(service.finishUpdate).toHaveBeenCalledWith('support', 42)
	})
})
