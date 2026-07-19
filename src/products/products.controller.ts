import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { multerOptions } from '../common/utils/multipart.util'
import { ProductsService } from './products.service'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { QueryProductDto } from './dto/query-product.dto'
import { ProductResponseDto } from './dto/product-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { Express } from 'express'

@ApiTags('Products')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a product', description: 'Creates a new product with an optional image in the current user\'s market.' })
  @ApiConsumes('multipart/form-data')
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
  @UseInterceptors(FileInterceptor('image', multerOptions))
  create(
    @Body() dto: CreateProductDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.create(dto, file, user.marketId)
  }

  @Get()
  @ApiOperation({ summary: 'List products', description: 'Returns a paginated list of products for the current user\'s market.' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiQuery({ name: 'search', required: false, description: 'Search by product name' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (1-based)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  findAll(@Query() query: QueryProductDto, @CurrentUser() user: JwtPayload): Promise<PaginatedResult<unknown>> {
    return this.productsService.findAll(query, user.marketId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID', description: 'Returns a single product with full details.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiOkResponse({ type: ProductResponseDto, description: 'The found product' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a product', description: 'Updates a product with partial data and an optional new image.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Product update payload (multipart/form-data). Send a new image to replace the existing one, or omit to keep it.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Apple', description: 'Product name (2-200 chars)' },
        description: { type: 'string', example: 'Fresh red apples', description: 'Product description (max 1000 chars)' },
        price: { type: 'number', example: 1.5, description: 'Product price (min 0.01)' },
        quantity: { type: 'number', example: 100, description: 'Available quantity (min 0)' },
        image: { type: 'string', format: 'binary', description: 'New product image (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: ProductResponseDto, description: 'The updated product' })
  @UseInterceptors(FileInterceptor('image', multerOptions))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.update(id, dto, file, user.marketId)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product', description: 'Deletes a product and its associated image.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product successfully deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user.marketId)
  }
}
