const { NestFactory } = require('@nestjs/core')
const { ExpressAdapter } = require('@nestjs/platform-express')
const { ValidationPipe } = require('@nestjs/common')
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger')
const path = require('path')
const swaggerUi = require('swagger-ui-dist')

let cachedApp

async function bootstrap() {
	if (cachedApp) return cachedApp

	const express = require('express')
	const { AppModule } = require('../dist/src/app.module')

	const app = await NestFactory.create(AppModule, new ExpressAdapter(express()))

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
			transformOptions: { enableImplicitConversion: true }
		})
	)

	const swaggerConfig = new DocumentBuilder()
		.setTitle('TradeCRM API')
		.setDescription('CRM for managing markets')
		.setVersion('1.0')
		.addServer('https://trade-crm-api.vercel.app', 'Production')
		.addBearerAuth(
			{ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
			'bearer'
		)
		.build()
	const document = SwaggerModule.createDocument(app, swaggerConfig)

	const expressApp = app.getHttpAdapter().getInstance()
	const swaggerDistPath = swaggerUi.getAbsoluteFSPath()

	expressApp.use('/api/docs/swagger-ui-dist', express.static(swaggerDistPath))
	expressApp.use('/api/swagger-ui-dist', express.static(swaggerDistPath))

	expressApp.get('/api/docs', (req, res) => {
		res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>TradeCRM API Docs</title>
        <link rel="stylesheet" href="/api/docs/swagger-ui-dist/swagger-ui.css">
        <style>html { box-sizing: border-box; overflow-y: scroll; }</style>
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="/api/docs/swagger-ui-dist/swagger-ui-bundle.js"></script>
        <script src="/api/docs/swagger-ui-dist/swagger-ui-standalone-preset.js"></script>
        <script>
          window.onload = function() {
            SwaggerUIBundle({
              spec: ${JSON.stringify(document)},
              dom_id: '#swagger-ui',
              deepLinking: true,
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset,
              ],
              plugins: [SwaggerUIBundle.plugins.DownloadUrl],
              layout: 'StandaloneLayout',
              docExpansion: 'list',
              filter: true,
              persistAuthorization: true,
              showRequestDuration: true,
              syntaxHighlight: { theme: 'monokai' },
            });
          };
        </script>
      </body>
      </html>
    `)
	})

	await app.init()
	cachedApp = app
	return cachedApp
}

module.exports = async (req, res) => {
	try {
		const app = await bootstrap()
		app.getHttpAdapter().getInstance()(req, res)
	} catch (err) {
		console.error('Vercel handler error:', err)
		res.status(500).json({ success: false, message: 'Internal Server Error' })
	}
}
