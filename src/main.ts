import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import 'reflect-metadata'
import { AppModule } from './app.module'
import { configureApp } from './bootstrap'

async function bootstrap() {
	const logger = new Logger('Bootstrap')
	const app = await NestFactory.create<NestExpressApplication>(AppModule)
	const configService = app.get(ConfigService)

	app.enableShutdownHooks()

	configureApp(app)

	const port = configService.get('PORT', 3000)
	await app.listen(port)
	logger.log(`TradeCRM backend is running on http://localhost:${port}`)
}

bootstrap()
