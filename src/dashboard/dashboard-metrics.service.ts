import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
	DateRange,
	DUE_SOON_DAYS,
	MS_PER_DAY,
	round2,
} from '../common/utils/period.util'

/** Кому принадлежат цифры: маркет и, опционально, один продавец. */
export interface MetricsScope {
	marketId?: string
	sellerId?: string
}

export interface SalesMetrics {
	/** Выручка по продажам за наличные/карту, за вычетом возвратов. */
	saleRevenue: number
	/** Сумма выданного в долг за период, за вычетом возвратов. */
	debtIssued: number
	/** Оборот целиком: продажи + долги. Это «сколько товара ушло в деньгах». */
	netRevenue: number
	/** Выручка до вычета возвратов — нужна, чтобы показать цену возвратов. */
	grossRevenue: number
	refundedRevenue: number
	unitsSold: number
	refundedUnits: number
	discountAmount: number
	transactionCount: number
	saleCount: number
	debtCount: number
	/** Средний чек по завершённым продажам и долгам. */
	averageCheck: number
	/** Доля возвращённых единиц в проданных. */
	returnRate: number
}

export interface DebtMetrics {
	totalOutstanding: number
	activeDebtCount: number
	activeDebtorCount: number
	overdueAmount: number
	overdueCount: number
	dueSoonAmount: number
	dueSoonCount: number
	collectedAmount: number
	collectedCount: number
}

/** Окно «долг скоро просрочится» задаётся в period.util — см. DUE_SOON_DAYS. */

export interface ProductLeaderRow {
	productId: string
	productName: string
	netUnits: number
	netRevenue: number
	refundedUnits: number
}

export interface ReturnedProductRow {
	productId: string
	productName: string
	refundedUnits: number
	refundedAmount: number
	unitsSold: number
	returnRate: number
}

/** Способ оплаты и его вклад в выручку периода. */
export interface PaymentMixRow {
	type: string
	count: number
	amount: number
	percentage: number
}

export interface CategoryRevenueRow {
	categoryId: string | null
	categoryName: string | null
	netRevenue: number
	netUnits: number
}

export interface RevenueTrendRow {
	date: Date
	revenue: number
	transactionCount: number
}

interface SalesMetricsRow {
	saleRevenue: number
	debtIssued: number
	grossRevenue: number
	refundedRevenue: number
	unitsSold: number
	refundedUnits: number
	discountAmount: number
	transactionCount: number
	saleCount: number
	debtCount: number
}

@Injectable()
export class DashboardMetricsService {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Продажи за период на уровне строк транзакций.
	 *
	 * Возвраты вычитаются через refundedQuantity исходных строк, а не
	 * отбрасыванием транзакции по статусу: при частичном возврате продажа
	 * остаётся действующей, и выкидывать её целиком означало бы обнулить
	 * выручку, которая реально получена. Побочный эффект такой модели —
	 * возврат уменьшает выручку того периода, в котором прошла ПРОДАЖА,
	 * поэтому цифры закрытого периода не «переезжают» при позднем возврате.
	 */
	async getSalesMetrics(
		range: DateRange,
		scope: MetricsScope,
	): Promise<SalesMetrics> {
		const [row] = await this.prisma.$queryRaw<SalesMetricsRow[]>`
			SELECT
				COALESCE(SUM(ti."totalPrice" - ti."refundedQuantity" * ti."price")
					FILTER (WHERE t."type" = 'SALE'), 0)::float AS "saleRevenue",
				COALESCE(SUM(ti."totalPrice" - ti."refundedQuantity" * ti."price")
					FILTER (WHERE t."type" = 'DEBT'), 0)::float AS "debtIssued",
				COALESCE(SUM(ti."totalPrice"), 0)::float AS "grossRevenue",
				COALESCE(SUM(ti."refundedQuantity" * ti."price"), 0)::float AS "refundedRevenue",
				COALESCE(SUM(ti."quantity"), 0)::int AS "unitsSold",
				COALESCE(SUM(ti."refundedQuantity"), 0)::int AS "refundedUnits",
				COALESCE(SUM(ti."discount"), 0)::float AS "discountAmount",
				COUNT(DISTINCT t."id")::int AS "transactionCount",
				COUNT(DISTINCT t."id") FILTER (WHERE t."type" = 'SALE')::int AS "saleCount",
				COUNT(DISTINCT t."id") FILTER (WHERE t."type" = 'DEBT')::int AS "debtCount"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			WHERE ${this.buildTransactionWhere(range, scope, ['SALE', 'DEBT'])}
		`

		const saleRevenue = round2(row?.saleRevenue ?? 0)
		const debtIssued = round2(row?.debtIssued ?? 0)
		const netRevenue = round2(saleRevenue + debtIssued)
		const transactionCount = row?.transactionCount ?? 0
		const unitsSold = row?.unitsSold ?? 0
		const refundedUnits = row?.refundedUnits ?? 0

		return {
			saleRevenue,
			debtIssued,
			netRevenue,
			grossRevenue: round2(row?.grossRevenue ?? 0),
			refundedRevenue: round2(row?.refundedRevenue ?? 0),
			unitsSold,
			refundedUnits,
			discountAmount: round2(row?.discountAmount ?? 0),
			transactionCount,
			saleCount: row?.saleCount ?? 0,
			debtCount: row?.debtCount ?? 0,
			// Средний чек без продаж не равен нулю — он не определён; ноль здесь
			// читается как «чек нулевой», поэтому считаем только при наличии продаж.
			averageCheck:
				transactionCount > 0 ? round2(netRevenue / transactionCount) : 0,
			returnRate: unitsSold > 0 ? round2(refundedUnits / unitsSold) : 0,
		}
	}

