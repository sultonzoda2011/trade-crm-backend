import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { DebtorsService } from './debtors.service'
import { CreateDebtorDto } from './dto/create-debtor.dto'
import { UpdateDebtorDto } from './dto/update-debtor.dto'
import { QueryDebtorDto } from './dto/query-debtor.dto'
import { DebtorResponseDto } from './dto/debtor-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'

@ApiTags('Debtors')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('debtors')
export class DebtorsController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Post()
  @ApiCreatedResponse({ type: DebtorResponseDto })
  create(@Body() dto: CreateDebtorDto, @CurrentUser() user: JwtPayload) {
    return this.debtorsService.create(dto, user.marketId)
  }

  @Get()
  @ApiOkResponse({ type: DebtorResponseDto })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or phone' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  findAll(@Query() query: QueryDebtorDto, @CurrentUser() user: JwtPayload): Promise<PaginatedResult<unknown>> {
    return this.debtorsService.findAll(query, user.marketId)
  }

  @Get(':id')
  @ApiOkResponse({ type: DebtorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.debtorsService.findOne(id)
  }

  @Patch(':id')
  @ApiOkResponse({ type: DebtorResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDebtorDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.debtorsService.update(id, dto, user.marketId)
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Debtor deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.debtorsService.remove(id, user.marketId)
  }
}
