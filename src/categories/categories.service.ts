import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Express } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { buildDateWhere, paginate } from '../common/utils/paginate.util'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { QueryCategoryDto } from './dto/query-category.dto'
import { DeleteCategoryQueryDto } from './dto/delete-category-query.dto'
import { ReorderCategoriesDto } from './dto/reorder-categories.dto'
import { MarketsService } from '../markets/markets.service'
import { marketScope } from '../markets/market-scope.util'
import { ProductsService } from '../products/products.service'
import { QueryProductDto } from '../products/dto/query-product.dto'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'

/** Превью товаров категории на детальной странице — дальше «Все». */
const CATEGORY_PRODUCTS_PREVIEW_LIMIT = 5

/** Поля, по которым можно явно сортировать список (иначе — порядок владельца). */
const SORTABLE_FIELDS = ['createdAt', 'name', 'updatedAt', 'sortOrder'] as const

/** Показатели товаров одной категории: считаются одним проходом по Product. */
interface CategoryStats {
  activeCount: number
  archivedCount: number
  lowStockCount: number
  outOfStockCount: number
  stockValue: number
}

const EMPTY_STATS: CategoryStats = {
  activeCount: 0,
  archivedCount: 0,
  lowStockCount: 0,
  outOfStockCount: 0,
  stockValue: 0
}

type CategoryRow = Prisma.CategoryGetPayload<object>

