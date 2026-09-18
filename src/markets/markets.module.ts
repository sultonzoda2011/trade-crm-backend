import { Module } from '@nestjs/common'
import { MarketsController } from './markets.controller'
import { MarketsService } from './markets.service'
import { ProductsModule } from '../products/products.module'
import { DebtorsModule } from '../debtors/debtors.module'
import { TransactionsModule } from '../transactions/transactions.module'

@Module({
  imports: [ProductsModule, DebtorsModule, TransactionsModule],
  controllers: [MarketsController],
  providers: [MarketsService],
  exports: [MarketsService],
})
export class MarketsModule {}
