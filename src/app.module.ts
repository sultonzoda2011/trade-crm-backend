import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AnalyticsModule } from './analytics/analytics.module'
import { AuthModule } from './auth/auth.module'
import { CategoriesModule } from './categories/categories.module'
import { CommonModule } from './common/common.module'
import { PrismaThrottlerStorage } from './common/services/throttler-storage.service'
import { validate } from './config/env.validation'
import { DashboardModule } from './dashboard/dashboard.module'
import { DebtorsModule } from './debtors/debtors.module'
import { HealthModule } from './health/health.module'
import { MarketsModule } from './markets/markets.module'
import { PrismaModule } from './prisma/prisma.module'
import { PrismaService } from './prisma/prisma.service'
import { ProductsModule } from './products/products.module'
import { ProfileModule } from './profile/profile.module'
import { SellersModule } from './sellers/sellers.module'
import { TransactionsModule } from './transactions/transactions.module'
import { UsersModule } from './users/users.module'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate
		}),
		// Общий лимит запросов на IP; /auth/login дополнительно защищён более
		// строгим лимитом через @Throttle() на конкретном эндпоинте.
		// Хранилище — Postgres (PrismaThrottlerStorage), чтобы лимиты были
		// корректны между инстансами и в serverless-среде.
		ThrottlerModule.forRootAsync({
			imports: [PrismaModule],
			inject: [PrismaService],
			useFactory: (prisma: PrismaService) => ({
				throttlers: [{ ttl: 60_000, limit: 100 }],
				storage: new PrismaThrottlerStorage(prisma)
			})
		}),
		PrismaModule,
		AuthModule,
		CommonModule,
		AnalyticsModule,
		UsersModule,
		MarketsModule,
		CategoriesModule,
		ProductsModule,
		ProfileModule,
		SellersModule,
		DebtorsModule,
		TransactionsModule,
		DashboardModule,
		HealthModule
	],
	providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
})
export class AppModule {}