	/**
	 * Состояние долгов на СЕЙЧАС, а не за период.
	 *
	 * Это осознанное отличие от остальных метрик: владельцу нужно знать, сколько
	 * ему должны сегодня, а не сколько долгов было выдано в выбранном окне.
	 * Период здесь применяется только к «собрано платежей».
	 */
	async getDebtMetrics(
		range: DateRange,
		scope: MetricsScope,
		now: Date = new Date(),
	): Promise<DebtMetrics> {
		const debtWhere: Prisma.TransactionWhereInput = {
			type: 'DEBT',
			status: { in: ['ACTIVE', 'PARTIAL'] },
		}
		if (scope.marketId) debtWhere.marketId = scope.marketId
		if (scope.sellerId) debtWhere.createdById = scope.sellerId

		const paymentWhere: Prisma.PaymentWhereInput = {
			createdAt: { gte: range.gte, lte: range.lte },
		}
		if (scope.marketId) {
			paymentWhere.transaction = { marketId: scope.marketId }
		}

		const [outstanding, overdue, dueSoon, debtorGroups, collected] =
			await Promise.all([
				this.prisma.transaction.aggregate({
					_sum: { remainingAmount: true },
					_count: { id: true },
					where: debtWhere,
				}),
				this.prisma.transaction.aggregate({
					_sum: { remainingAmount: true },
					_count: { id: true },
					where: { ...debtWhere, dueDate: { lt: now } },
				}),
				this.prisma.transaction.aggregate({
					_sum: { remainingAmount: true },
					_count: { id: true },
					where: {
						...debtWhere,
						dueDate: {
							gte: now,
							lte: new Date(now.getTime() + DUE_SOON_DAYS * MS_PER_DAY),
						},
					},
				}),
				this.prisma.transaction.groupBy({
					by: ['debtorId'],
					where: { ...debtWhere, debtorId: { not: null } },
					_sum: { remainingAmount: true },
				}),
				this.prisma.payment.aggregate({
					_sum: { amount: true },
					_count: { id: true },
					where: paymentWhere,
				}),
			])

		return {
			totalOutstanding: round2(outstanding._sum.remainingAmount ?? 0),
			activeDebtCount: outstanding._count.id,
			activeDebtorCount: debtorGroups.filter(
				group => (group._sum.remainingAmount ?? 0) > 0,
			).length,
			overdueAmount: round2(overdue._sum.remainingAmount ?? 0),
			overdueCount: overdue._count.id,
			dueSoonAmount: round2(dueSoon._sum.remainingAmount ?? 0),
			dueSoonCount: dueSoon._count.id,
			collectedAmount: round2(collected._sum.amount ?? 0),
			collectedCount: collected._count.id,
		}
	}

