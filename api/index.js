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

	app.setGlobalPrefix('api')

	app.enableCors({
		origin: '*',
		credentials: true
	})

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
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

	await app.init()

	console.log('Swagger enabled')

	cachedApp = app

	return app
}

module.exports = async (req, res) => {
	const app = await bootstrap()

	app.getHttpAdapter().getInstance()(req, res)
}
