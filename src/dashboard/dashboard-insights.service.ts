import { Injectable } from '@nestjs/common'
import {
	ANALYTICS_THRESHOLDS,
	ProductHealth,
	ProductMetrics,
	ReorderPriority,
} from '../analytics/analytics.service'
import { DebtorRisk, DebtStatusFilter } from '../enums'
import { DUE_SOON_DAYS, MetricComparison } from '../common/utils/period.util'
import { DebtMetrics, ReturnedProductRow, SalesMetrics } from './dashboard-metrics.service'

/**
 * Насколько срочно это требует внимания владельца.
 * Совпадает с семантическими цветами фронтенда: destructive / warning /
 * primary / success — без хардкода цветов на бэкенде.
 */
export enum InsightSeverity {
	CRITICAL = 'critical',
	WARNING = 'warning',
	INFO = 'info',
	SUCCESS = 'success',
}

export enum InsightCategory {
	INVENTORY = 'inventory',
	SALES = 'sales',
	DEBTS = 'debts',
	RETURNS = 'returns',
}

/**
 * Одна рекомендация.
 *
 * Текст НЕ формируется на бэкенде: отдаём ключ перевода и параметры, чтобы
 * одна и та же логика читалась на ru/en/tg без дублирования правил.
 * `action` указывает на существующий маршрут и его фильтры — фиктивных
 * URL здесь быть не должно.
 */
export interface BusinessInsight {
	id: string
	severity: InsightSeverity
	category: InsightCategory
	messageKey: string
	params: Record<string, string | number>
	action?: {
		route: string
		query?: Record<string, string>
	}
}

/** Что нужно движку правил, чтобы вынести суждение. */
export interface InsightInput {
	products: Array<{ id: string; name: string; metrics: ProductMetrics }>
	sales: SalesMetrics
	salesComparison: MetricComparison
	debts: DebtMetrics
	returnedProducts: ReturnedProductRow[]
	returnRateComparison: MetricComparison
}

/** Сколько рекомендаций отдаём максимум — список должен оставаться читаемым. */
const MAX_INSIGHTS = 12

@Injectable()
export class DashboardInsightsService {
	/**
	 * Детерминированные бизнес-правила — без LLM и без эвристик «на глаз».
	 * Каждое правило опирается на порог из ANALYTICS_THRESHOLDS, поэтому
	 * поведение системы объяснимо и настраивается в одном месте.
	 *
	 * Порядок выдачи: по severity, затем по «цене вопроса» внутри severity.
	 */
	build(input: InsightInput): BusinessInsight[] {
		const insights = [
			...this.inventoryInsights(input.products),
			...this.salesInsights(input.sales, input.salesComparison),
			...this.debtInsights(input.debts),
			...this.returnInsights(
				input.sales,
				input.returnedProducts,
				input.returnRateComparison,
			),
		]

		const order = {
			[InsightSeverity.CRITICAL]: 0,
			[InsightSeverity.WARNING]: 1,
			[InsightSeverity.INFO]: 2,
			[InsightSeverity.SUCCESS]: 3,
		}

		return insights
			.sort((a, b) => order[a.severity] - order[b.severity])
			.slice(0, MAX_INSIGHTS)
	}

