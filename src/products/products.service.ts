import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import {
	AnalyticsService,
	ProductMetrics,
	ReorderPriority
} from '../analytics/analytics.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { AnalyticsPeriod } from '../common/dto/period-query.dto'
import { buildComparison, resolvePeriod } from '../common/utils/period.util'
import {
	buildDateWhere,
	buildOrderBy,
	paginate
} from '../common/utils/paginate.util'
import { CreateProductDto } from './dto/create-product.dto'
import { QueryProductDto } from './dto/query-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { Express } from 'express'

const productInclude = {
	market: { select: { id: true, name: true, address: true, image: true } },
	category: { select: { id: true, name: true, image: true } },
	_count: { select: { transactionItems: true } }
} as const

interface ProductSalesRow {
	count: number
	unitsSold: number
	refundedUnits: number
	revenue: number
}

/** Порядок срочности закупки для сортировки выдачи. */
const REORDER_PRIORITY_ORDER: Record<ReorderPriority, number> = {
	[ReorderPriority.OUT_OF_STOCK]: 0,
	[ReorderPriority.CRITICAL]: 1,
	[ReorderPriority.WARNING]: 2,
	[ReorderPriority.OK]: 3,
	[ReorderPriority.NOT_NEEDED]: 4
}

/**
 * Поля сортировки, которых нет в БД: по ним нельзя сортировать SQL-ом,
 * поэтому запрос уходит на аналитический путь.
 */
const ANALYTICS_SORT_FIELDS = [
	'reorderPriority',
	'daysOfStockRemaining',
	'avgDailySales',
	'netUnitsSold',
	'unitsSold',
	'revenue',
	'returnRate',
	'recommendedQuantity'
]

/**
 * Потолок для аналитического пути. Каталог одного маркета столько не набирает,
 * но без ограничения одна аномально большая база положила бы память процесса.
 */
const ANALYTICS_CATALOG_LIMIT = 5000

/** Минимум полей товара, нужный расчёту метрик. */
type ProductRecord = { id: string; quantity: number; lowStockThreshold: number }

