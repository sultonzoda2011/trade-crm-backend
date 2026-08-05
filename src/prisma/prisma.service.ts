import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

@Injectable()
export class PrismaService
	extends PrismaClient
	implements OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(PrismaService.name)

	constructor() {
		const adapter = new PrismaPg({
			connectionString: process.env.DATABASE_URL!
		})

		super({
			adapter
		})
	}

	async onModuleInit() {
		// Вычищаем протухшие бакеты rate limiting. try/catch: если миграция ещё
		// не применена (например, порядок деплоя), приложение не должно падать.
		try {
			await this.$executeRaw`DELETE FROM "ThrottleBucket"
				WHERE "expiresAt" < NOW() - INTERVAL '1 hour'
					AND ("blockedUntil" IS NULL OR "blockedUntil" < NOW())`
		} catch (error) {
			this.logger.warn(
				`ThrottleBucket cleanup skipped: ${
					(error as Error).message.split('\n')[0]
				}`
			)
		}
	}

	async onModuleDestroy() {
		await this.$disconnect()
	}
}
