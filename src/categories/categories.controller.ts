import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UploadedFile } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { UploadImage } from '../common/decorators/upload-image.decorator'
import { stripCostPrice } from '../common/utils/strip-cost.util'
import { CategoriesService } from './categories.service'
import { CATEGORY_COLORS } from './category-colors'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { QueryCategoryDto } from './dto/query-category.dto'
import { DeleteCategoryQueryDto } from './dto/delete-category-query.dto'
import { ReorderCategoriesDto } from './dto/reorder-categories.dto'
import { CategoryResponseDto } from './dto/category-response.dto'
import { Express } from 'express'

// Читать категории могут все (продавцу они нужны в выборе товара), а менять —
// только владелец и админ: раньше у POST/PATCH/DELETE не было сужения, и
// продавец мог через API создать, переименовать или удалить категорию.
@ApiTags('Categories')
@ApiBearerAuth()
@ApiErrorResponse()
@Roles(Role.ADMIN, Role.OWNER, Role.SELLER)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.OWNER)
  @UploadImage()
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', example: 'Beverages' },
        description: { type: 'string', example: 'Soft drinks and juices' },
        color: { type: 'string', enum: [...CATEGORY_COLORS], example: 'blue' },
        image: { type: 'string', format: 'binary', description: 'Category image (jpg, png, webp, gif; max 5MB)' },
      },
    },
  })
  @ApiCreatedResponse({ type: CategoryResponseDto, description: 'Category created at the end of the list' })
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.categoriesService.create(dto, file, user)
  }

  @Get()
  @ApiOperation({
    summary: 'List categories in the owner-defined order',
    description:
      'Each item carries active products count, low/out-of-stock counts and (owner/admin only) stock value at retail price. Sorted by the owner-defined order unless sortBy is given.',
  })
  @ApiOkResponse({ type: [CategoryResponseDto], description: 'List categories for the current market' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'sortBy', required: false, example: 'sortOrder' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  findAll(@Query() query: QueryCategoryDto, @CurrentUser() user: JwtPayload) {
    return this.categoriesService.findAll(query, user)
  }

  // Статические пути (summary, order) стоят раньше :id.
  @Get('summary')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOperation({
    summary: 'Categories screen header',
    description:
      'Number of categories, active products, stock value, and how many products (and what value) have no category.',
  })
  summary(@CurrentUser() user: JwtPayload) {
    return this.categoriesService.summary(user)
  }

  @Put('order')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOperation({
    summary: 'Set the category order',
    description: 'Ids in the desired order. Categories not listed keep their relative order after the listed ones.',
  })
  reorder(@Body() dto: ReorderCategoriesDto, @CurrentUser() user: JwtPayload) {
    return this.categoriesService.reorder(dto, user)
  }

  @Get(':id')
  @ApiOkResponse({ type: CategoryResponseDto, description: 'Category details' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.categoriesService.findOne(id, user)
  }

  @Get(':id/full')
  @ApiOkResponse({ description: 'Category detail page in one round-trip: category + its market + products preview' })
  async findOneFull(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.categoriesService.findOneFull(id, user)
    // В превью лежат товары: закупочная цена — данные владельца.
    return user.role === Role.SELLER ? stripCostPrice(result) : result
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @UploadImage()
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Beverages' },
        description: { type: 'string', example: 'Soft drinks and juices' },
        color: { type: 'string', enum: [...CATEGORY_COLORS, ''], description: 'Empty string clears the color' },
        image: { type: 'string', format: 'binary', description: 'New category image (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: CategoryResponseDto, description: 'Category updated' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.categoriesService.update(id, dto, file, user)
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @ApiOperation({
    summary: 'Delete a category',
    description:
      'A category with products needs a choice: ?moveTo=<categoryId> moves all its products (including archived) there, ?detach=true leaves them without a category. Otherwise 409 CATEGORY_HAS_PRODUCTS.',
  })
  @ApiOkResponse({ description: 'Category deleted; how many products were moved or detached' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteCategoryQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.categoriesService.remove(id, query, user)
  }
}
