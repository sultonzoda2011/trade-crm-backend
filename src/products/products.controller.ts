import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { ProductsService } from './products.service'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { QueryProductDto } from './dto/query-product.dto'
import { ProductResponseDto } from './dto/product-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'

@ApiTags('Products')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiCreatedResponse({ type: ProductResponseDto })
  create(@Body() dto: CreateProductDto, @CurrentUser() user: JwtPayload) {
    return this.productsService.create(dto, user.marketId)
  }

  @Get()
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiQuery({ name: 'search', required: false, description: 'Search by product name' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  findAll(@Query() query: QueryProductDto, @CurrentUser() user: JwtPayload): Promise<PaginatedResult<unknown>> {
    return this.productsService.findAll(query, user.marketId)
  }

  @Get(':id')
  @ApiOkResponse({ type: ProductResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id)
  }

  @Patch(':id')
  @ApiOkResponse({ type: ProductResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.update(id, dto, user.marketId)
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Product deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user.marketId)
  }
}
