const { NestFactory } = require('@nestjs/core')
const { ExpressAdapter } = require('@nestjs/platform-express')
const { ValidationPipe } = require('@nestjs/common')
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger')
const compression = require('compression')
const helmet = require('helmet')
const express = require('express')

const { AppModule } = require('../dist/src/app.module')

let cachedApp

async function bootstrap() {
	if (cachedApp) return cachedApp

	const server = express()

	const app = await NestFactory.create(AppModule, new ExpressAdapter(server))

	// За прокси (Vercel) req.ip иначе всегда адрес прокси — rate limiting по IP
	// не работает и все пользователи делят один лимит.
	app.set('trust proxy', 1)

	// Базовые security-заголовки. CSP отключён: API отдаёт только JSON, а
	// Swagger UI в dev использует инлайн-скрипты и CDN, что с CSP несовместимо.
	app.use(helmet({ contentSecurityPolicy: false }))
	app.use(compression())

	// Лимит JSON-тела 100kb (мультипарт управляется в multerOptions, 5MB).
	app.useBodyParser('json', { limit: '100kb' })

	app.setGlobalPrefix('api')

	const isProd = process.env.NODE_ENV === 'production'

	// CORS: credentials:true требует явного списка origin (не '*'). В переключателе
	// перечислены frontend (Vercel/Capacitor) и localhost для dev.
	app.enableCors({
		origin: isProd
			? ['https://trade-crm.vercel.app', 'capacitor://localhost']
			: ['http://localhost:5173', 'http://localhost:3000'],
		credentials: true,
		methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization']
	})

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true
		})
	)

	const config = new DocumentBuilder()
		.setTitle('TradeCRM API')
		.setDescription('CRM API')
		.setVersion('1.0')
		.addBearerAuth()
		.build()

	const document = SwaggerModule.createDocument(app, config)

	// Swagger только в dev-среде — в production документация API не отдаётся.
	if (!isProd) {
		// только JSON
		app
			.getHttpAdapter()
			.getInstance()
			.get('/api/docs-json', (req, res) => {
				res.json(document)
			})

	// свой Swagger UI
	app
		.getHttpAdapter()
		.getInstance()
		.get('/api/docs', (req, res) => {
			res.send(`
<!DOCTYPE html>
<html>
<head>
<title>TradeCRM API</title>

<link rel="stylesheet"
href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">

</head>

<body>

<div id="swagger-ui"></div>

<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>

<script>

window.onload = () => {

SwaggerUIBundle({

url: "/api/docs-json",

dom_id:"#swagger-ui"

})

}

</script>

</body>
</html>
			`)
		})
	}

	await app.init()

	console.log('Swagger enabled')

	cachedApp = app

	return app
}

module.exports = async (req, res) => {
	const app = await bootstrap()

	app.getHttpAdapter().getInstance()(req, res)
}