/** Пустая строка из формы = «очистить поле». */
const emptyToNull = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value.trim() === '' ? null : value.trim()

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly marketsService: MarketsService,
    private readonly productsService: ProductsService
  ) {}

  /**
   * Статистика товаров по категориям одним запросом. Считаем только активные
   * товары: архивные не продаются и не лежат на складе, а их число отдаём
   * отдельно (нужно, чтобы удаление честно предупредило о переносе).
   */
  private async statsFor(categoryIds: string[]): Promise<Map<string, CategoryStats>> {
    const result = new Map<string, CategoryStats>()
    if (categoryIds.length === 0) return result

    const rows = await this.prisma.$queryRaw<
      ({ categoryId: string } & CategoryStats)[]
    >`
      SELECT
        p."categoryId" AS "categoryId",
        COUNT(*) FILTER (WHERE p."isActive")::int AS "activeCount",
        COUNT(*) FILTER (WHERE NOT p."isActive")::int AS "archivedCount",
        COUNT(*) FILTER (
          WHERE p."isActive" AND p."quantity" > 0
            AND p."quantity" <= p."lowStockThreshold"
        )::int AS "lowStockCount",
        COUNT(*) FILTER (WHERE p."isActive" AND p."quantity" = 0)::int AS "outOfStockCount",
        COALESCE(SUM(p."price" * p."quantity") FILTER (WHERE p."isActive"), 0)::float AS "stockValue"
      FROM "Product" p
      WHERE p."categoryId" IN (${Prisma.join(categoryIds)})
      GROUP BY p."categoryId"
    `
    for (const { categoryId, ...stats } of rows) result.set(categoryId, stats)
    return result
  }

  /**
   * Категория + показатели. `_count.products` — это АКТИВНЫЕ товары (раньше
   * считались и архивные, и «12 товаров» врало). Деньги отдаём только тем,
   * кто видит финансы: продавцу сумма остатка не нужна.
   */
  private withStats(
    category: CategoryRow,
    stats: CategoryStats | undefined,
    includeMoney: boolean
  ) {
    const s = stats ?? EMPTY_STATS
    return {
      ...category,
      _count: { products: s.activeCount },
      archivedCount: s.archivedCount,
      lowStockCount: s.lowStockCount,
      outOfStockCount: s.outOfStockCount,
      ...(includeMoney ? { stockValue: s.stockValue } : {})
    }
  }

  private async nameTaken(marketId: string, name: string, exceptId?: string) {
    const existing = await this.prisma.category.findFirst({
      where: {
        marketId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {})
      },
      select: { id: true }
    })
    return existing !== null
  }

  private nameTakenError() {
    return new ConflictException({
      message: 'Category with this name already exists',
      code: 'CATEGORY_NAME_TAKEN'
    })
  }

  async create(dto: CreateCategoryDto, file: Express.Multer.File | undefined, user: JwtPayload) {
    const marketId = user.marketId
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')
    if (await this.nameTaken(marketId, dto.name)) throw this.nameTakenError()

    // Новая категория встаёт в конец списка владельца.
    const last = await this.prisma.category.aggregate({
      where: { marketId },
      _max: { sortOrder: true }
    })
    const sortOrder = (last._max.sortOrder ?? -1) + 1

    const image = file ? await this.storageService.save(file, 'categories') : undefined
    try {
      const created = await this.prisma.category.create({
        data: {
          name: dto.name,
          description: emptyToNull(dto.description) ?? undefined,
          color: emptyToNull(dto.color) ?? undefined,
          image,
          marketId,
          sortOrder
        }
      })
      return this.withStats(created, undefined, true)
    } catch (error) {
      // Гонка двух одинаковых названий: проверка выше её не ловит.
      if ((error as { code?: string }).code === 'P2002') throw this.nameTakenError()
      throw error
    }
  }

  async findAll(query: QueryCategoryDto, user: JwtPayload) {
    const scope = marketScope(user)
    const includeMoney = user.role !== Role.SELLER
    const where: Prisma.CategoryWhereInput = {}

    if (scope) where.marketId = scope
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' }
    if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
    if (query.hasProducts != null) {
      where.products = query.hasProducts
        ? { some: { isActive: true } }
        : { none: { isActive: true } }
    }

    // Без явной сортировки — порядок, который расставил владелец. По умолчанию
    // у всех sortOrder = 0, поэтому тай-брейк по имени даёт алфавит.
    const explicit =
      query.sortBy && (SORTABLE_FIELDS as readonly string[]).includes(query.sortBy)
        ? query.sortBy
        : undefined
    const orderBy: Prisma.CategoryOrderByWithRelationInput[] = explicit
      ? [{ [explicit]: query.sortOrder ?? 'asc' }, { name: 'asc' }]
      : [{ sortOrder: 'asc' }, { name: 'asc' }]

    const page = await paginate(
      query,
      ({ skip, take }) => this.prisma.category.findMany({ where, orderBy, skip, take }),
      () => this.prisma.category.count({ where })
    )
    const stats = await this.statsFor(page.data.map(c => c.id))
    return {
      ...page,
      data: page.data.map(c => this.withStats(c, stats.get(c.id), includeMoney))
    }
  }

  /**
   * Сводка для шапки раздела: сколько категорий, сколько товаров лежит без
   * категории и на какую сумму. Только владелец/админ.
   */
  async summary(user: JwtPayload) {
    const scope = marketScope(user)
    const market = scope ? Prisma.sql`AND p."marketId" = ${scope}` : Prisma.empty

    const [categories, [row]] = await Promise.all([
      this.prisma.category.count({ where: scope ? { marketId: scope } : {} }),
      this.prisma.$queryRaw<
        {
          products: number
          stockValue: number
          uncategorizedProducts: number
          uncategorizedValue: number
        }[]
      >`
        SELECT
          COUNT(*)::int AS "products",
          COALESCE(SUM(p."price" * p."quantity"), 0)::float AS "stockValue",
          COUNT(*) FILTER (WHERE p."categoryId" IS NULL)::int AS "uncategorizedProducts",
          COALESCE(SUM(p."price" * p."quantity") FILTER (WHERE p."categoryId" IS NULL), 0)::float
            AS "uncategorizedValue"
        FROM "Product" p
        WHERE p."isActive" ${market}
      `
    ])
    return { categories, ...row }
  }

  async findOne(id: string, user: JwtPayload) {
    const scope = marketScope(user)
    const category = await this.prisma.category.findUnique({ where: { id } })
    // Чужая категория — «не найдена», а не «запрещена»: не раскрываем, что она есть.
    if (!category || (scope && category.marketId !== scope)) {
      throw new NotFoundException('Category not found')
    }
    const stats = await this.statsFor([id])
    return this.withStats(category, stats.get(id), user.role !== Role.SELLER)
  }

  /**
   * Карточка категории + её рынок + превью товаров — одним запросом (на фронте
   * это был настоящий waterfall: рынок ждал marketId из первого ответа).
   */
  async findOneFull(id: string, user: JwtPayload) {
    const category = await this.findOne(id, user)

    const [market, products] = await Promise.all([
      this.marketsService.findOne(category.marketId, marketScope(user)),
      this.productsService.findAll(
        { categoryId: id, page: 1, limit: CATEGORY_PRODUCTS_PREVIEW_LIMIT } as QueryProductDto,
        marketScope(user)
      )
    ])

    return { category, market, products }
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    file: Express.Multer.File | undefined,
    user: JwtPayload
  ) {
    const category = await this.findOne(id, user)

    if (dto.name !== undefined && (await this.nameTaken(category.marketId, dto.name, id))) {
      throw this.nameTakenError()
    }

    const data: Prisma.CategoryUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.description !== undefined) data.description = emptyToNull(dto.description)
    if (dto.color !== undefined) data.color = emptyToNull(dto.color)
    if (file) {
      data.image = await this.storageService.replace(category.image, file, 'categories')
    }

    try {
      const updated = await this.prisma.category.update({ where: { id }, data })
      const stats = await this.statsFor([id])
      return this.withStats(updated, stats.get(id), true)
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw this.nameTakenError()
      throw error
    }
  }

  /**
   * Новый порядок. Принимает ids в нужной последовательности; не названные
   * категории (например, добавленные с другого телефона) встают после них в
   * прежнем порядке. Все ids должны быть одного рынка и видны вызывающему.
   */
  async reorder(dto: ReorderCategoriesDto, user: JwtPayload) {
    const scope = marketScope(user)
    const listed = await this.prisma.category.findMany({
      where: { id: { in: dto.ids }, ...(scope ? { marketId: scope } : {}) },
      select: { id: true, marketId: true }
    })
    if (listed.length !== dto.ids.length) throw new NotFoundException('Category not found')

    const marketId = listed[0].marketId
    if (listed.some(c => c.marketId !== marketId)) throw new NotFoundException('Category not found')

    const rest = await this.prisma.category.findMany({
      where: { marketId, id: { notIn: dto.ids } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true }
    })
    const finalOrder = [...dto.ids, ...rest.map(c => c.id)]

    await this.prisma.$transaction(
      finalOrder.map((categoryId, index) =>
        this.prisma.category.update({
          where: { id: categoryId },
          data: { sortOrder: index },
          select: { id: true }
        })
      )
    )
    return { updated: finalOrder.length }
  }

  /**
   * Удаление. Если в категории есть товары (в том числе архивные — на них
   * ссылается внешний ключ), нужно сказать, что с ними делать: `moveTo`
   * переносит их в другую категорию, `detach` оставляет без категории. Без
   * выбора — 409 с числом товаров, фронт показывает выбор.
   */
  async remove(id: string, query: DeleteCategoryQueryDto, user: JwtPayload) {
    const category = await this.findOne(id, user)
    const productsCount = await this.prisma.product.count({ where: { categoryId: id } })

    let targetId: string | null = null
    if (productsCount > 0) {
      if (query.moveTo) {
        if (query.moveTo === id) {
          throw new BadRequestException({
            message: 'Cannot move products to the category being deleted',
            code: 'CATEGORY_MOVE_TARGET_INVALID'
          })
        }
        // Куда переносим — только своя категория того же рынка.
        const target = await this.prisma.category.findFirst({
          where: { id: query.moveTo, marketId: category.marketId },
          select: { id: true }
        })
        if (!target) throw new NotFoundException('Category not found')
        targetId = target.id
      } else if (!query.detach) {
        throw new ConflictException({
          message: 'Cannot delete a category that still has products',
          code: 'CATEGORY_HAS_PRODUCTS',
          details: { productsCount }
        })
      }
    }

    await this.prisma.$transaction(async tx => {
      if (productsCount > 0) {
        await tx.product.updateMany({
          where: { categoryId: id },
          data: { categoryId: targetId }
        })
      }
      await tx.category.delete({ where: { id } })
    })

    // Картинку убираем после успешной транзакции: упавшее удаление не должно
    // оставить категорию без фото.
    if (category.image) await this.storageService.delete(category.image)

    return { movedProducts: targetId ? productsCount : 0, detachedProducts: targetId ? 0 : productsCount }
  }
}
