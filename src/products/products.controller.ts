import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UploadedFile } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { UploadImage } from '../common/decorators/upload-image.decorator'
import { ProductsService } from './products.service'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { RestockProductDto } from './dto/restock-product.dto'
import { WriteOffProductDto } from './dto/write-off-product.dto'
import { AdjustStockDto } from './dto/adjust-stock.dto'
import { BulkPriceDto } from './dto/bulk-price.dto'
import { QueryMovementsDto } from './dto/query-movements.dto'
import { QueryProductDto } from './dto/query-product.dto'
import { ProductResponseDto } from './dto/product-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { AnalyticsPeriod, PeriodQueryDto } from '../common/dto/period-query.dto'
import { stripCostPrice } from '../common/utils/strip-cost.util'
import { Express } from 'express'

// SELLER по бизнес-требованиям проекта не имеет доступа к складу/товарам —
// только ADMIN (кросс-маркет) и OWNER (свой маркет) могут работать с продуктами.
@ApiTags('Products')
@ApiBearerAuth()
@ApiErrorResponse()
@Roles(Role.ADMIN, Role.OWNER, Role.SELLER)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.OWNER)
  @UploadImage()
  @ApiOperation({ summary: 'Create a product', description: 'Creates a new product with an optional image in the current user\'s market.' })
  @ApiBody({
    description: 'Product creation payload (multipart/form-data)',
    schema: {
      type: 'object',
      required: ['name', 'price', 'quantity'],
      properties: {
        name: { type: 'string', example: 'Apple', description: 'Product name (2-200 chars)' },
        description: { type: 'string', example: 'Fresh red apples', description: 'Product description (max 1000 chars)' },
        price: { type: 'number', example: 1.5, description: 'Product price (min 0.01)' },
        quantity: { type: 'number', example: 100, description: 'Available quantity (min 0)' },
        image: { type: 'string', format: 'binary', description: 'Product image (jpg, png, webp, gif; max 5MB)' },
      },
    },
  })
  @ApiCreatedResponse({ type: ProductResponseDto, description: 'The created product' })
  create(
    @Body() dto: CreateProductDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.create(dto, file, user.marketId, user.sub)
  }

  // Каждый товар в выдаче обогащается метриками за период (скорость продаж,
  // запас в днях, возвраты, срочность закупки) — фронтенд их не считает.
  @Get()
  @ApiOperation({
    summary: 'List products with business metrics',
    description:
      "Returns a paginated list of products for the current user's market, each enriched with sales velocity, days of stock, return rate, health and reorder priority.",
  })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiQuery({ name: 'search', required: false, description: 'Search by product name' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (1-based)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiQuery({ name: 'archived', required: false, example: false, description: 'true — archived products only (default: active only)' })
  @ApiQuery({ name: 'days', required: false, example: 30, description: 'Rolling metrics window in days; overrides period' })
  async findAll(@Query() query: QueryProductDto, @CurrentUser() user: JwtPayload): Promise<PaginatedResult<unknown>> {
    const result = await this.productsService.findAll(query, user.marketId)
    // Закупочная цена — данные владельца: продавец видит каталог без неё.
    return user.role === Role.SELLER ? stripCostPrice(result) : result
  }

  // Статические маршруты (summary) обязаны стоять раньше :id — иначе
  // ParseUUIDPipe попытается разобрать слово «summary» как идентификатор.
  @Get('summary')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOperation({
    summary: 'Stock summary for the products screen header',
    description:
      'Active/archived counts, out-of-stock and low-stock counts, stock value at retail and at cost, potential profit and how many products have no cost price.',
  })
  summary(@CurrentUser() user: JwtPayload) {
    return this.productsService.summary(user.marketId)
  }

  // Массовая смена цен: тоже статический путь, поэтому до :id.
  @Post('bulk-price')
  @Roles(Role.ADMIN, Role.OWNER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change prices of many products by a percentage',
    description:
      'Applies +/−N% to the price of all active products (optionally one category) and rounds to a step. Use dryRun=true first to preview. Cost price and past receipts are not touched.',
  })
  bulkPrice(@Body() dto: BulkPriceDto, @CurrentUser() user: JwtPayload) {
    return this.productsService.bulkPrice(dto, user.marketId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID', description: 'Returns a single product with full details, period metrics and period-over-period comparison.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiQuery({ name: 'period', required: false, enum: AnalyticsPeriod, description: 'Metrics window. Default: month' })
  @ApiOkResponse({ type: ProductResponseDto, description: 'The found product' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: PeriodQueryDto,
  ) {
    const product = await this.productsService.findOne(id, user.marketId, query.period)
    return user.role === Role.SELLER ? stripCostPrice(product) : product
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @UploadImage()
  @ApiOperation({ summary: 'Update a product', description: 'Updates a product with partial data and an optional new image. Stock is NOT editable here: use restock, write-off or adjust.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiBody({
    description: 'Product update payload (multipart/form-data). Send a new image to replace the existing one, or omit to keep it.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Apple', description: 'Product name (2-200 chars)' },
        description: { type: 'string', example: 'Fresh red apples', description: 'Product description (max 1000 chars)' },
        price: { type: 'number', example: 1.5, description: 'Product price (min 0.01)' },
        image: { type: 'string', format: 'binary', description: 'New product image (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: ProductResponseDto, description: 'The updated product' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.update(id, dto, file, user.marketId)
  }

  // Пополнение — отдельное действие, а не PATCH: PATCH перезаписывает остаток,
  // а здесь число прибавляется к текущему внутри БД (см. ProductsService.restock).
  @Post(':id/restock')
  @Roles(Role.ADMIN, Role.OWNER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Add stock to a product',
    description:
      'Adds the given number of units to the current stock atomically. Use it when a delivery arrives: PATCH overwrites the quantity with a new total, restock adds to it, so sales made in the meantime are not lost.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiBody({ type: RestockProductDto })
  @ApiOkResponse({ type: ProductResponseDto, description: 'The product with the updated stock' })
  restock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestockProductDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.restock(id, dto, user.marketId, user.sub)
  }

  @Post(':id/write-off')
  @Roles(Role.ADMIN, Role.OWNER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Write stock off (damaged, expired, lost, own use)',
    description: 'Removes units from stock atomically with a mandatory reason. Cannot take the stock below zero.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiBody({ type: WriteOffProductDto })
  @ApiOkResponse({ type: ProductResponseDto, description: 'The product with the updated stock' })
  writeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WriteOffProductDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.writeOff(id, dto, user.marketId, user.sub)
  }

  @Post(':id/adjust')
  @Roles(Role.ADMIN, Role.OWNER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stock count (inventory): set the counted total',
    description:
      'Sets stock to the counted number; the difference is recorded as an ADJUSTMENT. Answers 409 PRODUCT_STOCK_CHANGED if sales happened while counting.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiBody({ type: AdjustStockDto })
  @ApiOkResponse({ type: ProductResponseDto, description: 'The product with the updated stock' })
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.adjust(id, dto, user.marketId, user.sub)
  }

  @Get(':id/movements')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOperation({
    summary: 'Stock history of a product',
    description: 'Paginated journal of every stock change (sale, refund, restock, write-off, count), newest first, with balance after each.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  movements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryMovementsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.findMovements(id, query, user.marketId)
  }

  @Post(':id/archive')
  @Roles(Role.ADMIN, Role.OWNER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Archive a product',
    description: 'Hides the product from the catalog and from sales. History and receipts stay intact. Reversible.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiOkResponse({ type: ProductResponseDto })
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.setArchived(id, true, user.marketId)
  }

  @Post(':id/unarchive')
  @Roles(Role.ADMIN, Role.OWNER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a product from the archive' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiOkResponse({ type: ProductResponseDto })
  unarchive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.setArchived(id, false, user.marketId)
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOperation({ summary: 'Delete a product', description: 'Deletes a product that has no sales history (its stock journal goes with it). With history answers 409 PRODUCT_HAS_TRANSACTIONS — archive it instead.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product successfully deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user.marketId)
  }
}