	/**
	 * Топ товаров периода по чистой выручке и по количеству.
	 * Один запрос отдаёт обе метрики — сортировку выбирает вызывающий,
	 * чтобы не делать два похожих обхода одних и тех же строк.
	 */
	async getProductLeaders(
		range: DateRange,
		scope: MetricsScope,
		limit = 5,
	): Promise<ProductLeaderRow[]> {
		const rows = await this.prisma.$queryRaw<
			Array<{
				productId: string
				productName: string
				netUnits: number
				netRevenue: number
				refundedUnits: number
			}>
		>`
			SELECT
				ti."productId" AS "productId",
				MIN(ti."productName") AS "productName",
				COALESCE(SUM(ti."quantity" - ti."refundedQuantity"), 0)::int AS "netUnits",
				COALESCE(SUM(ti."totalPrice" - ti."refundedQuantity" * ti."price"), 0)::float AS "netRevenue",
				COALESCE(SUM(ti."refundedQuantity"), 0)::int AS "refundedUnits"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			WHERE ${this.buildTransactionWhere(range, scope, ['SALE', 'DEBT'])}
			GROUP BY ti."productId"
			HAVING SUM(ti."quantity" - ti."refundedQuantity") > 0
			ORDER BY "netRevenue" DESC
			LIMIT ${limit * 4}
		`

		return rows.map(row => ({
			productId: row.productId,
			productName: row.productName,
			netUnits: row.netUnits,
			netRevenue: round2(row.netRevenue),
			refundedUnits: row.refundedUnits,
		}))
	}

	/**
	 * Возвраты периода в разрезе товаров.
	 *
	 * Возврат привязывается к дате ИСХОДНОЙ продажи (фильтр по t."createdAt"
	 * исходной транзакции), поэтому return rate товара не зависит от того,
	 * когда покупатель дошёл до магазина с возвратом.
	 */
	async getTopReturnedProducts(
		range: DateRange,
		scope: MetricsScope,
		limit = 5,
	): Promise<ReturnedProductRow[]> {
		const rows = await this.prisma.$queryRaw<
			Array<{
				productId: string
				productName: string
				refundedUnits: number
				refundedAmount: number
				unitsSold: number
			}>
		>`
			SELECT
				ti."productId" AS "productId",
				MIN(ti."productName") AS "productName",
				COALESCE(SUM(ti."refundedQuantity"), 0)::int AS "refundedUnits",
				COALESCE(SUM(ti."refundedQuantity" * ti."price"), 0)::float AS "refundedAmount",
				COALESCE(SUM(ti."quantity"), 0)::int AS "unitsSold"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			WHERE ${this.buildTransactionWhere(range, scope, ['SALE', 'DEBT'])}
			GROUP BY ti."productId"
			HAVING SUM(ti."refundedQuantity") > 0
			ORDER BY "refundedUnits" DESC
			LIMIT ${limit}
		`

		return rows.map(row => ({
			productId: row.productId,
			productName: row.productName,
			refundedUnits: row.refundedUnits,
			refundedAmount: round2(row.refundedAmount),
			unitsSold: row.unitsSold,
			returnRate:
				row.unitsSold > 0 ? round2(row.refundedUnits / row.unitsSold) : 0,
		}))
	}

