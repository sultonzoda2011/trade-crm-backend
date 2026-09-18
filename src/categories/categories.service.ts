import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Express } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { QueryCategoryDto } from './dto/query-category.dto'
import { MarketsService } from '../markets/markets.service'
import { ProductsService } from '../products/products.service'
import { QueryProductDto } from '../products/dto/query-product.dto'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'

/** Превью товаров категории на детальной странице — дальше "Все". */
const CATEGORY_PRODUCTS_PREVIEW_LIMIT = 5

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly marketsService: MarketsService,
    private readonly productsService: ProductsService,
  ) {}

  async create(dto: CreateCategoryDto, file?: Express.Multer.File, marketId?: string) {
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')
    const existing = await this.prisma.category.findFirst({ where: { marketId, name: dto.name } })
    if (existing) throw new ConflictException('Category with this name already exists')
    const image = file ? await this.storageService.save(file, 'categories') : undefined
    return this.prisma.category.create({ data: { ...dto, image, marketId }, include: { _count: { select: { products: true } } } })
  }

  async findAll(query: QueryCategoryDto, marketId?: string) {
    const where: Prisma.CategoryWhereInput = {}

    if (marketId) where.marketId = marketId
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' }
    if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
    if (query.hasProducts != null) {
      where.products = query.hasProducts ? { some: {} } : { none: {} }
    }

    return paginate(query, ({ skip, take }) =>
      this.prisma.category.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'name', [
          'createdAt',
          'name',
          'updatedAt'
        ]),
        skip,
        take,
      }),
      () => this.prisma.category.count({ where }),
    )
  }

  async findOne(id: string, marketId?: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    })
    if (!category) throw new NotFoundException('Category not found')
    if (marketId && category.marketId !== marketId) throw new NotFoundException('Category not found')
    return category
  }

  /**
   * Карточка категории + её маркет + превью товаров — одним запросом.
   *
   * На фронте это раньше было НАСТОЯЩИМ waterfall (не просто параллельные
   * запросы): маркет грузился вторым запросом, который ждал marketId из
   * ответа на первый. Здесь та же зависимость есть, но она внутри одного
   * запроса к бэку — один медленный клиентский round-trip вместо двух.
   */
  async findOneFull(id: string, requestingUser: JwtPayload) {
    const category = await this.findOne(id, requestingUser.marketId)

    const [market, products] = await Promise.all([
      // Та же логика видимости маркета, что и в MarketsController.findOne:
      // OWNER видит только свой маркет, ADMIN/SELLER — без ограничения.
      this.marketsService.findOne(
        category.marketId,
        requestingUser.role === Role.OWNER ? requestingUser.marketId : undefined
      ),
      this.productsService.findAll(
        { categoryId: id, page: 1, limit: CATEGORY_PRODUCTS_PREVIEW_LIMIT } as QueryProductDto,
        requestingUser.marketId
      )
    ])

    return { category, market, products }
  }

  async update(id: string, dto: UpdateCategoryDto, file?: Express.Multer.File, marketId?: string) {
    const category = await this.findOne(id, marketId)

    const data: any = { ...dto }

    if (file) {
      if (category.image) {
        await this.storageService.delete(category.image)
      }
      data.image = await this.storageService.save(file, 'categories')
    }

    return this.prisma.category.update({ where: { id }, data, include: { _count: { select: { products: true } } } })
  }

  async remove(id: string, marketId?: string) {
    const category = await this.findOne(id, marketId)
    const productsCount = await this.prisma.product.count({ where: { categoryId: id } })
    if (productsCount > 0) {
      throw new ConflictException('Cannot delete a category that still has products')
    }

    if (category.image) {
      await this.storageService.delete(category.image)
    }

    await this.prisma.category.delete({ where: { id } })
  }
}
