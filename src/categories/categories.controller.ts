import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { CategoriesService } from './categories.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'

@ApiTags('Categories')
@ApiBearerAuth()
@ApiErrorResponse()
@Roles(Role.ADMIN, Role.OWNER)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @ApiCreatedResponse({ description: 'Category created' })
  create(@Body() dto: CreateCategoryDto, @CurrentUser('marketId') marketId?: string) {
    return this.categoriesService.create(dto, marketId)
  }

  @Get()
  @ApiOkResponse({ description: 'List categories for the current market' })
  findAll(@CurrentUser('marketId') marketId?: string) {
    return this.categoriesService.findAll(marketId)
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Category details' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('marketId') marketId?: string) {
    return this.categoriesService.findOne(id, marketId)
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'Category updated' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser('marketId') marketId?: string,
  ) {
    return this.categoriesService.update(id, dto, marketId)
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Category deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('marketId') marketId?: string) {
    return this.categoriesService.remove(id, marketId)
  }
}
