import {
	AnalyticsService,
	ANALYTICS_THRESHOLDS,
	ProductHealth,
	ReorderPriority,
} from './analytics.service'

describe('AnalyticsService.computeProductMetrics', () => {
	// computeProductMetrics — чистая функция, БД ей не нужна.
	const service = new AnalyticsService({} as never)

	const product = { id: 'p1', quantity: 100, lowStockThreshold: 10 }
	const sales = (over: Partial<{
		unitsSold: number
		refundedUnits: number
		revenue: number
		transactionCount: number
	}> = {}) => ({
		productId: 'p1',
		unitsSold: 0,
		refundedUnits: 0,
		revenue: 0,
		transactionCount: 0,
		...over,
	})

	describe('sales velocity', () => {
		it('averages net units over the period length', () => {
			const metrics = service.computeProductMetrics(
				product,
				sales({ unitsSold: 60, refundedUnits: 0 }),
				30,
			)

			expect(metrics.avgDailySales).toBe(2)
			expect(metrics.daysOfStockRemaining).toBe(50)
		})

		it('excludes refunded units from velocity', () => {
			// Возвращённый товар не «продан» — иначе скорость расхода завышена
			// и система советует закупать больше, чем нужно.
			const metrics = service.computeProductMetrics(
				product,
				sales({ unitsSold: 60, refundedUnits: 30 }),
				30,
			)

			expect(metrics.netUnitsSold).toBe(30)
			expect(metrics.avgDailySales).toBe(1)
		})

		// Честнее не знать, чем нарисовать «бесконечный запас».
		it('reports unknown days of stock when there were no sales', () => {
			const metrics = service.computeProductMetrics(product, undefined, 30)

			expect(metrics.daysOfStockRemaining).toBeNull()
			expect(metrics.avgDailySales).toBe(0)
		})
	})

	describe('reorder priority', () => {
		it('marks a selling product that ran out as OUT_OF_STOCK', () => {
			const metrics = service.computeProductMetrics(
				{ ...product, quantity: 0 },
				sales({ unitsSold: 30 }),
				30,
			)

			expect(metrics.reorderPriority).toBe(ReorderPriority.OUT_OF_STOCK)
		})

		// Кончившийся товар, который никто не покупает, закупать не нужно.
		it('does not ask to reorder a product that ran out but never sells', () => {
			const metrics = service.computeProductMetrics(
				{ ...product, quantity: 0 },
				undefined,
				30,
			)

			expect(metrics.reorderPriority).toBe(ReorderPriority.NOT_NEEDED)
			expect(metrics.recommendedQuantity).toBe(0)
		})

		it('escalates to CRITICAL below the critical days threshold', () => {
			// 2 дня запаса при 5 шт/день.
			const metrics = service.computeProductMetrics(
				{ ...product, quantity: 10 },
				sales({ unitsSold: 150 }),
				30,
			)

			expect(metrics.daysOfStockRemaining).toBeLessThanOrEqual(
				ANALYTICS_THRESHOLDS.CRITICAL_DAYS_OF_STOCK,
			)
			expect(metrics.reorderPriority).toBe(ReorderPriority.CRITICAL)
		})

		it('respects the manual low stock threshold even when velocity is fine', () => {
			const metrics = service.computeProductMetrics(
				{ id: 'p1', quantity: 8, lowStockThreshold: 10 },
				sales({ unitsSold: 3 }),
				30,
			)

			expect(metrics.reorderPriority).toBe(ReorderPriority.WARNING)
		})

		// Регрессия: раньше товар без продаж в выбранном периоде никогда не
		// попадал в reorder-список, даже если физически ниже ручного порога.
		it('respects the manual low stock threshold even with no sales in the period', () => {
			const metrics = service.computeProductMetrics(
				{ id: 'p1', quantity: 8, lowStockThreshold: 10 },
				undefined,
				30,
			)

			expect(metrics.reorderPriority).toBe(ReorderPriority.WARNING)
			expect(metrics.recommendedQuantity).toBeGreaterThan(0)
		})

		it('ignores a zero manual threshold instead of matching quantity <= 0', () => {
			const metrics = service.computeProductMetrics(
				{ id: 'p1', quantity: 8, lowStockThreshold: 0 },
				undefined,
				30,
			)

			expect(metrics.reorderPriority).toBe(ReorderPriority.NOT_NEEDED)
		})
	})

	describe('recommended quantity', () => {
		it('tops the stock up to the target cover window', () => {
			// 5 шт/день, запас 10 → до 14 дней нужно 70, не хватает 60.
			const metrics = service.computeProductMetrics(
				{ ...product, quantity: 10 },
				sales({ unitsSold: 150 }),
				30,
			)

			expect(metrics.recommendedQuantity).toBe(60)
		})

		it('recommends nothing when stock is comfortable', () => {
			const metrics = service.computeProductMetrics(
				product,
				sales({ unitsSold: 30 }),
				30,
			)

			expect(metrics.reorderPriority).toBe(ReorderPriority.OK)
			expect(metrics.recommendedQuantity).toBe(0)
		})
	})

	describe('return rate', () => {
		// На двух продажах доля возвратов статистически не значит ничего.
		it('ignores return rate below the minimum sales volume', () => {
			const metrics = service.computeProductMetrics(
				product,
				sales({ unitsSold: 2, refundedUnits: 1 }),
				30,
			)

			expect(metrics.returnRate).toBe(0)
		})

		it('computes return rate once there is enough volume', () => {
			const metrics = service.computeProductMetrics(
				product,
				sales({ unitsSold: 20, refundedUnits: 5 }),
				30,
			)

			expect(metrics.returnRate).toBe(0.25)
		})
	})

	describe('health', () => {
		it('reports OUT_OF_STOCK before anything else', () => {
			const metrics = service.computeProductMetrics(
				{ ...product, quantity: 0 },
				sales({ unitsSold: 30 }),
				30,
			)

			expect(metrics.health).toBe(ProductHealth.OUT_OF_STOCK)
		})

		it('flags a product with a high return rate', () => {
			const metrics = service.computeProductMetrics(
				product,
				sales({ unitsSold: 20, refundedUnits: 6 }),
				30,
			)

			expect(metrics.health).toBe(ProductHealth.HIGH_RETURNS)
		})

		it('flags stock that will outlast the slow moving threshold', () => {
			// Один и тот же товар с одной и той же скоростью продаж: разница
			// только в остатке, и она решает, «здоров» товар или заморожен.
			const healthy = service.computeProductMetrics(
				{ ...product, quantity: 50 },
				sales({ unitsSold: 60 }),
				30,
			)

			expect(healthy.daysOfStockRemaining).toBeLessThan(
				ANALYTICS_THRESHOLDS.SLOW_MOVING_DAYS_OF_STOCK,
			)
			expect(healthy.health).toBe(ProductHealth.HEALTHY)

			const frozen = service.computeProductMetrics(
				{ ...product, quantity: 400 },
				sales({ unitsSold: 60 }),
				30,
			)

			expect(frozen.daysOfStockRemaining).toBeGreaterThanOrEqual(
				ANALYTICS_THRESHOLDS.SLOW_MOVING_DAYS_OF_STOCK,
			)
			expect(frozen.health).toBe(ProductHealth.SLOW_MOVING)
		})

		it('reports NO_SALES when nothing moved in the period', () => {
			const metrics = service.computeProductMetrics(product, undefined, 30)

			expect(metrics.health).toBe(ProductHealth.NO_SALES)
		})
	})
})
