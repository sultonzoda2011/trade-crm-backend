import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor'
import { TransactionsService } from './transactions.service'
import { CreateTransactionDto } from './dto/create-transaction.dto'
import { CreatePaymentDto } from './dto/create-payment.dto'
import { UpdateTransactionDto } from './dto/update-transaction.dto'
import { QueryTransactionDto } from './dto/query-transaction.dto'
import { RefundTransactionDto } from './dto/refund-transaction.dto'
import { TransactionResponseDto } from './dto/transaction-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'

@ApiTags('Transactions')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // Любая роль (ADMIN/OWNER/SELLER) может создавать транзакцию. Проверка
  // "SELLER может создавать только DEBT" выполняется в сервисе — это блокирует
  // бесконтрольное списание товара со склада продавцом без долговой обязанности.
  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Client-generated uuid to dedupe retried offline mutations' })
  @ApiCreatedResponse({ type: TransactionResponseDto })
  create(@Body() dto: CreateTransactionDto, @CurrentUser() user: JwtPayload) {
    return this.transactionsService.create(dto, user)
  }

  @Get()
  @ApiOkResponse({ type: TransactionResponseDto })
  @ApiQuery({ name: 'debtorId', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['SALE', 'DEBT', 'REFUND'] })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PAID', 'ACTIVE', 'PARTIAL', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  findAll(@Query() query: QueryTransactionDto, @CurrentUser() user: JwtPayload): Promise<PaginatedResult<unknown>> {
    return this.transactionsService.findAll(query, user.marketId)
  }

  @Get(':id')
  @ApiOkResponse({ type: TransactionResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    // ВАЖНО: marketId обязательно передаётся, иначе любой пользователь
    // может прочитать транзакцию чужого маркета по id (IDOR).
    return this.transactionsService.findOne(id, user.marketId)
  }

  // Транзакция как бизнес-процесс: строки с остатком к возврату, платежи,
  // возвраты, связь с исходной продажей и единый timeline событий.
  @Get(':id/detail')
  @ApiOkResponse({ description: 'Transaction with payments, refunds and event timeline' })
  findOneDetail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.transactionsService.findOneDetail(id, user.marketId)
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOkResponse({ type: TransactionResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransactionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactionsService.update(id, dto, user.marketId)
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOkResponse({ description: 'Transaction deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.transactionsService.remove(id, user.marketId)
  }

  @Patch(':id/pay')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Client-generated uuid to dedupe retried offline mutations' })
  @ApiOkResponse({ type: TransactionResponseDto, description: 'Payment recorded' })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactionsService.pay(id, dto, user)
  }

  // Частичный возврат: в теле передаются конкретные строки продажи и количество.
  // Пустое тело сохраняет прежнее поведение — возврат всего остатка целиком.
  @Post(':id/refund')
  @Roles(Role.ADMIN, Role.OWNER)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Client-generated uuid to dedupe retried offline mutations' })
  @ApiOkResponse({ type: TransactionResponseDto, description: 'Refund created, stock restored' })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundTransactionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactionsService.refund(id, user, dto)
  }
}
