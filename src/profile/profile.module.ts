import { Module } from '@nestjs/common'
import { MarketsModule } from '../markets/markets.module'
import { SellersModule } from '../sellers/sellers.module'
import { ProfileController } from './profile.controller'
import { ProfileService } from './profile.service'

@Module({
	imports: [MarketsModule, SellersModule],
	controllers: [ProfileController],
	providers: [ProfileService]
})
export class ProfileModule {}
