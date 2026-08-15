import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AnalyticsService, ProductHealth, ReorderPriority } from '../analytics/analytics.service'
import { AnalyticsPeriod } from '../common/dto/period-query.dto'
import {
	buildComparison,
	formatSqlDate,
	resolvePeriod,
	round2
} from '../common/utils/period.util'
import {
	CategoryRevenueRow,
	DashboardMetricsService,
	MetricsScope
} from './dashboard-metrics.service'
import { DashboardInsightsService } from './dashboard-insights.service'
import { DashboardPeriod, QueryDashboardDto } from './dto/query-dashboard.dto'

interface RevenueTrendRow {
	date: Date
	revenue: number
	transactionCount: bigint
}

/** Порядок срочности закупки — тот же, что в списке товаров. */
const REORDER_ORDER: Record<ReorderPriority, number> = {
	[ReorderPriority.OUT_OF_STOCK]: 0,
	[ReorderPriority.CRITICAL]: 1,
	[ReorderPriority.WARNING]: 2,
	[ReorderPriority.OK]: 3,
	[ReorderPriority.NOT_NEEDED]: 4
}

interface SellerTotals {
	grossSales: number
	netSales: number
	salesCount: number
	refundsAmount: number
	refundsCount: number
	debtsAmount: number
	debtsCount: number
	collectedAmount: number
	collectedCount: number
}

const EMPTY_SELLER_TOTALS: SellerTotals = {
	grossSales: 0,
	netSales: 0,
	salesCount: 0,
	refundsAmount: 0,
	refundsCount: 0,
	debtsAmount: 0,
	debtsCount: 0,
	collectedAmount: 0,
	collectedCount: 0
}

/**
 * DashboardPeriod и AnalyticsPeriod — один и тот же набор значений; первый
 * оставлен ради обратной совместимости публичного API дашборда, второй
 * используется общим слоем аналитики.
 */
function toAnalyticsPeriod(
	period: DashboardPeriod | undefined
): AnalyticsPeriod | undefined {
	return period as unknown as AnalyticsPeriod | undefined
}

function buildPeriodDateRange(period: DashboardPeriod) {
	const now = new Date()
	const end = new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate(),
			23,
			59,
			59,
			999
		)
	)

	switch (period) {
		case DashboardPeriod.TODAY: {
			const start = new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
			)
			return { gte: start, lte: end }
		}
		case DashboardPeriod.WEEK: {
			const monday = new Date(
				Date.UTC(
					now.getUTCFullYear(),
					now.getUTCMonth(),
					now.getUTCDate() - ((now.getUTCDay() + 6) % 7)
				)
			)
			return { gte: monday, lte: end }
		}
		case DashboardPeriod.MONTH:
			return {
				gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
				lte: end
			}
		case DashboardPeriod.YEAR:
			return {
				gte: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
				lte: end
			}
	}
}

// Границы периода: границы считаются в UTC, чтобы фильтр, date_trunc-бакеты
// (UTC-сессия БД) и метки дней (formatSqlDate) не расходились.
// Без period/dateFrom/dateTo по умолчанию берётся текущий месяц — вместо
// полного скана всей истории транзакций.
function buildDateFilter(
	query: QueryDashboardDto
): { gte?: Date; lte?: Date } {
	if (query.period) return buildPeriodDateRange(query.period)
	if (query.dateFrom || query.dateTo) {
		const filter: { gte?: Date; lte?: Date } = {}
		if (query.dateFrom) filter.gte = new Date(query.dateFrom)
		if (query.dateTo) filter.lte = new Date(query.dateTo)
		return filter
	}
	return buildPeriodDateRange(DashboardPeriod.MONTH)
}

