import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { UploadImage } from '../common/decorators/upload-image.decorator'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { CreateMarketDto } from './dto/create-market.dto'
import { MarketOverviewResponseDto, MarketResponseDto } from './dto/market-response.dto'
import { QueryMarketDto } from './dto/query-market.dto'
import { UpdateMarketDto } from './dto/update-market.dto'
import { UpdateMarketSettingsDto } from './dto/update-market-settings.dto'
import { marketScope } from './market-scope.util'
import { MarketsService } from './markets.service'

@ApiTags('Markets')
@ApiBearerAuth()
@ApiErrorResponse()
// Чтение доступно ADMIN (все маркеты) и OWNER (только свой); SELLER закрыт.
// Управляющие методы переопределены ниже через @Roles(Role.ADMIN).
@Roles(Role.ADMIN, Role.OWNER)
@Controller('markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @UploadImage()
  @ApiOperation({ summary: 'Create a market', description: 'Creates a new market with an optional image. Admin only.' })
  @ApiBody({
    description: 'Market creation payload (multipart/form-data)',
    schema: {
      type: 'object',
      required: ['name', 'address'],
      properties: {
        name: { type: 'string', example: 'Central Market', description: 'Market name (2-200 chars)' },
        address: { type: 'string', example: '123 Main St', description: 'Market address (5-500 chars)' },
        phone: { type: 'string', example: '+992 900 12-34-56', description: 'Market phone (optional)' },
        workHours: { type: 'string', example: 'Пн–Сб 8:00–18:00', description: 'Working hours, free text (optional)' },
        ownerId: { type: 'string', description: 'Owner user ID: an OWNER who owns no other market' },
        image: { type: 'string', format: 'binary', description: 'Market image (jpg, png, webp, gif; max 5MB)' },
      },
    },
  })
  @ApiCreatedResponse({ type: MarketResponseDto, description: 'The created market' })
  create(
    @Body() dto: CreateMarketDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.marketsService.create(dto, file, user.sub)
  }

  @Get()
  @ApiOperation({ summary: 'List markets', description: 'Returns a paginated list of all markets with search support.' })
  @ApiOkResponse({ type: MarketResponseDto })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or address' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (1-based)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  findAll(@Query() query: QueryMarketDto, @CurrentUser() user: JwtPayload): Promise<PaginatedResult<unknown>> {
    // ADMIN видит все маркеты; OWNER — только свой.
    return this.marketsService.findAll(query, marketScope(user))
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.OWNER, Role.SELLER)
  @ApiOperation({ summary: 'Get a market by ID', description: 'Returns a single market with full details.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiOkResponse({ type: MarketResponseDto, description: 'The found market' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    // ADMIN — любой рынок; OWNER и SELLER — только свой (чужой = 404). Продавцу не отдаём email.
    return this.marketsService.findOne(id, marketScope(user), { hideEmails: user.role === Role.SELLER })
  }

  @Get(':id/overview')
  @Roles(Role.ADMIN, Role.OWNER, Role.SELLER)
  @ApiOperation({
    summary: 'Market screen in one round-trip',
    description:
      'Market card + summary (counts for everyone; debt and stock value in `summary.management` for ADMIN/OWNER only, null for sellers).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiOkResponse({ type: MarketOverviewResponseDto })
  overview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.marketsService.overview(id, user)
  }

  @Get(':id/full')
  @Roles(Role.ADMIN, Role.OWNER, Role.SELLER)
  @ApiOperation({
    summary: 'Market detail page in one round-trip (deprecated: use /overview)',
    deprecated: true,
    description: 'Market + products/debtors/transactions previews (own market only). Kept for old clients; the market screen reads GET /markets/:id/overview.'
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  findOneFull(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.marketsService.findOneFull(id, user)
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @UploadImage()
  @ApiOperation({ summary: 'Update a market', description: 'Updates a market with partial data and an optional new image. Admin or the owner of the market.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiBody({
    description: 'Market update payload (multipart/form-data). Send a new image to replace the existing one, or omit to keep it.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Central Market', description: 'Market name (2-200 chars)' },
        address: { type: 'string', example: '123 Main St', description: 'Market address (5-500 chars)' },
        phone: { type: 'string', example: '+992 900 12-34-56', description: 'Market phone. Empty string clears it.' },
        workHours: { type: 'string', example: 'Пн–Сб 8:00–18:00', description: 'Working hours. Empty string clears it.' },
        ownerId: { type: 'string', description: 'New owner user ID (ADMIN only; an OWNER who owns no other market)' },
        image: { type: 'string', format: 'binary', description: 'New market image (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: MarketResponseDto, description: 'The updated market' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMarketDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    // OWNER может обновлять только свой маркет (IDOR-защита) и не может менять владельца.
    return this.marketsService.update(id, dto, file, marketScope(user), user.role === Role.ADMIN)
  }

  @Patch(':id/settings')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOperation({
    summary: 'Update market settings',
    description: 'JSON settings such as `allowSellerSales`. Admin or the owner of the market.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiOkResponse({ type: MarketResponseDto, description: 'The updated market' })
  updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMarketSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.marketsService.updateSettings(id, dto, marketScope(user))
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a market', description: 'Deletes a market and its associated image. Admin only.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiOkResponse({ description: 'Market successfully deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.marketsService.remove(id, marketScope(user))
  }
}
