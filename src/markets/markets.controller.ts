import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Role } from '../enums'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { multerOptions } from '../common/utils/multipart.util'
import { MarketsService } from './markets.service'
import { CreateMarketDto } from './dto/create-market.dto'
import { UpdateMarketDto } from './dto/update-market.dto'
import { QueryMarketDto } from './dto/query-market.dto'
import { MarketResponseDto } from './dto/market-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { Express } from 'express'

@ApiTags('Markets')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a market', description: 'Creates a new market with an optional image. Admin only.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Market creation payload (multipart/form-data)',
    schema: {
      type: 'object',
      required: ['name', 'address'],
      properties: {
        name: { type: 'string', example: 'Central Market', description: 'Market name (2-200 chars)' },
        address: { type: 'string', example: '123 Main St', description: 'Market address (5-500 chars)' },
        ownerId: { type: 'string', description: 'Owner user ID (defaults to current user)' },
        image: { type: 'string', format: 'binary', description: 'Market image (jpg, png, webp, gif; max 5MB)' },
      },
    },
  })
  @ApiCreatedResponse({ type: MarketResponseDto, description: 'The created market' })
  @UseInterceptors(FileInterceptor('image', multerOptions))
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
  findAll(@Query() query: QueryMarketDto): Promise<PaginatedResult<unknown>> {
    return this.marketsService.findAll(query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a market by ID', description: 'Returns a single market with full details.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiOkResponse({ type: MarketResponseDto, description: 'The found market' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketsService.findOne(id)
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a market', description: 'Updates a market with partial data and an optional new image. Admin only.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Market update payload (multipart/form-data). Send a new image to replace the existing one, or omit to keep it.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Central Market', description: 'Market name (2-200 chars)' },
        address: { type: 'string', example: '123 Main St', description: 'Market address (5-500 chars)' },
        ownerId: { type: 'string', description: 'New owner user ID' },
        image: { type: 'string', format: 'binary', description: 'New market image (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: MarketResponseDto, description: 'The updated market' })
  @UseInterceptors(FileInterceptor('image', multerOptions))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMarketDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.marketsService.update(id, dto, file)
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a market', description: 'Deletes a market and its associated image. Admin only.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Market ID' })
  @ApiOkResponse({ description: 'Market successfully deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketsService.remove(id)
  }
}
