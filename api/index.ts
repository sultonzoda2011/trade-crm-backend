import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import express from 'express'
import { AppModule } from '../src/app.module'

let cachedApp: any

async function bootstrap() {
	if (cachedApp) return cachedApp

	const app = await NestFactory.create(AppModule, new ExpressAdapter(express()))

	app.setGlobalPrefix('api')
	app.enableCors({
		origin:
			process.env.NODE_ENV === 'production'
				? ['https://trade-crm.vercel.app']
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

	await app.init()
	cachedApp = app
	return cachedApp
}

export default async function handler(req: any, res: any) {
	const app = await bootstrap()
	app.getHttpAdapter().getInstance()(req, res)
}
