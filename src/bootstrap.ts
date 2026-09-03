import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import compression from 'compression'
import helmet from 'helmet'

const logger = new Logger('Bootstrap')

/**
 * Общая конфигурация приложения: middleware, глобальные pipes и Swagger.
 * Вызывается и из main.ts (локальный запуск), и из api/index.ts (Vercel),
 * чтобы поведение dev- и serverless-окружений не расходилось.
 */
export function configureApp(app: NestExpressApplication): void {
	const configService = app.get(ConfigService)
	const nodeEnv = configService.get('NODE_ENV', 'development')

	// За прокси (Vercel) req.ip иначе всегда адрес прокси — rate limiting по IP
	// не работает и все пользователи делят один лимит. 1 = доверяем первому
	// hop'у X-Forwarded-For.
	app.set('trust proxy', 1)

	// Базовые security-заголовки. CSP отключён: API отдаёт только JSON, а
	// Swagger UI в dev использует инлайн-скрипты и CDN, что с CSP несовместимо.
	app.use(helmet({ contentSecurityPolicy: false }))
	app.use(compression())

	// Лимит JSON-тела 100kb: все наши DTO заведомо меньше, а огромные payload
	// — вектор для OOM/мусорных запросов. Multipart (загрузка файлов) своим
	// лимитом управляется в multerOptions (5MB).
	app.useBodyParser('json', { limit: '100kb' })

	app.setGlobalPrefix('api')
	app.enableCors({
		origin:
			nodeEnv === 'production'
				? [
						'https://crm-trade.vercel.app',
						'capacitor://localhost',
						'https://localhost',
						'http://localhost'
					]
				: ['http://localhost:5173', 'http://localhost:3000'],
		// Токен идёт в заголовке Authorization, а не в cookie — credentials:true
		// (отправка cookie кросс-доменно) больше не требуется.
		methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
		// Cache-Control/Pragma добавлены фронтендом на КАЖДЫЙ GET (см.
		// app/lib/client.ts) — без них Android WebView/OkHttp может тихо
		// отдать закэшированный ответ вместо реального похода на сервер, и
		// JS не в состоянии это отличить. Без явного allowedHeaders браузер
		// (и WebView, если он не использует нативный CapacitorHttp-мост)
		// заблокирует такой запрос ещё на CORS preflight.
		allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma']
	})

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: true }
		})
	)

	// Swagger доступен только в dev-окружении. В production документация API
	// не отдаётся (отключить можно и через NODE_ENV=production локально).
	if (nodeEnv !== 'production') {
		const swaggerConfig = new DocumentBuilder()
			.setTitle('TradeCRM API')
			.setDescription('CRM for managing markets')
			.setVersion('1.0')
			.setContact('TradeCRM Team', '', 'support@tradecrm.com')
			.addServer(
				nodeEnv === 'production'
					? 'https://trade-crm-api.vercel.app'
					: `http://localhost:${configService.get('PORT', 3000)}`,
				nodeEnv === 'production' ? 'Production' : 'Development'
			)
			.addBearerAuth(
				{ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
				'bearer'
			)

			.build()

		const document = SwaggerModule.createDocument(app, swaggerConfig)
		SwaggerModule.setup('/docs', app, document, {
			swaggerOptions: {
				persistAuthorization: true,
				docExpansion: 'list',
				filter: true,
				showRequestDuration: true,
				syntaxHighlight: {
					theme: 'monokai'
				}
			},
			customSiteTitle: 'TradeCRM API Docs'
		})
		app.getHttpAdapter().get('/api-json', (_, res: any) => {
			res.json(document)
		})
		logger.log(
			`Swagger docs: ${
				nodeEnv === 'production'
					? 'https://trade-crm-api.vercel.app'
					: `http://localhost:${configService.get('PORT', 3000)}`
			}/api/docs`
		)
	}
}
