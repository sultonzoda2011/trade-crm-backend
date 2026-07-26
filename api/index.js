const { NestFactory } = require('@nestjs/core')
const { ExpressAdapter } = require('@nestjs/platform-express')
const { ValidationPipe } = require('@nestjs/common')
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger')
const swaggerUi = require('swagger-ui-express')
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
		credentials: true
	})

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true
		})
	)

	const swaggerConfig = new DocumentBuilder()
		.setTitle('TradeCRM API')
		.setDescription('CRM for managing markets')
		.setVersion('1.0')
		.addBearerAuth()
		.build()

	const document = SwaggerModule.createDocument(app, swaggerConfig)

	// ВАЖНО: ручная отдача Swagger UI
	server.use('/api/docs/', swaggerUi.serve, swaggerUi.setup(document))
	server.get('/api/docs-json', (req, res) => {
		res.json(document)
	})

	await app.init()

	console.log('SWAGGER ENABLED')

	cachedApp = app

	return app
}

module.exports = async (req, res) => {
	try {
		const app = await bootstrap()

		app.getHttpAdapter().getInstance()(req, res)
	} catch (err) {
		console.error('Vercel handler error:', err)

		res.status(500).json({
			success: false,
			message: 'Internal Server Error'
		})
	}
}