	private inventoryInsights(
		products: InsightInput['products'],
	): BusinessInsight[] {
		const insights: BusinessInsight[] = []

		// Кончился товар, который продаётся: прямая упущенная выручка.
		const outOfStock = products.filter(
			p => p.metrics.reorderPriority === ReorderPriority.OUT_OF_STOCK,
		)
		if (outOfStock.length > 0) {
			insights.push({
				id: 'inventory.outOfStock',
				severity: InsightSeverity.CRITICAL,
				category: InsightCategory.INVENTORY,
				messageKey: 'insights.inventory.outOfStock',
				params: { count: outOfStock.length, example: outOfStock[0].name },
				action: {
					route: '/products',
					query: { reorderPriority: ReorderPriority.OUT_OF_STOCK },
				},
			})
		}

		const critical = products.filter(
			p => p.metrics.reorderPriority === ReorderPriority.CRITICAL,
		)
		if (critical.length > 0) {
			// Самый срочный — с наименьшим запасом в днях.
			const soonest = critical.reduce((worst, current) =>
				(current.metrics.daysOfStockRemaining ?? Infinity) <
				(worst.metrics.daysOfStockRemaining ?? Infinity)
					? current
					: worst,
			)
			insights.push({
				id: 'inventory.critical',
				severity: InsightSeverity.CRITICAL,
				category: InsightCategory.INVENTORY,
				messageKey: 'insights.inventory.critical',
				params: {
					count: critical.length,
					example: soonest.name,
					days: soonest.metrics.daysOfStockRemaining ?? 0,
				},
				action: {
					route: '/products',
					query: { reorderPriority: ReorderPriority.CRITICAL },
				},
			})
		}

		const warning = products.filter(
			p => p.metrics.reorderPriority === ReorderPriority.WARNING,
		)
		if (warning.length > 0) {
			insights.push({
				id: 'inventory.runningOut',
				severity: InsightSeverity.WARNING,
				category: InsightCategory.INVENTORY,
				messageKey: 'insights.inventory.runningOut',
				params: {
					count: warning.length,
					days: ANALYTICS_THRESHOLDS.WARNING_DAYS_OF_STOCK,
				},
				action: {
					route: '/products',
					query: { reorderPriority: ReorderPriority.WARNING },
				},
			})
		}

		// Деньги, замороженные в товаре, который почти не двигается.
		const slowMoving = products.filter(
			p => p.metrics.health === ProductHealth.SLOW_MOVING,
		)
		if (slowMoving.length > 0) {
			insights.push({
				id: 'inventory.slowMoving',
				severity: InsightSeverity.WARNING,
				category: InsightCategory.INVENTORY,
				messageKey: 'insights.inventory.slowMoving',
				params: {
					count: slowMoving.length,
					days: ANALYTICS_THRESHOLDS.SLOW_MOVING_DAYS_OF_STOCK,
				},
				action: {
					route: '/products',
					query: { health: ProductHealth.SLOW_MOVING },
				},
			})
		}

		const noSales = products.filter(
			p => p.metrics.health === ProductHealth.NO_SALES,
		)
		if (noSales.length > 0) {
			insights.push({
				id: 'inventory.noSales',
				severity: InsightSeverity.INFO,
				category: InsightCategory.INVENTORY,
				messageKey: 'insights.inventory.noSales',
				params: { count: noSales.length },
				action: {
					route: '/products',
					query: { health: ProductHealth.NO_SALES },
				},
			})
		}

		const toReorder = products.filter(p => p.metrics.recommendedQuantity > 0)
		if (toReorder.length > 0) {
			insights.push({
				id: 'inventory.reorderList',
				severity: InsightSeverity.INFO,
				category: InsightCategory.INVENTORY,
				messageKey: 'insights.inventory.reorderList',
				params: { count: toReorder.length },
				action: { route: '/products', query: { needsReorder: 'true' } },
			})
		}

		// Товар-рекордсмен по числу транзакций за период. Абсолютное число
		// может быть маленьким (например 2) — важно, что это максимум среди
		// всех товаров: значит именно он лучше всего "уходит" прямо сейчас.
		const withSales = products.filter(p => p.metrics.transactionCount > 0)
		if (withSales.length > 0) {
			const record = withSales.reduce((best, current) =>
				current.metrics.transactionCount > best.metrics.transactionCount
					? current
					: best,
			)
			insights.push({
				id: 'inventory.recordProduct',
				severity: InsightSeverity.SUCCESS,
				category: InsightCategory.INVENTORY,
				messageKey: 'insights.inventory.recordProduct',
				params: {
					name: record.name,
					count: record.metrics.transactionCount,
				},
				action: { route: '/products', query: { search: record.name } },
			})
		}

		return insights
	}

	private salesInsights(
		sales: SalesMetrics,
		comparison: MetricComparison,
	): BusinessInsight[] {
		const insights: BusinessInsight[] = []

		if (sales.transactionCount === 0) {
			insights.push({
				id: 'sales.noSales',
				severity: InsightSeverity.WARNING,
				category: InsightCategory.SALES,
				messageKey: 'insights.sales.none',
				params: {},
			})
			return insights
		}

		// Процент считаем только когда предыдущий период был непустым:
		// иначе changePercent === null и «рост» не выразить числом.
		const change = comparison.changePercent
		if (change !== null) {
			if (change <= -ANALYTICS_THRESHOLDS.SIGNIFICANT_CHANGE_PERCENT) {
				insights.push({
					id: 'sales.declining',
					severity: InsightSeverity.WARNING,
					category: InsightCategory.SALES,
					messageKey: 'insights.sales.declining',
					params: { percent: Math.abs(change), previous: comparison.previous },
				})
			} else if (change >= ANALYTICS_THRESHOLDS.SIGNIFICANT_CHANGE_PERCENT) {
				insights.push({
					id: 'sales.growing',
					severity: InsightSeverity.SUCCESS,
					category: InsightCategory.SALES,
					messageKey: 'insights.sales.growing',
					params: { percent: change, previous: comparison.previous },
				})
			}
		}

		return insights
	}

