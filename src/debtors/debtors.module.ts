import { Module } from '@nestjs/common'
import { DebtorsController } from './debtors.controller'
import { DebtorsService } from './debtors.service'
import { TransactionsModule } from '../transactions/transactions.module'

@Module({
  imports: [TransactionsModule],
  controllers: [DebtorsController],
  providers: [DebtorsService],
  exports: [DebtorsService],
})
export class DebtorsModule {}
