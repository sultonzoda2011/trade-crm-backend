import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Role } from '../enums'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { MarketsService } from './markets.service'
import { CreateMarketDto } from './dto/create-market.dto'
import { UpdateMarketDto } from './dto/update-market.dto'
import { QueryMarketDto } from './dto/query-market.dto'
import { MarketResponseDto } from './dto/market-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'

@ApiTags('Markets')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCreatedResponse({ type: MarketResponseDto })
  create(@Body() dto: CreateMarketDto, @CurrentUser() user: JwtPayload) {
    return this.marketsService.create(dto, user.sub)
  }

  @Get()
  @ApiOkResponse({ type: MarketResponseDto })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or address' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  findAll(@Query() query: QueryMarketDto): Promise<PaginatedResult<unknown>> {
    return this.marketsService.findAll(query)
  }

  @Get(':id')
  @ApiOkResponse({ type: MarketResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketsService.findOne(id)
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: MarketResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarketDto) {
    return this.marketsService.update(id, dto)
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ description: 'Market deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketsService.remove(id)
  }
}