	private debtInsights(debts: DebtMetrics): BusinessInsight[] {
		const insights: BusinessInsight[] = []

		if (debts.overdueCount > 0) {
			insights.push({
				id: 'debts.overdue',
				severity: InsightSeverity.CRITICAL,
				category: InsightCategory.DEBTS,
				messageKey: 'insights.debts.overdue',
				params: { count: debts.overdueCount, amount: debts.overdueAmount },
				action: {
					route: '/transactions',
					query: { debtStatus: DebtStatusFilter.OVERDUE },
				},
			})
		}

		if (debts.dueSoonCount > 0) {
			insights.push({
				id: 'debts.dueSoon',
				severity: InsightSeverity.WARNING,
				category: InsightCategory.DEBTS,
				messageKey: 'insights.debts.dueSoon',
				params: {
					count: debts.dueSoonCount,
					amount: debts.dueSoonAmount,
					days: DUE_SOON_DAYS,
				},
				action: {
					route: '/transactions',
					query: { debtStatus: DebtStatusFilter.DUE_SOON },
				},
			})
		}

		// Долг «висит», но за период не собрано ничего — это про работу с
		// должниками, а не про продажи, поэтому отдельная рекомендация.
		if (debts.totalOutstanding > 0 && debts.collectedCount === 0) {
			insights.push({
				id: 'debts.noCollection',
				severity: InsightSeverity.WARNING,
				category: InsightCategory.DEBTS,
				messageKey: 'insights.debts.noCollection',
				params: {
					amount: debts.totalOutstanding,
					debtors: debts.activeDebtorCount,
				},
				// Ведём не на весь список, а на тех, с кого начинать разговор.
				action: { route: '/debtors', query: { risk: DebtorRisk.HIGH } },
			})
		}

		return insights
	}

	private returnInsights(
		sales: SalesMetrics,
		returnedProducts: ReturnedProductRow[],
		comparison: MetricComparison,
	): BusinessInsight[] {
		const insights: BusinessInsight[] = []

		// Общая доля возвратов осмысленна только на достаточном объёме продаж.
		if (
			sales.unitsSold >= ANALYTICS_THRESHOLDS.MIN_UNITS_FOR_RETURN_RATE &&
			sales.returnRate >= ANALYTICS_THRESHOLDS.HIGH_RETURN_RATE
		) {
			insights.push({
				id: 'returns.highRate',
				severity: InsightSeverity.WARNING,
				category: InsightCategory.RETURNS,
				messageKey: 'insights.returns.highRate',
				params: {
					percent: Math.round(sales.returnRate * 1000) / 10,
					amount: sales.refundedRevenue,
				},
				action: {
					route: '/products',
					query: { health: ProductHealth.HIGH_RETURNS },
				},
			})
		}

		const worst = returnedProducts.find(
			row =>
				row.unitsSold >= ANALYTICS_THRESHOLDS.MIN_UNITS_FOR_RETURN_RATE &&
				row.returnRate >= ANALYTICS_THRESHOLDS.HIGH_RETURN_RATE,
		)
		if (worst) {
			insights.push({
				id: 'returns.problemProduct',
				severity: InsightSeverity.WARNING,
				category: InsightCategory.RETURNS,
				messageKey: 'insights.returns.problemProduct',
				params: {
					name: worst.productName,
					percent: Math.round(worst.returnRate * 1000) / 10,
					units: worst.refundedUnits,
				},
				action: { route: '/products', query: { search: worst.productName } },
			})
		}

		if (
			comparison.changePercent !== null &&
			comparison.changePercent >= ANALYTICS_THRESHOLDS.SIGNIFICANT_CHANGE_PERCENT
		) {
			insights.push({
				id: 'returns.growing',
				severity: InsightSeverity.INFO,
				category: InsightCategory.RETURNS,
				messageKey: 'insights.returns.growing',
				params: { percent: comparison.changePercent },
			})
		}

		return insights
	}
}
