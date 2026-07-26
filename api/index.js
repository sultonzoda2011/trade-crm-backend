const { NestFactory } = require('@nestjs/core')
const { ExpressAdapter } = require('@nestjs/platform-express')
const { ValidationPipe } = require('@nestjs/common')
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger')
const express = require('express')

const { AppModule } = require('../dist/src/app.module')

let cachedApp

async function bootstrap() {
	if (cachedApp) return cachedApp

	const server = express()

	const app = await NestFactory.create(AppModule, new ExpressAdapter(server))

	app.enableShutdownHooks()

	app.setGlobalPrefix('api')

	app.enableCors({
		origin:
			process.env.NODE_ENV === 'production'
				? [
						'https://trade-crm.vercel.app',
						'capacitor://localhost',
						'http://localhost',
						'https://localhost'
					]
				: ['http://localhost:5173', 'http://localhost:3000'],
		credentials: true,
		methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization']
	})

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: {
				enableImplicitConversion: true
			}
		})
	)

	const swaggerConfig = new DocumentBuilder()
		.setTitle('TradeCRM API')
		.setDescription('CRM for managing markets')
		.setVersion('1.0')
		.addBearerAuth(
			{
				type: 'http',
				scheme: 'bearer',
				bearerFormat: 'JWT'
			},
			'bearer'
		)
		.build()

	const document = SwaggerModule.createDocument(app, swaggerConfig)

	SwaggerModule.setup('docs', app, document, {
		swaggerOptions: {
			persistAuthorization: true,
			docExpansion: 'list',
			filter: true,
			showRequestDuration: true
		},
		customSiteTitle: 'TradeCRM API Docs'
	})

	await app.init()
	console.log(
		'ROUTES:',
		app
			.getHttpAdapter()
			.getInstance()
			._router.stack.map(r => r.route?.path)
			.filter(Boolean)
	)
	cachedApp = app

	return app
}

module.exports = async (req, res) => {
	try {
		const app = await bootstrap()

		app.getHttpAdapter().getInstance()(req, res)
	} catch (error) {
		console.error('Vercel handler error:', error)

		res.status(500).json({
			success: false,
			message: 'Internal Server Error'
		})
	}
}