@Injectable()
export class ProductsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService,
		private readonly analytics: AnalyticsService
	) {}

	async create(
		dto: CreateProductDto,
		file: Express.Multer.File,
		marketId?: string
	) {
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')
		const image = file
			? await this.storageService.save(file, 'products')
			: undefined
		return this.prisma.product.create({
			data: { ...dto, image, marketId },
			include: productInclude
		})
	}

	/**
	 * Список товаров с бизнес-метриками (скорость продаж, запас в днях,
	 * возвраты, приоритет закупки, состояние).
	 *
	 * Два пути намеренно разведены:
	 *  - обычный — фильтры и пагинация выполняются в БД, метрики считаются
	 *    только для товаров текущей страницы (один дополнительный агрегат);
	 *  - аналитический — когда фильтр или сортировка идут по вычисляемым
	 *    полям (health, reorderPriority, запас в днях). Такие значения в БД не
	 *    хранятся, поэтому отфильтровать их SQL-ом невозможно: каталог маркета
	 *    считается целиком и страницу нарезаем уже после расчёта.
	 */
	async findAll(
		query: QueryProductDto,
		userMarketId?: string
	): Promise<PaginatedResult<unknown>> {
		const usesComputedFields =
			Boolean(query.health) ||
			Boolean(query.reorderPriority) ||
			query.needsReorder === true ||
			ANALYTICS_SORT_FIELDS.includes(query.sortBy ?? '')

		if (usesComputedFields) {
			return this.findAllByAnalytics(query, userMarketId)
		}

		const page = await this.findAllFromDatabase(query, userMarketId)
		const { current, durationDays } = resolvePeriod({ period: query.period })
		const products = page.data as ProductRecord[]

		const sales = await this.analytics.getProductSalesRows(
			current,
			userMarketId,
			products.map(product => product.id)
		)

		return {
			...page,
			data: products.map(product => ({
				...product,
				metrics: this.analytics.computeProductMetrics(
					product,
					sales.get(product.id),
					durationDays
				)
			}))
		}
	}

	/**
	 * Аналитический путь: считаем метрики по всему каталогу маркета, затем
	 * фильтруем и сортируем по вычисленным полям. Каталог одного маркета —
	 * это сотни, а не миллионы строк, и берём мы только нужные колонки,
	 * поэтому один проход дешевле, чем денормализация метрик в БД.
	 */
	private async findAllByAnalytics(
		query: QueryProductDto,
		userMarketId?: string
	): Promise<PaginatedResult<unknown>> {
		const where: Prisma.ProductWhereInput = {}
		if (userMarketId) where.marketId = userMarketId
		if (query.categoryId) where.categoryId = query.categoryId
		if (query.search) {
			where.name = { contains: query.search, mode: 'insensitive' }
		}
		if (query.priceMin != null || query.priceMax != null) {
			where.price = {}
			if (query.priceMin != null) where.price.gte = query.priceMin
			if (query.priceMax != null) where.price.lte = query.priceMax
		}

		const [products, { current, durationDays }] = await Promise.all([
			this.prisma.product.findMany({
				where,
				include: productInclude,
				take: ANALYTICS_CATALOG_LIMIT
			}),
			Promise.resolve(resolvePeriod({ period: query.period }))
		])

		const sales = await this.analytics.getProductSalesRows(current, userMarketId)

		let rows = products.map(product => ({
			...product,
			metrics: this.analytics.computeProductMetrics(
				product,
				sales.get(product.id),
				durationDays
			)
		}))

		if (query.health) {
			rows = rows.filter(row => row.metrics.health === query.health)
		}
		if (query.reorderPriority) {
			rows = rows.filter(
				row => row.metrics.reorderPriority === query.reorderPriority
			)
		}
		if (query.needsReorder) {
			rows = rows.filter(row => row.metrics.recommendedQuantity > 0)
		}

		rows.sort(this.buildMetricsComparator(query.sortBy, query.sortOrder))

		const page = query.page ?? 1
		const limit = Math.min(query.limit ?? 20, 100)
		const total = rows.length

		return {
			data: rows.slice((page - 1) * limit, page * limit),
			meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
		}
	}

	/**
	 * Сортировка по вычисленным метрикам. По умолчанию — по срочности закупки:
	 * это главный вопрос пользователя к этому экрану («что заказать?»).
	 */
	private buildMetricsComparator(
		sortBy: string | undefined,
		sortOrder: 'asc' | 'desc' = 'desc'
	) {
		const direction = sortOrder === 'asc' ? 1 : -1

		return (
			a: { name: string; metrics: ProductMetrics },
			b: { name: string; metrics: ProductMetrics }
		) => {
			if (!sortBy || sortBy === 'reorderPriority') {
				const diff =
					REORDER_PRIORITY_ORDER[a.metrics.reorderPriority] -
					REORDER_PRIORITY_ORDER[b.metrics.reorderPriority]
				// Внутри одной срочности первым идёт тот, у кого меньше запас в днях.
				if (diff !== 0) return diff
				return (
					(a.metrics.daysOfStockRemaining ?? Number.POSITIVE_INFINITY) -
					(b.metrics.daysOfStockRemaining ?? Number.POSITIVE_INFINITY)
				)
			}

			if (sortBy === 'daysOfStockRemaining') {
				// Товары без продаж (null) всегда в конце: у них запас неизвестен,
				// и ставить их рядом с заканчивающимися было бы дезинформацией.
				const aValue = a.metrics.daysOfStockRemaining
				const bValue = b.metrics.daysOfStockRemaining
				if (aValue === null && bValue === null) return 0
				if (aValue === null) return 1
				if (bValue === null) return -1
				return (aValue - bValue) * direction
			}

			const aValue = a.metrics[sortBy as keyof ProductMetrics]
			const bValue = b.metrics[sortBy as keyof ProductMetrics]
			if (typeof aValue === 'number' && typeof bValue === 'number') {
				return (aValue - bValue) * direction
			}
			return a.name.localeCompare(b.name) * direction
		}
	}

	private async findAllFromDatabase(
		query: QueryProductDto,
		userMarketId?: string
	): Promise<PaginatedResult<unknown>> {
		const where: Prisma.ProductWhereInput = {}

		if (userMarketId) where.marketId = userMarketId
		if (query.categoryId) where.categoryId = query.categoryId
		if (query.search) {
			where.name = { contains: query.search, mode: 'insensitive' }
		}
		if (query.dateFrom || query.dateTo)
			where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
		if (query.priceMin != null || query.priceMax != null) {
			where.price = {}
			if (query.priceMin != null) where.price.gte = query.priceMin
			if (query.priceMax != null) where.price.lte = query.priceMax
		}
		if (query.lowStock) {
			// Prisma не поддерживает сравнение двух полей одной модели в where.
			// Используем $queryRaw для получения ID (с правильной пагинацией на БД),
			// затем подгружаем полные записи через findMany — так сохраняем include
			// и не тащим весь каталог в память.
			const conditions: Prisma.Sql[] = [
				Prisma.sql`p.quantity <= p."lowStockThreshold"`
			]
			if (userMarketId) conditions.push(Prisma.sql`p."marketId" = ${userMarketId}`)
			if (query.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${query.categoryId}`)
			if (query.search) conditions.push(Prisma.sql`p.name ILIKE ${'%' + query.search + '%'}`)
			if (query.dateFrom) conditions.push(Prisma.sql`p."createdAt" >= ${new Date(query.dateFrom)}`)
			if (query.dateTo) conditions.push(Prisma.sql`p."createdAt" <= ${new Date(query.dateTo)}`)
			if (query.priceMin != null) conditions.push(Prisma.sql`p.price >= ${query.priceMin}`)
			if (query.priceMax != null) conditions.push(Prisma.sql`p.price <= ${query.priceMax}`)

			const page = query.page ?? 1
			const limit = Math.min(query.limit ?? 20, 100)
			const offset = (page - 1) * limit
			const whereClause = Prisma.join(conditions, ' AND ')

			const [countResult, idRows] = await Promise.all([
				this.prisma.$queryRaw<[{ count: bigint }]>`
					SELECT COUNT(*) AS count FROM "Product" p WHERE ${whereClause}
				`,
				this.prisma.$queryRaw<{ id: string }[]>`
					SELECT p.id FROM "Product" p WHERE ${whereClause}
					ORDER BY p."createdAt" DESC
					LIMIT ${limit} OFFSET ${offset}
				`
			])

			const total = Number(countResult[0]?.count ?? 0)
			const ids = idRows.map(r => r.id)
			const data = ids.length > 0
				? await this.prisma.product.findMany({
						where: { id: { in: ids } },
						include: productInclude,
						orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
							'createdAt', 'name', 'price', 'quantity', 'updatedAt'
						])
					})
				: []

			return {
				data,
				meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
			}
		}

		return paginate(
			query,
			({ skip, take }) =>
				this.prisma.product.findMany({
					where,
					include: productInclude,
					orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
						'createdAt',
						'name',
						'price',
						'quantity',
						'updatedAt'
					]),
					skip,
					take
				}),
			() => this.prisma.product.count({ where })
		)
	}

	async findOne(id: string, userMarketId?: string, period?: AnalyticsPeriod) {
		const product = await this.getProductOrThrow(id, userMarketId)
		const { current, previous, durationDays } = resolvePeriod({ period })

		// sales — статистика за всё время (используется на карточке товара),
		// metrics — метрики за период, на которых строятся рекомендации.
		const [sales, currentRows, previousRows] = await Promise.all([
			this.getSalesStats(id),
			this.analytics.getProductSalesRows(current, userMarketId, [id]),
			this.analytics.getProductSalesRows(previous, userMarketId, [id])
		])

		const metrics = this.analytics.computeProductMetrics(
			product,
			currentRows.get(id),
			durationDays
		)
		const previousMetrics = this.analytics.computeProductMetrics(
			product,
			previousRows.get(id),
			durationDays
		)

		return {
			...product,
			sales,
			metrics,
			comparison: {
				netUnitsSold: buildComparison(
					metrics.netUnitsSold,
					previousMetrics.netUnitsSold
				),
				revenue: buildComparison(metrics.revenue, previousMetrics.revenue),
				transactionCount: buildComparison(
					metrics.transactionCount,
					previousMetrics.transactionCount
				)
			}
		}
	}

	private async getProductOrThrow(id: string, userMarketId?: string) {
		const product = await this.prisma.product.findUnique({
			where: { id },
			include: productInclude
		})
		if (!product) throw new NotFoundException('Product not found')
		if (userMarketId && product.marketId !== userMarketId) {
			throw new NotFoundException('Product not found')
		}
		return product
	}

	/**
	 * Статистика продаж товара за всё время.
	 *
	 * Возвраты вычитаются по refundedQuantity исходных строк, а не отбрасыванием
	 * транзакции целиком: при частичном возврате продажа остаётся действующей,
	 * и исключать её полностью означало бы терять реальную выручку.
	 */
	private async getSalesStats(
		productId: string
	): Promise<{
		count: number
		unitsSold: number
		refundedUnits: number
		revenue: number
	}> {
		const [row] = await this.prisma.$queryRaw<ProductSalesRow[]>`
			SELECT
				COUNT(DISTINCT t."id")::int AS "count",
				COALESCE(SUM(ti."quantity"), 0)::int AS "unitsSold",
				COALESCE(SUM(ti."refundedQuantity"), 0)::int AS "refundedUnits",
				COALESCE(
					SUM(ti."totalPrice" - (ti."refundedQuantity" * ti."price")),
					0
				)::float AS "revenue"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			WHERE ti."productId" = ${productId}
				AND t."type" IN ('SALE', 'DEBT')
		`
		return {
			count: row?.count ?? 0,
			unitsSold: row?.unitsSold ?? 0,
			refundedUnits: row?.refundedUnits ?? 0,
			revenue: row?.revenue ?? 0
		}
	}

	async update(
		id: string,
		dto: UpdateProductDto,
		file: Express.Multer.File,
		userMarketId?: string
	) {
		const product = await this.getProductOrThrow(id, userMarketId)

		const data: any = { ...dto }

		if (file) {
			if (product.image) {
				await this.storageService.delete(product.image)
			}
			data.image = await this.storageService.save(file, 'products')
		}

		return this.prisma.product.update({
			where: { id },
			data,
			include: productInclude
		})
	}

	async remove(id: string, userMarketId?: string) {
		const product = await this.getProductOrThrow(id, userMarketId)

		// Проверяем, есть ли у товара связанные транзакции
		const transactionItemsCount = await this.prisma.transactionItem.count({
			where: { productId: id }
		})
		if (transactionItemsCount > 0) {
			throw new ConflictException({
				message: 'Cannot delete product with transaction history',
				code: 'PRODUCT_HAS_TRANSACTIONS',
				details: { transactionItemsCount }
			})
		}

		if (product.image) {
			await this.storageService.delete(product.image)
		}

		await this.prisma.product.delete({ where: { id } })
	}
}