	/**
	 * Выручка по категориям за период — отвечает на «какие категории ведут,
	 * а какие проваливаются». Товары без категории собираются в одну строку
	 * с categoryId = null, а не отбрасываются: иначе сумма по категориям
	 * не сходилась бы с общей выручкой.
	 */
	async getCategoryRevenue(
		range: DateRange,
		scope: MetricsScope,
	): Promise<CategoryRevenueRow[]> {
		const rows = await this.prisma.$queryRaw<
			Array<{
				categoryId: string | null
				categoryName: string | null
				netRevenue: number
				netUnits: number
			}>
		>`
			SELECT
				p."categoryId" AS "categoryId",
				MIN(c."name") AS "categoryName",
				COALESCE(SUM(ti."totalPrice" - ti."refundedQuantity" * ti."price"), 0)::float AS "netRevenue",
				COALESCE(SUM(ti."quantity" - ti."refundedQuantity"), 0)::int AS "netUnits"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			INNER JOIN "Product" p ON p."id" = ti."productId"
			LEFT JOIN "Category" c ON c."id" = p."categoryId"
			WHERE ${this.buildTransactionWhere(range, scope, ['SALE', 'DEBT'])}
			GROUP BY p."categoryId"
			ORDER BY "netRevenue" DESC
		`

		return rows.map(row => ({
			categoryId: row.categoryId,
			categoryName: row.categoryName,
			netRevenue: round2(row.netRevenue),
			netUnits: row.netUnits,
		}))
	}

	/**
	 * Тренд выручки по дням (для года — по месяцам).
	 * Возвраты вычитаются в том же бакете, где прошла продажа.
	 */
	async getRevenueTrend(
		range: DateRange,
		scope: MetricsScope,
		truncUnit: 'day' | 'month',
	): Promise<RevenueTrendRow[]> {
		return this.prisma.$queryRaw<RevenueTrendRow[]>`
			SELECT
				date_trunc(${truncUnit}, t."createdAt") AS date,
				COALESCE(SUM(ti."totalPrice" - ti."refundedQuantity" * ti."price"), 0)::float AS revenue,
				COUNT(DISTINCT t."id")::int AS "transactionCount"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			WHERE ${this.buildTransactionWhere(range, scope, ['SALE', 'DEBT'])}
			GROUP BY 1
			ORDER BY 1 ASC
		`
	}

	/**
	 * Как в бизнес пришли деньги: наличные, карта или в долг.
	 *
	 * Считается по тем же строкам и с тем же вычетом возвратов, что и
	 * netRevenue, поэтому суммы блока складываются в общую выручку периода.
	 * Прежний вариант брал только SALE и целиком отбрасывал транзакцию по
	 * статусу — после введения частичных возвратов доли переставали сходиться
	 * с выручкой на карточках.
	 */
	async getPaymentMix(
		range: DateRange,
		scope: MetricsScope,
	): Promise<PaymentMixRow[]> {
		const rows = await this.prisma.$queryRaw<
			Array<{ type: string; count: number; amount: number }>
		>`
			SELECT
				t."paymentType" AS "type",
				COUNT(DISTINCT t."id")::int AS "count",
				COALESCE(SUM(ti."totalPrice" - ti."refundedQuantity" * ti."price"), 0)::float AS "amount"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			WHERE ${this.buildTransactionWhere(range, scope, ['SALE', 'DEBT'])}
			GROUP BY t."paymentType"
			ORDER BY "amount" DESC
		`

		const total = rows.reduce((sum, row) => sum + row.amount, 0)

		return rows.map(row => ({
			type: row.type,
			count: row.count,
			amount: round2(row.amount),
			// Доля не определена, когда делить не на что: ноль читается как
			// «этим способом не платили», а не как «неизвестно».
			percentage: total > 0 ? round2((row.amount / total) * 100) : 0,
		}))
	}

	/**
	 * Условия выборки транзакций. Все значения подставляются параметрами
	 * Prisma.sql — пользовательский ввод никогда не склеивается в SQL-строку.
	 */
	private buildTransactionWhere(
		range: DateRange,
		scope: MetricsScope,
		types: string[],
	): Prisma.Sql {
		const conditions: Prisma.Sql[] = [
			Prisma.sql`t."type" IN (${Prisma.join(types)})`,
			Prisma.sql`t."createdAt" >= ${range.gte}`,
			Prisma.sql`t."createdAt" <= ${range.lte}`,
		]
		if (scope.marketId) {
			conditions.push(Prisma.sql`t."marketId" = ${scope.marketId}`)
		}
		if (scope.sellerId) {
			conditions.push(Prisma.sql`t."createdById" = ${scope.sellerId}`)
		}
		return Prisma.join(conditions, ' AND ')
	}
}
