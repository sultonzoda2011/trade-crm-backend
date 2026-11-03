import { randomInt } from 'crypto'
import { ConfigService } from '@nestjs/config'
import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { hash } from 'bcrypt'
import { Prisma } from '@prisma/client'
import { Express } from 'express'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { resolvePeriod, round2 } from '../common/utils/period.util'
import { JwtPayload } from '../interfaces'
import { Role } from '../enums'
import { CreateSellerDto } from './dto/create-seller.dto'
import { QuerySellerDto, SELLER_SORT_FIELDS, SellerStatusFilter } from './dto/query-seller.dto'
import { QuerySellerSummaryDto } from './dto/query-seller-summary.dto'
import { QuerySellerEarningsDto } from './dto/query-seller-earnings.dto'
import { UpdateSellerDto } from './dto/update-seller.dto'
import { CreateSellerCreditDto } from './dto/create-seller-credit.dto'
import { ReverseSellerCreditDto } from './dto/reverse-seller-credit.dto'
import { QuerySellerCreditDto } from './dto/query-seller-credit.dto'
import { TransactionsService } from '../transactions/transactions.service'
import { QueryTransactionDto } from '../transactions/dto/query-transaction.dto'
import {
	countEarningsFeed,
	fetchBalances,
	fetchEarningsFeed,
	fetchPeriodTotals,
	RawDb,
	SellerBalance
} from './sellers-earnings.util'

/** Превью транзакций/выплат на детальной странице продавца — дальше "Все". */
const SELLER_PREVIEW_LIMIT = 5
/** Сколько записей ленты заработка отдаёт карточка продавца сразу. */
const EARNINGS_PREVIEW_LIMIT = 10
/** Потолок продавцов одного запроса со статистикой (считаем в памяти). */
const STATS_SELLERS_CAP = 500

/** Алфавит сгенерированного пароля: без похожих 0/O и 1/l/I — его читают вслух. */
const PASSWORD_LOWER = 'abcdefghijkmnpqrstuvwxyz'
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const PASSWORD_DIGITS = '23456789'
const GENERATED_PASSWORD_LENGTH = 10

const STAT_SORT_FIELDS = ['sold', 'earned', 'balance', 'lastSaleAt'] as const
type StatSortField = (typeof STAT_SORT_FIELDS)[number]

const sellerSelect = {
	id: true,
	name: true,
	email: true,
	phone: true,
	image: true,
	role: true,
	isActive: true,
	deactivatedAt: true,
	passwordChangedAt: true,
	createdAt: true,
	market: {
		select: { id: true, name: true, address: true, image: true }
	}
} as const

type SellerRow = Prisma.UserGetPayload<{ select: typeof sellerSelect }>

export interface SellerStats {
	salesCount: number
	sold: number
	earned: number
	balance: number
	pendingInDebts: number
	lastSaleAt: Date | null
}

/** Читаемая ошибка с машинным кодом — фронт переводит её по `code`. */
const coded = (message: string, code: string, details?: Record<string, unknown>) => ({
	message,
	code,
	...(details ? { details } : {})
})

function generatePassword(): string {
	const all = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS
	const pick = (set: string) => set[randomInt(set.length)]
	// По одному символу каждого класса — требование к паролю — и остальное из общего алфавита.
	const chars = [pick(PASSWORD_LOWER), pick(PASSWORD_UPPER), pick(PASSWORD_DIGITS)]
	while (chars.length < GENERATED_PASSWORD_LENGTH) chars.push(pick(all))
	// Fisher–Yates: обязательные символы не должны стоять всегда в начале.
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomInt(i + 1)
		;[chars[i], chars[j]] = [chars[j], chars[i]]
	}
	return chars.join('')
}

