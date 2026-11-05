import { INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { TransformInterceptor } from '../common/interceptors/transform.interceptor'
import { SupportController } from './support.controller'
import { SupportWebhookService } from './support-webhook.service'

/**
 * Прогон по HTTP с теми же глобальными настройками, что у приложения:
 * JwtAuthGuard + RolesGuard + ThrottlerGuard (лимит специально 2 в минуту) и
 * ValidationPipe(whitelist, forbidNonWhitelisted). Проверяем, что webhook
 * доступен без JWT, не режется throttler'ом и не отвергается из-за полей
 * Telegram, которых нет в наших DTO.
 */
describe('SupportController (HTTP)', () => {
	let app: INestApplication
	const webhook = { process: jest.fn() }

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 2 }] })],
			controllers: [SupportController],
			providers: [
				{ provide: SupportWebhookService, useValue: webhook },
				{ provide: APP_GUARD, useClass: ThrottlerGuard },
				{ provide: APP_GUARD, useClass: JwtAuthGuard },
				{ provide: APP_GUARD, useClass: RolesGuard }
			]
		}).compile()

		app = moduleRef.createNestApplication()
		app.setGlobalPrefix('api')
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
				transformOptions: { enableImplicitConversion: true }
			})
		)
		app.useGlobalInterceptors(new TransformInterceptor())
		await app.init()
	})

	afterAll(() => app.close())
	beforeEach(() => webhook.process.mockReset().mockResolvedValue({ ok: true }))

	const telegramBody = {
		update_id: 100,
		message: {
			message_id: 5,
			from: { id: 1000000001, is_bot: false, first_name: 'Али', language_code: 'ru' },
			chat: { id: 1000000001, type: 'private', first_name: 'Али' },
			date: 1762300000,
			text: 'привет',
			entities: [{ offset: 0, length: 6, type: 'bold' }]
		}
	}

	it('support webhook: no JWT needed, Telegram body with extra fields reaches the service untouched', async () => {
		const response = await request(app.getHttpServer())
			.post('/api/telegram/support/webhook')
			.set('x-telegram-bot-api-secret-token', 's3cret')
			.send(telegramBody)
			.expect(200)
		expect(response.body.success).toBe(true)
		expect(webhook.process).toHaveBeenCalledWith('support', 's3cret', telegramBody)
	})

	it('admin webhook goes to the admin bot', async () => {
		await request(app.getHttpServer())
			.post('/api/telegram/admin/webhook')
			.set('x-telegram-bot-api-secret-token', 'other')
			.send({ update_id: 1, callback_query: { id: 'q', from: { id: 1 }, data: 'r:12' } })
			.expect(200)
		expect(webhook.process).toHaveBeenCalledWith('admin', 'other', expect.objectContaining({ update_id: 1 }))
	})

	it('is not rate-limited by IP (throttler limit is 2/min, 6 requests still pass)', async () => {
		for (let i = 0; i < 6; i++) {
			await request(app.getHttpServer())
				.post('/api/telegram/support/webhook')
				.set('x-telegram-bot-api-secret-token', 's3cret')
				.send({ update_id: 200 + i })
				.expect(200)
		}
	})

	it('a wrong secret is a 401 JSON error from the service', async () => {
		const { UnauthorizedException } = await import('@nestjs/common')
		webhook.process.mockRejectedValue(new UnauthorizedException())
		await request(app.getHttpServer())
			.post('/api/telegram/support/webhook')
			.send(telegramBody)
			.expect(401)
	})

	it('the secret header may be absent: the service decides (passes undefined)', async () => {
		await request(app.getHttpServer())
			.post('/api/telegram/support/webhook')
			.send({ update_id: 9 })
			.expect(200)
		expect(webhook.process).toHaveBeenCalledWith('support', undefined, { update_id: 9 })
	})

	it('GET on the webhook is not exposed', async () => {
		await request(app.getHttpServer()).get('/api/telegram/support/webhook').expect(404)
	})
})
