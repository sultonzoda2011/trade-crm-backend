import { Module } from '@nestjs/common'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'
import { MarketsModule } from '../markets/markets.module'
import { TransactionsModule } from '../transactions/transactions.module'

@Module({
  imports: [MarketsModule, TransactionsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
