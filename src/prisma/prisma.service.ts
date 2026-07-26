import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL!
})

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
	constructor() {
		super({ adapter })
	}

	async onModuleDestroy() {
		await this.$disconnect()
	}
}
