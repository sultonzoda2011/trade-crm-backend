import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { TransactionsService } from './transactions.service'
import { CreateTransactionDto } from './dto/create-transaction.dto'
import { UpdateTransactionDto } from './dto/update-transaction.dto'
import { QueryTransactionDto } from './dto/query-transaction.dto'
import { TransactionResponseDto } from './dto/transaction-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'

@ApiTags('Transactions')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @ApiCreatedResponse({ type: TransactionResponseDto })
  create(@Body() dto: CreateTransactionDto, @CurrentUser() user: JwtPayload) {
    return this.transactionsService.create(dto, user)
  }

  @Get()
  @ApiOkResponse({ type: TransactionResponseDto })
  @ApiQuery({ name: 'debtorId', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['SALE', 'DEBT'] })
  @ApiQuery({ name: 'status', required: false, enum: ['PAID', 'ACTIVE', 'PARTIAL'] })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  findAll(@Query() query: QueryTransactionDto, @CurrentUser() user: JwtPayload): Promise<PaginatedResult<unknown>> {
    return this.transactionsService.findAll(query, user.marketId)
  }

  @Get(':id')
  @ApiOkResponse({ type: TransactionResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.findOne(id)
  }

  @Patch(':id')
  @ApiOkResponse({ type: TransactionResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransactionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactionsService.update(id, dto, user.marketId)
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Transaction deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.transactionsService.remove(id, user.marketId)
  }
}
