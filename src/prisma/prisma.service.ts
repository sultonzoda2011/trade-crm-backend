import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
	constructor() {
		const adapter = new PrismaPg({
			connectionString: process.env.DATABASE_URL!
		})

		super({
			adapter
		})
	}

	async onModuleDestroy() {
		await this.$disconnect()
	}
}
