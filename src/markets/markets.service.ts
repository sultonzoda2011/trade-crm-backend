import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { StorageService } from '../common/services/storage.service'
import {
	buildDateWhere,
	buildOrderBy,
	paginate
} from '../common/utils/paginate.util'
import { PrismaService } from '../prisma/prisma.service'
import { CreateMarketDto } from './dto/create-market.dto'
import { QueryMarketDto } from './dto/query-market.dto'
import { UpdateMarketDto } from './dto/update-market.dto'
import { UpdateMarketSettingsDto } from './dto/update-market-settings.dto'
import { ProductsService } from '../products/products.service'
import { DebtorsService } from '../debtors/debtors.service'
import { TransactionsService } from '../transactions/transactions.service'
import { QueryProductDto } from '../products/dto/query-product.dto'
import { QueryDebtorDto } from '../debtors/dto/query-debtor.dto'
import { QueryTransactionDto } from '../transactions/dto/query-transaction.dto'
import { JwtPayload } from '../interfaces'
import { Role } from '../enums'
import { marketScope } from './market-scope.util'

/** Превью товаров/должников/транзакций в устаревшем `GET /markets/:id/full`. */
const MARKET_PREVIEW_LIMIT = 5

const marketInclude = {
	users: {
		select: { id: true, name: true, image: true, email: true, role: true, phone: true }
	},
	_count: { select: { debtors: true, transactions: true, products: true } }
} as const

const ownerSelect = {
	id: true,
	name: true,
	image: true,
	email: true,
	role: true,
	phone: true
} as const

type MarketRow = Prisma.MarketGetPayload<{ include: typeof marketInclude }>

interface ViewOptions {
	/** Продавцу не отдаём чужие email: ему нужны имя и телефон коллег, не почта. */
	hideEmails?: boolean
}

/** Пустая строка в форме = «очистить поле». */
const emptyToNull = (value: string | undefined): string | null =>
	value === undefined || value.trim() === '' ? null : value.trim()

function withoutEmail<T extends { email?: unknown }>(person: T): Omit<T, 'email'> {
	const { email: _email, ...rest } = person
	return rest
}

