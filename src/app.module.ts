import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { CommonModule } from './common/common.module'
import { DebtorsModule } from './debtors/debtors.module'
import { MarketsModule } from './markets/markets.module'
import { PrismaModule } from './prisma/prisma.module'
import { ProductsModule } from './products/products.module'
import { SellersModule } from './sellers/sellers.module'
import { TransactionsModule } from './transactions/transactions.module'
import { UsersModule } from './users/users.module'
import { validate } from './config/env.validation'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate
		}),
		PrismaModule,
		AuthModule,
		CommonModule,
		UsersModule,
		MarketsModule,
		ProductsModule,
		SellersModule,
		DebtorsModule,
		TransactionsModule
	]
})
export class AppModule {}
