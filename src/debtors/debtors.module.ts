import { Module } from '@nestjs/common'
import { DebtorsController } from './debtors.controller'
import { DebtorsService } from './debtors.service'

@Module({
  controllers: [DebtorsController],
  providers: [DebtorsService],
  exports: [DebtorsService],
})
export class DebtorsModule {}