@Injectable()
export class MarketsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService,
		private readonly productsService: ProductsService,
		private readonly debtorsService: DebtorsService,
		private readonly transactionsService: TransactionsService
	) {}

	private async getScopedMarket(id: string, scope?: string) {
		const market = await this.prisma.market.findUnique({
			where: { id },
			include: marketInclude
		})
		if (!market) throw new NotFoundException('Market not found')
		// OWNER/SELLER видят только свой рынок; чужие id трактуем как
		// «не найдено», чтобы не раскрывать существование записей (IDOR).
		if (scope && market.id !== scope) {
			throw new NotFoundException('Market not found')
		}
		return market
	}

	private shape(market: MarketRow, owner: ReturnType<typeof withoutEmail> | Record<string, unknown> | null, options: ViewOptions) {
		const { _count, ...rest } = market
		return {
			...rest,
			users: options.hideEmails ? rest.users.map(withoutEmail) : rest.users,
			count: _count,
			owner
		}
	}

	private async enrichMarket(market: MarketRow, options: ViewOptions = {}) {
		const owner = await this.prisma.user.findUnique({
			where: { id: market.ownerId },
			select: ownerSelect
		})
		return this.shape(market, owner && options.hideEmails ? withoutEmail(owner) : owner, options)
	}

	private async enrichManyMarkets(markets: MarketRow[]) {
		const ownerIds = [...new Set(markets.map(m => m.ownerId))]
		const owners = await this.prisma.user.findMany({
			where: { id: { in: ownerIds } },
			select: ownerSelect
		})
		const ownerMap = new Map(owners.map(o => [o.id, o]))
		return markets.map(m => this.shape(m, ownerMap.get(m.ownerId) ?? null, {}))
	}

	/**
	 * Владельцем можно назначить только пользователя с ролью OWNER, у которого
	 * ещё нет другого рынка: иначе у «брошенного» рынка остался бы владелец,
	 * чей `marketId` уже указывает на другой.
	 */
	private async assertAssignableOwner(ownerId: string, currentMarketId?: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: ownerId },
			select: { id: true, role: true }
		})
		if (!user || user.role !== 'OWNER') {
			throw new BadRequestException({
				message: 'The owner must be an existing user with the OWNER role',
				code: 'MARKET_OWNER_INVALID'
			})
		}
		const other = await this.prisma.market.findFirst({
			where: {
				ownerId,
				...(currentMarketId ? { id: { not: currentMarketId } } : {})
			},
			select: { id: true }
		})
		if (other) {
			throw new ConflictException({
				message: 'This user already owns another market',
				code: 'MARKET_OWNER_TAKEN'
			})
		}
	}

	async create(
		dto: CreateMarketDto,
		file: Express.Multer.File,
		callerId?: string
	) {
		const resolvedOwnerId = dto.ownerId ?? callerId
		if (!resolvedOwnerId) {
			throw new BadRequestException({
				message: 'Owner ID is required',
				code: 'MARKET_OWNER_REQUIRED'
			})
		}
		// До загрузки картинки: незачем плодить файлы под отклонённый запрос.
		await this.assertAssignableOwner(resolvedOwnerId)

		const image = file
			? await this.storageService.save(file, 'markets')
			: undefined

		const market = await this.prisma.$transaction(async tx => {
			const created = await tx.market.create({
				data: {
					name: dto.name,
					address: dto.address,
					phone: emptyToNull(dto.phone),
					workHours: emptyToNull(dto.workHours),
					image,
					ownerId: resolvedOwnerId
				},
				include: marketInclude
			})

			await tx.user.update({
				where: { id: resolvedOwnerId },
				data: { marketId: created.id }
			})

			return created
		})

		return this.enrichMarket(market)
	}

	async findAll(
		query: QueryMarketDto,
		scope?: string
	): Promise<PaginatedResult<unknown>> {
		const where: Prisma.MarketWhereInput = {}

		// OWNER видит только свой рынок — это блокирует IDOR на чтение чужих данных.
		if (scope) where.id = scope
		if (query.ownerId) where.ownerId = query.ownerId
		if (query.search) {
			where.OR = [
				{ name: { contains: query.search, mode: 'insensitive' } },
				{ address: { contains: query.search, mode: 'insensitive' } }
			]
		}
		if (query.dateFrom || query.dateTo)
			where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
		if (query.hasUsers != null) {
			where.users = query.hasUsers ? { some: {} } : { none: {} }
		}
		if (query.hasProducts != null) {
			where.products = query.hasProducts ? { some: {} } : { none: {} }
		}

		return paginate(
			query,
			async ({ skip, take }) => {
				const data = await this.prisma.market.findMany({
					where,
					include: marketInclude,
					orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
						'createdAt',
						'name',
						'address',
						'updatedAt'
					]),
					skip,
					take
				})
				return this.enrichManyMarkets(data)
			},
			() => this.prisma.market.count({ where })
		)
	}

	async findOne(id: string, scope?: string, options: ViewOptions = {}) {
		const market = await this.getScopedMarket(id, scope)
		return this.enrichMarket(market, options)
	}

	/**
	 * Экран «Мой рынок»: карточка рынка + сводка одним запросом.
	 *
	 * Счётчики видят все, кто имеет доступ к рынку. Деньги (долг, стоимость
	 * склада) и состояние склада — только ADMIN/OWNER: `management` у продавца
	 * `null`. Сводка собирается из готовых `products.summary` и
	 * `debtors.getSummary`, чтобы цифры совпали с экранами «Товары» и «Должники».
	 * Админ смотрит любой рынок, поэтому в сервисы уходит id рынка из пути,
	 * а не `marketId` сотрудника.
	 */
	async overview(id: string, viewer: JwtPayload) {
		const isSeller = viewer.role === Role.SELLER
		const market = await this.findOne(id, marketScope(viewer), { hideEmails: isSeller })

		const [activeProducts, products, debtors] = await Promise.all([
			this.prisma.product.count({ where: { marketId: id, isActive: true } }),
			isSeller ? Promise.resolve(null) : this.productsService.summary(id),
			isSeller ? Promise.resolve(null) : this.debtorsService.getSummary(id)
		])

		return {
			market,
			summary: {
				products: activeProducts,
				debtors: market.count.debtors,
				sellers: market.users.filter(u => u.role === 'SELLER').length,
				transactions: market.count.transactions,
				management:
					products && debtors
						? {
								totalDebt: debtors.totalDebt,
								overdueAmount: debtors.overdueAmount,
								debtorsWithDebt: debtors.debtorsWithDebt,
								stockRetailValue: products.stockRetailValue,
								stockCostValue: products.stockCostValue,
								productsWithoutCost: products.productsWithoutCost,
								outOfStock: products.outOfStock,
								lowStock: products.lowStock
							}
						: null
			}
		}
	}

	/**
	 * Карточка маркета + превью товаров/должников/транзакций — одним запросом.
	 *
	 * @deprecated Старый фронт ещё зовёт этот эндпоинт; новый экран читает
	 * `overview`. Удалить отдельным шагом после деплоя фронта.
	 *
	 * Превью грузятся ТОЛЬКО для своего маркета (marketId сотрудника === маркет,
	 * который он смотрит).
	 */
	async findOneFull(id: string, requestingUser: JwtPayload) {
		const market = await this.findOne(id, marketScope(requestingUser), {
			hideEmails: requestingUser.role === Role.SELLER
		})

		const isOwnMarket = Boolean(requestingUser.marketId) && requestingUser.marketId === id
		const previewQuery = { page: 1, limit: MARKET_PREVIEW_LIMIT }

		const [products, debtors, transactions] = await Promise.all([
			isOwnMarket
				? this.productsService.findAll(previewQuery as QueryProductDto, requestingUser.marketId)
				: Promise.resolve(null),
			isOwnMarket
				? this.debtorsService.findAll(previewQuery as QueryDebtorDto, requestingUser.marketId)
				: Promise.resolve(null),
			isOwnMarket
				? this.transactionsService.findAll(previewQuery as QueryTransactionDto, requestingUser.marketId)
				: Promise.resolve(null)
		])

		return { market, products, debtors, transactions }
	}

	/**
	 * Правка карточки рынка (название, адрес, контакты, фото). Владельца меняет
	 * только админ: иначе OWNER мог бы «перетащить» в свой рынок любого
	 * пользователя, подставив его id.
	 */
	async update(
		id: string,
		dto: UpdateMarketDto,
		file: Express.Multer.File,
		scope?: string,
		canChangeOwner = false
	) {
		const existing = await this.getScopedMarket(id, scope)

		const changingOwner = dto.ownerId !== undefined && dto.ownerId !== existing.ownerId
		if (changingOwner && !canChangeOwner) {
			throw new ForbiddenException({
				message: 'Only an admin can change the market owner',
				code: 'MARKET_OWNER_ADMIN_ONLY'
			})
		}
		if (changingOwner) await this.assertAssignableOwner(dto.ownerId!, id)

		const data: Prisma.MarketUncheckedUpdateInput = {}
		if (dto.name !== undefined) data.name = dto.name
		if (dto.address !== undefined) data.address = dto.address
		if (dto.phone !== undefined) data.phone = emptyToNull(dto.phone)
		if (dto.workHours !== undefined) data.workHours = emptyToNull(dto.workHours)
		if (changingOwner) data.ownerId = dto.ownerId
		if (file) {
			data.image = await this.storageService.replace(existing.image, file, 'markets')
		}

		const updated = await this.prisma.$transaction(async tx => {
			if (changingOwner) {
				await tx.user.update({
					where: { id: existing.ownerId },
					data: { marketId: null }
				})
				await tx.user.update({
					where: { id: dto.ownerId! },
					data: { marketId: id }
				})
			}

			return tx.market.update({
				where: { id },
				data,
				include: marketInclude
			})
		})

		return this.enrichMarket(updated)
	}

	/** Настройки рынка — отдельно от карточки: это JSON-запрос, а не multipart. */
	async updateSettings(id: string, dto: UpdateMarketSettingsDto, scope?: string) {
		await this.getScopedMarket(id, scope)

		const data: Prisma.MarketUncheckedUpdateInput = {}
		if (dto.allowSellerSales !== undefined) data.allowSellerSales = dto.allowSellerSales

		const updated = await this.prisma.market.update({
			where: { id },
			data,
			include: marketInclude
		})
		return this.enrichMarket(updated)
	}

	async remove(id: string, scope?: string) {
		const market = await this.getScopedMarket(id, scope)

		if (market.image) {
			await this.storageService.delete(market.image)
		}

		await this.prisma.$transaction(async tx => {
			await tx.user.update({
				where: { id: market.ownerId },
				data: { marketId: null }
			})
			await tx.market.delete({ where: { id } })
		})
	}
}
