import { Module } from '@nestjs/common'
import { ProfileController } from './profile.controller'
import { ProfileService } from './profile.service'
import { MarketsModule } from '../markets/markets.module'
import { TransactionsModule } from '../transactions/transactions.module'

@Module({
	imports: [MarketsModule, TransactionsModule],
	controllers: [ProfileController],
	providers: [ProfileService]
})
export class ProfileModule {}