@Injectable()
export class DashboardService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly metrics: DashboardMetricsService,
		private readonly insights: DashboardInsightsService,
		private readonly analytics: AnalyticsService
	) {}

	/**
	 * Центр управления бизнесом: один запрос отдаёт продажи, долги, возвраты,
	 * состояние склада, сравнение с предыдущим периодом и рекомендации.
	 *
	 * Собрано в один endpoint намеренно (раздел «производительность»): все эти
	 * блоки нужны на первом экране одновременно, и десяток отдельных запросов
	 * дал бы худшее время до первой отрисовки при том же объёме работы БД.
	 */
	async getOverview(query: QueryDashboardDto, marketId?: string) {
		const period = resolvePeriod({
			period: toAnalyticsPeriod(query.period),
			dateFrom: query.dateFrom,
			dateTo: query.dateTo
		})
		const scope: MetricsScope = { marketId, sellerId: query.sellerId }

		const [
			salesCurrent,
			salesPrevious,
			debts,
			leaders,
			returnedProducts,
			categories,
			trendRows,
			paymentMix,
			inventory
		] = await Promise.all([
			this.metrics.getSalesMetrics(period.current, scope),
			this.metrics.getSalesMetrics(period.previous, scope),
			this.metrics.getDebtMetrics(period.current, scope),
			this.metrics.getProductLeaders(period.current, scope),
			this.metrics.getTopReturnedProducts(period.current, scope),
			this.metrics.getCategoryRevenue(period.current, scope),
			this.metrics.getRevenueTrend(period.current, scope, period.truncUnit),
			this.metrics.getPaymentMix(period.current, scope),
			this.getInventorySnapshot(period, marketId)
		])

		const previousCategories = await this.metrics.getCategoryRevenue(
			period.previous,
			scope
		)

		const salesComparison = buildComparison(
			salesCurrent.netRevenue,
			salesPrevious.netRevenue
		)

		return {
			period: {
				current: period.current,
				previous: period.previous,
				durationDays: period.durationDays
			},
			sales: {
				...salesCurrent,
				comparison: {
					netRevenue: salesComparison,
					transactionCount: buildComparison(
						salesCurrent.transactionCount,
						salesPrevious.transactionCount
					),
					averageCheck: buildComparison(
						salesCurrent.averageCheck,
						salesPrevious.averageCheck
					),
					unitsSold: buildComparison(
						salesCurrent.unitsSold,
						salesPrevious.unitsSold
					)
				}
			},
			debts,
			returns: {
				amount: salesCurrent.refundedRevenue,
				units: salesCurrent.refundedUnits,
				returnRate: salesCurrent.returnRate,
				// Влияние на фактическую выручку: сколько бы заработали без возвратов.
				revenueImpact: round2(
					salesCurrent.grossRevenue - salesCurrent.netRevenue
				),
				topProducts: returnedProducts,
				comparison: {
					amount: buildComparison(
						salesCurrent.refundedRevenue,
						salesPrevious.refundedRevenue
					),
					returnRate: buildComparison(
						salesCurrent.returnRate,
						salesPrevious.returnRate
					)
				}
			},
			inventory: inventory.summary,
			products: {
				topByRevenue: leaders.slice(0, 5),
				topByUnits: [...leaders].sort((a, b) => b.netUnits - a.netUnits).slice(0, 5),
				reorder: inventory.reorder
			},
			categories: this.compareCategories(categories, previousCategories),
			revenueTrend: trendRows.map(row => ({
				date: formatSqlDate(row.date),
				revenue: round2(row.revenue),
				transactionCount: Number(row.transactionCount)
			})),
			paymentMix,
			insights: this.insights.build({
				products: inventory.products,
				sales: salesCurrent,
				salesComparison,
				debts,
				returnedProducts,
				returnRateComparison: buildComparison(
					salesCurrent.returnRate,
					salesPrevious.returnRate
				)
			})
		}
	}

	async getDashboard(query: QueryDashboardDto, marketId?: string) {
		const transactionWhere: Prisma.TransactionWhereInput = {}
		if (marketId) transactionWhere.marketId = marketId
		if (query.sellerId) transactionWhere.createdById = query.sellerId

		const dateFilter = buildDateFilter(query)
		const hasDateFilter = Object.keys(dateFilter).length > 0
		const dateWhere: Prisma.TransactionWhereInput = hasDateFilter
			? { ...transactionWhere, createdAt: dateFilter }
			: transactionWhere

		const userWhere: Prisma.UserWhereInput = {}
		if (marketId) userWhere.marketId = marketId

		const debtorWhere: Prisma.DebtorWhereInput = {}
		if (marketId) debtorWhere.marketId = marketId
		if (query.sellerId) {
			debtorWhere.transactions = { some: { createdById: query.sellerId } }
		}

		// UTC, как и весь остальной dashboard — иначе todayTransactions расходится
		// с остальными метриками на хостах с ненулевым TZ-смещением.
		const now = new Date()
		const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
		const daysWhere = marketId
			? {
					marketId,
					...(query.sellerId ? { createdById: query.sellerId } : {}),
					createdAt: { gte: todayStart }
				}
			: { createdAt: { gte: todayStart } }

		const marketWhere = marketId ? { id: marketId } : {}

		const [
			totalMarkets,
			totalUsers,
			totalDebtors,
			totalTransactions,
			activeDebts,
			partialDebts,
			debtAgg,
			saleAgg,
			todayTransactions,
			recentTransactions,
			topDebtorGroups,
			paymentGroups,
			revenueRows
		] = await Promise.all([
			this.prisma.market.count({ where: marketWhere }),
			this.prisma.user.count({ where: userWhere }),
			this.prisma.debtor.count({ where: debtorWhere }),
			this.prisma.transaction.count({ where: dateWhere }),
			this.prisma.transaction.count({
				where: { ...dateWhere, type: 'DEBT', status: 'ACTIVE' }
			}),
			this.prisma.transaction.count({
				where: { ...dateWhere, type: 'DEBT', status: 'PARTIAL' }
			}),
			this.prisma.transaction.aggregate({
				_sum: { remainingAmount: true },
				where: {
					...dateWhere,
					type: 'DEBT',
					status: { in: ['ACTIVE', 'PARTIAL'] }
				}
			}),
			this.prisma.transaction.aggregate({
				_sum: { totalAmount: true },
				where: {
					...dateWhere,
					type: 'SALE',
					status: { not: 'REFUNDED' }
				}
			}),
			this.prisma.transaction.count({ where: daysWhere }),
			this.prisma.transaction.findMany({
				where: dateWhere,
				take: 5,
				orderBy: { createdAt: 'desc' },
				include: {
					debtor: { select: { id: true, name: true } },
					market: { select: { id: true, name: true } },
					createdBy: { select: { id: true, name: true } }
				}
			}),
			this.prisma.transaction.groupBy({
				by: ['debtorId'],
				where: {
					...dateWhere,
					debtorId: { not: null },
					type: 'DEBT',
					status: { in: ['ACTIVE', 'PARTIAL'] }
				},
				_sum: { remainingAmount: true },
				_count: { id: true },
				orderBy: { _sum: { remainingAmount: 'desc' } },
				take: 10
			}),
			this.prisma.transaction.groupBy({
				by: ['paymentType'],
				// Только SALE без REFUNDED: долги (DEBT) и возвраты (REFUND)
				// не являются выручкой и искажали "% от выручки".
				where: { ...dateWhere, type: 'SALE', status: { not: 'REFUNDED' } },
				_count: { _all: true },
				_sum: { totalAmount: true }
			}),
			this.getRevenueTrend(dateWhere, query, marketId)
		])

		const debtorIds = topDebtorGroups
			.map(g => g.debtorId)
			.filter(Boolean) as string[]

		const debtors =
			debtorIds.length > 0
				? await this.prisma.debtor.findMany({
						where: { id: { in: debtorIds } },
						include: { market: { select: { id: true, name: true } } }
					})
				: []

		const debtorMap = new Map(debtors.map(d => [d.id, d]))

		const topDebtors = topDebtorGroups.map(g => {
			const debtor = debtorMap.get(g.debtorId!)
			return {
				id: g.debtorId!,
				name: debtor?.name ?? 'Unknown',
				phone: debtor?.phone ?? '',
				market: debtor?.market ?? undefined,
				totalDebt: g._sum.remainingAmount ?? 0,
				activeTransactions: g._count.id
			}
		})

		const paymentTotal = paymentGroups.reduce(
			(sum, g) => sum + (g._sum.totalAmount ?? 0),
			0
		)
		const paymentDistribution = paymentGroups.map(g => ({
			type: g.paymentType,
			count: g._count._all,
			amount: g._sum.totalAmount ?? 0,
			percentage:
				paymentTotal > 0
					? Math.round(((g._sum.totalAmount ?? 0) / paymentTotal) * 1000) / 10
					: 0
		}))

		const revenueTrend = revenueRows.map(row => ({
			date: formatSqlDate(row.date),
			revenue: row.revenue,
			transactionCount: Number(row.transactionCount)
		}))

		return {
			stats: {
				totalMarkets,
				totalUsers,
				totalDebtors,
				totalTransactions,
				activeDebts,
				partialDebts,
				totalDebtAmount: debtAgg._sum.remainingAmount ?? 0,
				totalSaleAmount: saleAgg._sum.totalAmount ?? 0,
				todayTransactions
			},
			recentTransactions,
			topDebtors,
			revenueTrend,
			paymentDistribution
		}
	}

	/**
	 * Состояние склада + список «что заказать».
	 *
	 * Метрики считаются по всему каталогу маркета одним агрегатом продаж
	 * (без N+1), затем сводка и топ закупки берутся из уже посчитанного —
	 * повторных обращений к БД на товар нет.
	 */
	private async getInventorySnapshot(
		period: ReturnType<typeof resolvePeriod>,
		marketId?: string
	) {
		const where: Prisma.ProductWhereInput = marketId ? { marketId } : {}

		const products = await this.prisma.product.findMany({
			where,
			select: {
				id: true,
				name: true,
				quantity: true,
				price: true,
				lowStockThreshold: true,
				unit: true,
				image: true,
				category: { select: { id: true, name: true } }
			}
		})

		const sales = await this.analytics.getProductSalesRows(
			period.current,
			marketId
		)

		const enriched = products.map(product => ({
			...product,
			metrics: this.analytics.computeProductMetrics(
				product,
				sales.get(product.id),
				period.durationDays
			)
		}))

		const countHealth = (health: ProductHealth) =>
			enriched.filter(p => p.metrics.health === health).length

		return {
			products: enriched,
			summary: {
				totalProducts: enriched.length,
				outOfStock: countHealth(ProductHealth.OUT_OF_STOCK),
				critical: countHealth(ProductHealth.CRITICAL),
				lowStock: countHealth(ProductHealth.LOW_STOCK),
				slowMoving: countHealth(ProductHealth.SLOW_MOVING),
				noSales: countHealth(ProductHealth.NO_SALES),
				highReturns: countHealth(ProductHealth.HIGH_RETURNS),
				healthy: countHealth(ProductHealth.HEALTHY),
				needsReorder: enriched.filter(p => p.metrics.recommendedQuantity > 0)
					.length,
				// Деньги, лежащие на складе, и отдельно — замороженные в неликвиде.
				stockValue: round2(
					enriched.reduce((sum, p) => sum + p.quantity * p.price, 0)
				),
				slowMovingValue: round2(
					enriched
						.filter(p => p.metrics.health === ProductHealth.SLOW_MOVING)
						.reduce((sum, p) => sum + p.quantity * p.price, 0)
				)
			},
			// Список закупки: сначала самое срочное, потом по остатку дней.
			reorder: enriched
				.filter(p => p.metrics.recommendedQuantity > 0)
				.sort((a, b) => {
					const diff =
						REORDER_ORDER[a.metrics.reorderPriority] -
						REORDER_ORDER[b.metrics.reorderPriority]
					if (diff !== 0) return diff
					return (
						(a.metrics.daysOfStockRemaining ?? Infinity) -
						(b.metrics.daysOfStockRemaining ?? Infinity)
					)
				})
				.slice(0, 10)
		}
	}

	/**
	 * Категории с сравнением к предыдущему периоду. Нужно, чтобы отличить
	 * «лидирующие» от «проваливающихся» — по одному текущему числу этого
	 * не видно.
	 */
	private compareCategories(
		current: CategoryRevenueRow[],
		previous: CategoryRevenueRow[]
	) {
		const previousMap = new Map(
			previous.map(row => [row.categoryId ?? 'none', row.netRevenue])
		)

		return current.map(row => ({
			categoryId: row.categoryId,
			categoryName: row.categoryName,
			netRevenue: row.netRevenue,
			netUnits: row.netUnits,
			comparison: buildComparison(
				row.netRevenue,
				previousMap.get(row.categoryId ?? 'none') ?? 0
			)
		}))
	}

	/**
	 * Отчёт по продавцам с сравнением к предыдущему периоду.
	 *
	 * Возврат вычитается из результата того продавца, который совершил исходную
	 * SALE (через refundOf.createdById), а не того, кто оформил возврат —
	 * иначе оформление возвратов портило бы показатели случайного сотрудника.
	 */
	async getSellersReport(query: QueryDashboardDto, marketId?: string) {
		const period = resolvePeriod({
			period: toAnalyticsPeriod(query.period),
			dateFrom: query.dateFrom,
			dateTo: query.dateTo
		})

		const [current, previous] = await Promise.all([
			this.getSellerTotals(period.current, marketId, query.sellerId),
			this.getSellerTotals(period.previous, marketId, query.sellerId)
		])

		const sellerIds = [...new Set([...current.keys(), ...previous.keys()])]

		const sellers = sellerIds.length
			? await this.prisma.user.findMany({
					where: { id: { in: sellerIds } },
					select: { id: true, name: true, email: true, image: true, role: true }
				})
			: []
		const sellerMap = new Map(sellers.map(s => [s.id, s]))

		const rows = sellerIds.map(id => {
			const now = current.get(id) ?? EMPTY_SELLER_TOTALS
			const before = previous.get(id) ?? EMPTY_SELLER_TOTALS

			return {
				seller: sellerMap.get(id) ?? null,
				salesCount: now.salesCount,
				salesAmount: now.netSales,
				grossSalesAmount: now.grossSales,
				refundsCount: now.refundsCount,
				refundsAmount: now.refundsAmount,
				debtsCount: now.debtsCount,
				debtsAmount: now.debtsAmount,
				collectedAmount: now.collectedAmount,
				collectedCount: now.collectedCount,
				transactionCount: now.salesCount + now.debtsCount,
				averageTransaction:
					now.salesCount + now.debtsCount > 0
						? round2(
								(now.netSales + now.debtsAmount) /
									(now.salesCount + now.debtsCount)
							)
						: 0,
				// Доля возвратов от валовых продаж продавца — сопоставима между
				// продавцами разного объёма, в отличие от абсолютной суммы.
				returnRate:
					now.grossSales > 0 ? round2(now.refundsAmount / now.grossSales) : 0,
				comparison: {
					salesAmount: buildComparison(now.netSales, before.netSales),
					salesCount: buildComparison(now.salesCount, before.salesCount),
					debtsAmount: buildComparison(now.debtsAmount, before.debtsAmount),
					refundsAmount: buildComparison(
						now.refundsAmount,
						before.refundsAmount
					),
					collectedAmount: buildComparison(
						now.collectedAmount,
						before.collectedAmount
					)
				}
			}
		})

		// Лучший продавец сверху: сортируем по чистым продажам.
		return rows.sort((a, b) => b.salesAmount - a.salesAmount)
	}

	/**
	 * Сырые итоги по каждому продавцу за одно окно. Вынесено отдельно, чтобы
	 * текущий и предыдущий период считались одним и тем же кодом — иначе
	 * сравнение легко становится сравнением двух разных определений метрики.
	 */
	private async getSellerTotals(
		range: { gte: Date; lte: Date },
		marketId?: string,
		sellerId?: string
	): Promise<Map<string, SellerTotals>> {
		const where: Prisma.TransactionWhereInput = {
			createdAt: { gte: range.gte, lte: range.lte }
		}
		if (marketId) where.marketId = marketId
		if (sellerId) where.createdById = sellerId

		const paymentWhere: Prisma.PaymentWhereInput = {
			createdAt: { gte: range.gte, lte: range.lte }
		}
		if (marketId) paymentWhere.transaction = { marketId }
		if (sellerId) paymentWhere.createdById = sellerId

		const [saleGroups, debtGroups, refundRows, paymentGroups] =
			await Promise.all([
				this.prisma.transaction.groupBy({
					by: ['createdById'],
					where: { ...where, type: 'SALE' },
					_sum: { totalAmount: true },
					_count: { id: true }
				}),
				this.prisma.transaction.groupBy({
					by: ['createdById'],
					where: { ...where, type: 'DEBT' },
					_sum: { totalAmount: true },
					_count: { id: true }
				}),
				this.prisma.transaction.findMany({
					where: { ...where, type: 'REFUND' },
					select: {
						totalAmount: true,
						refundOf: { select: { createdById: true } }
					}
				}),
				this.prisma.payment.groupBy({
					by: ['createdById'],
					where: paymentWhere,
					_sum: { amount: true },
					_count: { id: true }
				})
			])

		const totals = new Map<string, SellerTotals>()
		const ensure = (id: string): SellerTotals => {
			const existing = totals.get(id)
			if (existing) return existing
			const created = { ...EMPTY_SELLER_TOTALS }
			totals.set(id, created)
			return created
		}

		for (const group of saleGroups) {
			const row = ensure(group.createdById)
			row.grossSales = round2(group._sum.totalAmount ?? 0)
			row.netSales = row.grossSales
			row.salesCount = group._count.id
		}
		for (const group of debtGroups) {
			const row = ensure(group.createdById)
			row.debtsAmount = round2(group._sum.totalAmount ?? 0)
			row.debtsCount = group._count.id
		}
		for (const refund of refundRows) {
			const sellerOfSale = refund.refundOf?.createdById
			if (!sellerOfSale) continue
			const row = ensure(sellerOfSale)
			row.refundsAmount = round2(row.refundsAmount + refund.totalAmount)
			row.refundsCount += 1
			row.netSales = round2(row.netSales - refund.totalAmount)
		}
		for (const group of paymentGroups) {
			const row = ensure(group.createdById)
			row.collectedAmount = round2(group._sum.amount ?? 0)
			row.collectedCount = group._count.id
		}

		return totals
	}

	/**
	 * Выручка по дням (для периода YEAR — по месяцам, дата = первое число месяца).
	 * Считается только по SALE-транзакциям без статуса REFUNDED, с учётом
	 * фильтров маркета/продавца/даты.
	 */
	private async getRevenueTrend(
		dateWhere: Record<string, any>,
		query: QueryDashboardDto,
		marketId?: string
	): Promise<RevenueTrendRow[]> {
		const truncUnit = query.period === DashboardPeriod.YEAR ? 'month' : 'day'

		const conditions: Prisma.Sql[] = [
			Prisma.sql`"type" = 'SALE'`,
			Prisma.sql`"status" <> 'REFUNDED'`
		]
		if (marketId) conditions.push(Prisma.sql`"marketId" = ${marketId}`)
		if (query.sellerId)
			conditions.push(Prisma.sql`"createdById" = ${query.sellerId}`)
		if (dateWhere.createdAt?.gte)
			conditions.push(Prisma.sql`"createdAt" >= ${dateWhere.createdAt.gte}`)
		if (dateWhere.createdAt?.lte)
			conditions.push(Prisma.sql`"createdAt" <= ${dateWhere.createdAt.lte}`)

		return this.prisma.$queryRaw<RevenueTrendRow[]>`
			SELECT
				date_trunc(${truncUnit}, "createdAt") AS date,
				COALESCE(SUM("totalAmount"), 0) AS revenue,
				COUNT(*) AS "transactionCount"
			FROM "Transaction"
			WHERE ${Prisma.join(conditions, ' AND ')}
			GROUP BY 1
			ORDER BY 1 ASC
		`
	}
}
