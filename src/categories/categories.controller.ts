import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { multerOptions } from '../common/utils/multipart.util'
import { CategoriesService } from './categories.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { QueryCategoryDto } from './dto/query-category.dto'
import { CategoryResponseDto } from './dto/category-response.dto'
import { Express } from 'express'

@ApiTags('Categories')
@ApiBearerAuth()
@ApiErrorResponse()
@Roles(Role.ADMIN, Role.OWNER)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', example: 'Beverages' },
        description: { type: 'string', example: 'Soft drinks and juices' },
        image: { type: 'string', format: 'binary', description: 'Category image (jpg, png, webp, gif; max 5MB)' },
      },
    },
  })
  @ApiCreatedResponse({ type: CategoryResponseDto, description: 'Category created' })
  @UseInterceptors(FileInterceptor('image', multerOptions))
  create(
    @Body() dto: CreateCategoryDto,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser('marketId') marketId?: string,
  ) {
    return this.categoriesService.create(dto, file, marketId)
  }

  @Get()
  @ApiOkResponse({ type: [CategoryResponseDto], description: 'List categories for the current market' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'sortBy', required: false, example: 'name' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  findAll(@Query() query: QueryCategoryDto, @CurrentUser('marketId') marketId?: string) {
    return this.categoriesService.findAll(query, marketId)
  }

  @Get(':id')
  @ApiOkResponse({ type: CategoryResponseDto, description: 'Category details' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('marketId') marketId?: string) {
    return this.categoriesService.findOne(id, marketId)
  }

  @Patch(':id')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Beverages' },
        description: { type: 'string', example: 'Soft drinks and juices' },
        image: { type: 'string', format: 'binary', description: 'New category image (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: CategoryResponseDto, description: 'Category updated' })
  @UseInterceptors(FileInterceptor('image', multerOptions))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser('marketId') marketId?: string,
  ) {
    return this.categoriesService.update(id, dto, file, marketId)
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Category deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('marketId') marketId?: string) {
    return this.categoriesService.remove(id, marketId)
  }
}
