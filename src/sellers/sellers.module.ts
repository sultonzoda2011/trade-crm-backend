import { Module } from '@nestjs/common'
import { SellersController } from './sellers.controller'
import { SellersService } from './sellers.service'
import { TransactionsModule } from '../transactions/transactions.module'

@Module({
  imports: [TransactionsModule],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule {}
