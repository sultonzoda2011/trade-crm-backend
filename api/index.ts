import 'reflect-metadata'
import express from 'express'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/bootstrap'

// Vercel serverless entry: vercel.json перенаправляет все запросы сюда.
// Приложение создаётся один раз и переиспользуется между warm-инвокациями.
const expressInstance = express()

let appPromise: Promise<NestExpressApplication> | null = null

async function getApp(): Promise<NestExpressApplication> {
	if (!appPromise) {
		appPromise = NestFactory.create<NestExpressApplication>(
			AppModule,
			new ExpressAdapter(expressInstance)
		)
			.then(async (app) => {
				// Без enableShutdownHooks: Vercel управляет жизненным циклом
				// инстанса, а close() отключил бы Prisma-пул при warm-reuse.
				configureApp(app)
				await app.init()
				return app
			})
			.catch((err) => {
				appPromise = null
				throw err
			})
	}
	return appPromise
}

export default async function handler(
	req: express.Request,
	res: express.Response
) {
	try {
		const app = await getApp()
		app.getHttpAdapter().getInstance()(req, res)
	} catch (err) {
		res.status(500).json({
			success: false,
			message: 'Internal server error'
		})
	}
}
