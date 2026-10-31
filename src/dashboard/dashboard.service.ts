import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
	AnalyticsService,
	compareReorderUrgency,
	ProductHealth
} from '../analytics/analytics.service'
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
import { DashboardSellersService } from './dashboard-sellers.service'
import { DashboardPeriod, QueryDashboardDto } from './dto/query-dashboard.dto'

interface RevenueTrendRow {
	date: Date
	revenue: number
	transactionCount: bigint
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

function buildDateFilter(
	query: QueryDashboardDto
): { gte?: Date; lte?: Date } {
	if (query.period) {
		return resolvePeriod({ period: toAnalyticsPeriod(query.period) }).current
	}
	if (query.dateFrom || query.dateTo) {
		const filter: { gte?: Date; lte?: Date } = {}
		if (query.dateFrom) filter.gte = new Date(query.dateFrom)
		if (query.dateTo) filter.lte = new Date(query.dateTo)
		return filter
	}
	return resolvePeriod({ period: AnalyticsPeriod.MONTH }).current
}

@Injectable()
export class DashboardService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly metrics: DashboardMetricsService,
		private readonly insights: DashboardInsightsService,
		private readonly analytics: AnalyticsService,
		private readonly sellers?: DashboardSellersService
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
			previousCategories,
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
			// Раньше считалось отдельным await ПОСЛЕ этого Promise.all — лишняя
			// последовательная стадия при том же объёме работы БД, ничем не
			// оправданная (все метрики независимы друг от друга).
			this.metrics.getCategoryRevenue(period.previous, scope),
			this.metrics.getRevenueTrend(period.current, scope, period.truncUnit),
			this.metrics.getPaymentMix(period.current, scope),
			this.getInventorySnapshot(period, marketId)
		])

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

	async getSellersReport(query: QueryDashboardDto, marketId?: string) {
		return (this.sellers ?? new DashboardSellersService(this.prisma)).getSellersReport(
			query,
			marketId
		)
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
		// Архивные товары сняты с продажи: в «закончилось» и «что заказать» им не место.
		const where: Prisma.ProductWhereInput = marketId
			? { marketId, isActive: true }
			: { isActive: true }

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
				.sort((a, b) => compareReorderUrgency(a.metrics, b.metrics))
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