@Injectable()
export class SellersService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService,
		private readonly configService: ConfigService,
		private readonly transactionsService: TransactionsService
	) {}

	/**
	 * Новый продавец. Владелец заводит его в свой рынок; админ — в рынок,
	 * который выбрал в форме (своего рынка у админа нет).
	 */
	async create(dto: CreateSellerDto, file: Express.Multer.File | undefined, user: JwtPayload) {
		let marketId = user.marketId
		if (user.role === Role.ADMIN) {
			if (!dto.marketId) {
				throw new BadRequestException(coded('Choose a market for the seller', 'SELLER_MARKET_REQUIRED'))
			}
			const market = await this.prisma.market.findUnique({ where: { id: dto.marketId }, select: { id: true } })
			if (!market) throw new NotFoundException('Market not found')
			marketId = market.id
		}
		if (!marketId) throw new UnauthorizedException('User is not assigned to a market')

		const existing = await this.prisma.user.findFirst({
			where: { email: { equals: dto.email, mode: 'insensitive' } }
		})
		if (existing) throw new ConflictException(coded('Email already in use', 'EMAIL_IN_USE'))

		const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') ?? 12
		const hashedPassword = await hash(dto.password, bcryptRounds)
		const image = file ? await this.storageService.save(file, 'sellers') : undefined

		return this.prisma.user.create({
			data: {
				name: dto.name,
				email: dto.email,
				password: hashedPassword,
				phone: dto.phone ? dto.phone : null,
				image,
				role: 'SELLER',
				marketId
			},
			select: sellerSelect
		})
	}

	/**
	 * Список продавцов. Без `withStats` — обычная страница из БД (для выпадашек
	 * «выбрать продавца»). Со статистикой или сортировкой по ней считаем все
	 * подходящие строки и сортируем в памяти: продавцов на рынке десятки, а
	 * сортировать по «к выплате» в SQL значит дублировать весь расчёт баланса.
	 */
	async findAll(query: QuerySellerDto, marketId?: string): Promise<PaginatedResult<unknown>> {
		const where = this.buildWhere(query, marketId)
		const sortBy = query.sortBy
		const statSort = STAT_SORT_FIELDS.includes(sortBy as StatSortField)

		if (!query.withStats && !statSort) {
			return paginate(query, ({ skip, take }) =>
				this.prisma.user.findMany({
					where,
					select: sellerSelect,
					orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', ['createdAt', 'name', 'email', 'updatedAt']),
					skip,
					take
				}),
				() => this.prisma.user.count({ where })
			)
		}

		const rows = await this.withStats(
			await this.prisma.user.findMany({ where, select: sellerSelect, take: STATS_SELLERS_CAP }),
			query
		)
		const sorted = this.sortRows(rows, sortBy, query.sortOrder)

		const page = query.page ?? 1
		const limit = Math.min(query.limit ?? 20, 100)
		return {
			data: sorted.slice((page - 1) * limit, page * limit),
			meta: { page, limit, total: sorted.length, totalPages: Math.ceil(sorted.length / limit) }
		}
	}

	/**
	 * Шапка экрана «Продавцы»: сколько продано и заработано за период, сколько
	 * всего должны выплатить. «К выплате» — только положительные балансы;
	 * переплаты считаем отдельно, чтобы они не гасили долги другим продавцам.
	 */
	async summary(query: QuerySellerSummaryDto, marketId?: string) {
		const baseWhere: Prisma.UserWhereInput = { role: 'SELLER' }
		if (marketId) baseWhere.marketId = marketId

		const [counts, sellers] = await Promise.all([
			this.prisma.user.groupBy({ by: ['isActive'], where: baseWhere, _count: { _all: true } }),
			this.prisma.user.findMany({
				where: this.buildWhere({ status: query.status ?? SellerStatusFilter.ACTIVE } as QuerySellerDto, marketId),
				select: sellerSelect,
				take: STATS_SELLERS_CAP
			})
		])
		const rows = await this.withStats(sellers, query)
		const period = resolvePeriod(query)

		let sold = 0
		let earned = 0
		let salesCount = 0
		let toPay = 0
		let toPayCount = 0
		let overpaid = 0
		let pendingInDebts = 0
		for (const row of rows) {
			const s = row.stats
			sold += s.sold
			earned += s.earned
			salesCount += s.salesCount
			pendingInDebts += s.pendingInDebts
			if (s.balance > 0) {
				toPay += s.balance
				toPayCount += 1
			} else if (s.balance < 0) {
				overpaid += -s.balance
			}
		}

		return {
			period: { from: period.current.gte.toISOString(), to: period.current.lte.toISOString() },
			counts: {
				active: counts.find(c => c.isActive)?._count._all ?? 0,
				disabled: counts.find(c => !c.isActive)?._count._all ?? 0
			},
			salesCount,
			sold: round2(sold),
			earned: round2(earned),
			toPay: round2(toPay),
			toPayCount,
			overpaid: round2(overpaid),
			pendingInDebts: round2(pendingInDebts)
		}
	}

	async findOne(id: string, marketId?: string): Promise<SellerRow> {
		const where: Prisma.UserWhereInput = { id, role: 'SELLER' }
		if (marketId) where.marketId = marketId

		const seller = await this.prisma.user.findFirst({ where, select: sellerSelect })
		if (!seller) throw new NotFoundException('Seller not found')
		return seller
	}

	/**
	 * Карточка продавца целиком: сам продавец, превью его чеков, баланс, показатели
	 * месяца, превью выплат и ленты заработка — один round-trip вместо шести.
	 * `hasHistory` говорит фронту, можно ли показать «Удалить» (иначе — «Отключить»).
	 */
	async findOneFull(id: string, marketId?: string) {
		const seller = await this.findOne(id, marketId)
		const month = resolvePeriod({})

		const [transactions, balance, totals, credits, feed, hasHistory] = await Promise.all([
			this.transactionsService.findAll(
				{ createdById: id, page: 1, limit: SELLER_PREVIEW_LIMIT } as QueryTransactionDto,
				marketId
			),
			this.computeBalance(this.prisma, id),
			fetchPeriodTotals(this.prisma, [id], month.current),
			this.listCredits(id, { page: 1, limit: SELLER_PREVIEW_LIMIT } as QuerySellerCreditDto, marketId),
			this.getEarnings(id, { page: 1, limit: EARNINGS_PREVIEW_LIMIT } as QuerySellerEarningsDto, marketId),
			this.hasHistory(id)
		])
		const monthTotals = totals.get(id)!

		return {
			seller: { ...seller, hasHistory },
			transactions,
			balance,
			credits,
			feed,
			month: {
				since: month.current.gte.toISOString(),
				salesCount: monthTotals.salesCount,
				sold: monthTotals.sold,
				earned: monthTotals.earned
			}
		}
	}

	async update(id: string, dto: UpdateSellerDto, file?: Express.Multer.File, marketId?: string) {
		const seller = await this.findOne(id, marketId)

		if (dto.email) {
			const existing = await this.prisma.user.findFirst({
				where: { email: { equals: dto.email, mode: 'insensitive' } }
			})
			if (existing && existing.id !== id) {
				throw new ConflictException(coded('Email already in use', 'EMAIL_IN_USE'))
			}
		}

		const data: Prisma.UserUpdateInput = {}
		if (dto.name !== undefined) data.name = dto.name
		if (dto.email !== undefined) data.email = dto.email
		// Пустая строка из формы — «очистить телефон».
		if (dto.phone !== undefined) data.phone = dto.phone === '' ? null : dto.phone
		if (dto.password) {
			const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') ?? 12
			data.password = await hash(dto.password, bcryptRounds)
			data.passwordChangedAt = new Date()
		}
		if (file) {
			data.image = await this.storageService.replace(seller.image, file, 'sellers')
		}

		return this.prisma.user.update({ where: { id }, data, select: sellerSelect })
	}

	/**
	 * Удалить можно только продавца без истории: чеки, платежи и выплаты ссылаются
	 * на него, и их удаление стёрло бы деньги рынка. Остальных — отключают.
	 */
	async remove(id: string, marketId?: string) {
		const seller = await this.findOne(id, marketId)

		if (await this.hasHistory(id)) throw this.historyError()

		try {
			await this.prisma.user.delete({ where: { id } })
		} catch (error) {
			// Гонка: между проверкой и удалением появилась запись.
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
				throw this.historyError()
			}
			throw error
		}
		if (seller.image) await this.storageService.delete(seller.image)
	}

	/** Отключить продавца: вход закрыт, история и выплаты остаются. */
	async deactivate(id: string, marketId?: string) {
		const seller = await this.findOne(id, marketId)
		if (!seller.isActive) return seller
		return this.prisma.user.update({
			where: { id },
			data: { isActive: false, deactivatedAt: new Date() },
			select: sellerSelect
		})
	}

	async activate(id: string, marketId?: string) {
		const seller = await this.findOne(id, marketId)
		if (seller.isActive) return seller
		return this.prisma.user.update({
			where: { id },
			data: { isActive: true, deactivatedAt: null },
			select: sellerSelect
		})
	}

	/**
	 * Сброс пароля владельцем: система придумывает пароль и отдаёт его ОДИН раз,
	 * владелец передаёт его продавцу, тот меняет в профиле. Сам пароль нигде не
	 * хранится и не логируется — только хеш.
	 */
	async resetPassword(id: string, marketId?: string) {
		await this.findOne(id, marketId)

		const password = generatePassword()
		const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') ?? 12
		const passwordChangedAt = new Date()
		await this.prisma.user.update({
			where: { id },
			data: { password: await hash(password, bcryptRounds), passwordChangedAt }
		})
		return { password, passwordChangedAt }
	}

	/**
	 * Баланс продавца по надбавкам: earned − refunded − paidOut. Считается из
	 * чеков и выплат при каждом запросе (см. sellers-earnings.util.ts), поэтому
	 * не может разойтись с ними.
	 */
	async getBalance(id: string, marketId?: string): Promise<SellerBalance> {
		await this.findOne(id, marketId)
		return this.computeBalance(this.prisma, id)
	}

	/**
	 * Лента «из чего сложился баланс»: начисления по чекам, откаты возвратами,
	 * выплаты и их отмены. Σ amount всех записей равна `balance`.
	 */
	async getEarnings(id: string, query: QuerySellerEarningsDto, marketId?: string) {
		await this.findOne(id, marketId)

		const page = query.page ?? 1
		const limit = Math.min(query.limit ?? 20, 100)
		const [entries, total, balance] = await Promise.all([
			fetchEarningsFeed(this.prisma, id, (page - 1) * limit, limit),
			countEarningsFeed(this.prisma, id),
			this.computeBalance(this.prisma, id)
		])
		return {
			balance,
			entries: {
				data: entries,
				meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
			}
		}
	}

	/**
	 * Выдать продавцу часть или весь баланс. Сумма не может превышать баланс.
	 * Проверка и запись идут в ОДНОЙ транзакции под блокировкой строки
	 * продавца: две одновременные выплаты не пройдут обе по одному и тому же
	 * балансу — вторая дождётся первой и увидит уже уменьшенный остаток.
	 */
	async createCredit(id: string, dto: CreateSellerCreditDto, user: JwtPayload, marketId?: string) {
		await this.findOne(id, marketId)
		const amount = round2(dto.amount)

		return this.prisma.$transaction(async tx => {
			await this.lockSeller(tx, id)
			const { balance } = await this.computeBalance(tx, id)

			if (balance <= 0) {
				throw new BadRequestException(coded('Nothing to pay out', 'SELLER_NOTHING_TO_PAY', { balance }))
			}
			if (amount > balance) {
				throw new BadRequestException(
					coded(`Payout amount (${amount}) exceeds seller's current balance (${balance})`, 'SELLER_PAYOUT_EXCEEDS_BALANCE', {
						balance
					})
				)
			}

			return tx.sellerCredit.create({
				data: { sellerId: id, amount, note: dto.note?.trim() || undefined, createdById: user.sub },
				include: { createdBy: { select: { id: true, name: true } } }
			})
		})
	}

	/**
	 * Отменить выплату (ошиблись суммой или не тому передали). Строку не удаляем:
	 * добавляем встречную запись с отрицательной суммой, чтобы история денег
	 * осталась целой. Одну выплату можно отменить один раз; саму отмену не отменить.
	 */
	async reverseCredit(id: string, creditId: string, dto: ReverseSellerCreditDto, user: JwtPayload, marketId?: string) {
		await this.findOne(id, marketId)

		try {
			return await this.prisma.$transaction(async tx => {
				await this.lockSeller(tx, id)

				const credit = await tx.sellerCredit.findFirst({
					where: { id: creditId, sellerId: id },
					include: { reversal: { select: { id: true } } }
				})
				if (!credit) throw new NotFoundException('Payout not found')
				if (credit.reversalOfId || credit.amount <= 0) {
					throw new BadRequestException(coded('This entry cannot be cancelled', 'SELLER_CREDIT_NOT_REVERSIBLE'))
				}
				if (credit.reversal) {
					throw new ConflictException(coded('This payout is already cancelled', 'SELLER_CREDIT_ALREADY_REVERSED'))
				}

				return tx.sellerCredit.create({
					data: {
						sellerId: id,
						amount: -credit.amount,
						note: dto.note?.trim() || undefined,
						createdById: user.sub,
						reversalOfId: credit.id
					},
					include: { createdBy: { select: { id: true, name: true } } }
				})
			})
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
				throw new ConflictException(coded('This payout is already cancelled', 'SELLER_CREDIT_ALREADY_REVERSED'))
			}
			throw error
		}
	}

	async listCredits(
		id: string,
		query: QuerySellerCreditDto,
		marketId?: string
	): Promise<PaginatedResult<unknown>> {
		await this.findOne(id, marketId)

		const where: Prisma.SellerCreditWhereInput = { sellerId: id }
		if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)

		const page = await paginate(query, ({ skip, take }) =>
			this.prisma.sellerCredit.findMany({
				where,
				include: {
					createdBy: { select: { id: true, name: true } },
					reversal: { select: { id: true } }
				},
				orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', ['createdAt', 'amount']),
				skip,
				take
			}),
			() => this.prisma.sellerCredit.count({ where })
		)
		return {
			...page,
			data: page.data.map(({ reversal, ...credit }) => ({ ...credit, isReversed: !!reversal }))
		}
	}

	// ── внутреннее ────────────────────────────────────────────────────────────

	private buildWhere(query: Pick<QuerySellerDto, 'status' | 'search'>, marketId?: string) {
		const where: Prisma.UserWhereInput = { role: 'SELLER' }
		if (marketId) where.marketId = marketId
		if (query.status === SellerStatusFilter.ACTIVE) where.isActive = true
		if (query.status === SellerStatusFilter.DISABLED) where.isActive = false
		if (query.search) {
			where.OR = [
				{ name: { contains: query.search, mode: 'insensitive' } },
				{ email: { contains: query.search, mode: 'insensitive' } },
				{ phone: { contains: query.search, mode: 'insensitive' } }
			]
		}
		return where
	}

	private async computeBalance(db: RawDb, id: string): Promise<SellerBalance> {
		return (await fetchBalances(db, [id])).get(id)!
	}

	/** Строка продавца под FOR UPDATE: параллельные выплаты/отмены встают в очередь. */
	private async lockSeller(tx: Prisma.TransactionClient, id: string) {
		await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`
	}

	private async hasHistory(id: string): Promise<boolean> {
		const [transactions, payments, credits] = await Promise.all([
			this.prisma.transaction.count({ where: { createdById: id } }),
			this.prisma.payment.count({ where: { createdById: id } }),
			this.prisma.sellerCredit.count({ where: { OR: [{ sellerId: id }, { createdById: id }] } })
		])
		return transactions + payments + credits > 0
	}

	private historyError() {
		return new ConflictException(
			coded('The seller has receipts or payouts — disable the account instead of deleting it', 'SELLER_HAS_HISTORY')
		)
	}

	/** Дописывает каждому продавцу `stats`: период, баланс, последняя продажа. */
	private async withStats(sellers: SellerRow[], query: QuerySellerDto | QuerySellerSummaryDto) {
		const ids = sellers.map(s => s.id)
		const period = resolvePeriod(query)

		const [balances, totals, lastSales] = await Promise.all([
			fetchBalances(this.prisma, ids),
			fetchPeriodTotals(this.prisma, ids, period.current),
			ids.length
				? this.prisma.transaction.groupBy({
						by: ['createdById'],
						where: { createdById: { in: ids }, type: { in: ['SALE', 'DEBT'] } },
						_max: { createdAt: true }
					})
				: Promise.resolve([])
		])
		const lastSaleOf = new Map(lastSales.map(row => [row.createdById, row._max.createdAt]))

		return sellers.map(seller => {
			const balance = balances.get(seller.id)!
			const total = totals.get(seller.id)!
			const stats: SellerStats = {
				salesCount: total.salesCount,
				sold: total.sold,
				earned: total.earned,
				balance: balance.balance,
				pendingInDebts: balance.pendingInDebts,
				lastSaleAt: lastSaleOf.get(seller.id) ?? null
			}
			return { ...seller, stats }
		})
	}

	/** Работающие выше отключённых, внутри группы — по выбранному полю. */
	private sortRows<T extends SellerRow & { stats: SellerStats }>(
		rows: T[],
		sortBy: string | undefined,
		sortOrder: 'asc' | 'desc' | undefined
	): T[] {
		const field = (SELLER_SORT_FIELDS as readonly string[]).includes(sortBy ?? '') ? sortBy! : 'createdAt'
		const dir = sortOrder === 'asc' ? 1 : -1

		const valueOf = (row: T): number | string | null => {
			switch (field) {
				case 'sold':
					return row.stats.sold
				case 'earned':
					return row.stats.earned
				case 'balance':
					return row.stats.balance
				case 'lastSaleAt':
					return row.stats.lastSaleAt ? row.stats.lastSaleAt.getTime() : null
				case 'name':
					return row.name.toLowerCase()
				case 'email':
					return row.email.toLowerCase()
				default:
					return row.createdAt.getTime()
			}
		}

		return [...rows].sort((a, b) => {
			if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
			const av = valueOf(a)
			const bv = valueOf(b)
			// Пустое значение (ни одной продажи) всегда в конце, в любую сторону.
			if (av === null && bv !== null) return 1
			if (bv === null && av !== null) return -1
			if (av !== null && bv !== null && av !== bv) return (av < bv ? -1 : 1) * dir
			return a.name.localeCompare(b.name)
		})
	}
}
