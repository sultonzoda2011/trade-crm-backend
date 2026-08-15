import { DashboardService } from './dashboard.service'
import { DashboardPeriod } from './dto/query-dashboard.dto'

describe('DashboardService', () => {
	let service: DashboardService
	let prisma: any
	let metrics: any
	let insights: any
	let analytics: any

	const now = new Date('2026-08-06T12:00:00Z')

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(now)

	prisma = {
		market: { count: jest.fn().mockResolvedValue(2) },
		user: { count: jest.fn().mockResolvedValue(5) },
		debtor: { count: jest.fn().mockResolvedValue(4) },
		product: { findMany: jest.fn().mockResolvedValue([]) },
		transaction: {
			count: jest.fn().mockResolvedValue(10),
			aggregate: jest.fn().mockResolvedValue({ _sum: { remainingAmount: 100, totalAmount: 200 } }),
			findMany: jest.fn().mockResolvedValue([]),
			groupBy: jest
				.fn()
				.mockImplementation((args: any) =>
					Promise.resolve(args.by[0] === 'paymentType' ? [] : [])
				)
		},
		$queryRaw: jest.fn().mockResolvedValue([])
	}

		// Тесты ниже покрывают только legacy-путь getDashboard, который ходит
		// напрямую в prisma. Остальные зависимости — заглушки.
		metrics = {
			getSalesMetrics: jest.fn(),
			getDebtMetrics: jest.fn(),
			getProductLeaders: jest.fn().mockResolvedValue([]),
			getTopReturnedProducts: jest.fn().mockResolvedValue([]),
			getCategoryRevenue: jest.fn().mockResolvedValue([]),
			getRevenueTrend: jest.fn().mockResolvedValue([])
		}
		insights = { build: jest.fn().mockReturnValue([]) }
		analytics = {
			getProductSalesRows: jest.fn().mockResolvedValue(new Map()),
			computeProductMetrics: jest.fn()
		}

		service = new DashboardService(prisma, metrics, insights, analytics)
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	describe('getDashboard', () => {
		it('returns stats, empty revenueTrend and empty paymentDistribution when no data', async () => {
			const result = await service.getDashboard({}, 'market-1')

			expect(result.stats.totalMarkets).toBe(2)
			expect(result.revenueTrend).toEqual([])
			expect(result.paymentDistribution).toEqual([])
		})

		it('builds paymentDistribution with count, amount and percentage share', async () => {
			prisma.transaction.groupBy.mockImplementation((args: any) =>
				Promise.resolve(
					args.by[0] === 'paymentType'
						? [
								{ paymentType: 'CASH', _count: { _all: 3 }, _sum: { totalAmount: 1500 } },
								{ paymentType: 'CARD', _count: { _all: 1 }, _sum: { totalAmount: 500 } }
							]
						: []
				)
			)

			const result = await service.getDashboard({ period: DashboardPeriod.MONTH }, 'market-1')

			expect(result.paymentDistribution).toEqual([
				{ type: 'CASH', count: 3, amount: 1500, percentage: 75 },
				{ type: 'CARD', count: 1, amount: 500, percentage: 25 }
			])
			expect(result.topDebtors).toEqual([])
		})

		it('restricts paymentDistribution to non-refunded SALE transactions', async () => {
			await service.getDashboard({ period: DashboardPeriod.MONTH }, 'market-1')

			const groupByCall = prisma.transaction.groupBy.mock.calls
				.map((call: any[]) => call[0])
				.find((call: any) => call.by[0] === 'paymentType')
			expect(groupByCall.where.type).toBe('SALE')
			expect(groupByCall.where.status).toEqual({ not: 'REFUNDED' })
		})

		it('returns percentage 0 for a zero total amount', async () => {
			prisma.transaction.groupBy.mockImplementation((args: any) =>
				Promise.resolve(
					args.by[0] === 'paymentType'
						? [{ paymentType: 'CREDIT', _count: { _all: 2 }, _sum: { totalAmount: 0 } }]
						: []
				)
			)

			const result = await service.getDashboard({})

			expect(result.paymentDistribution[0].percentage).toBe(0)
		})

		it('maps revenue trend rows to YYYY-MM-DD and numeric counts', async () => {
			prisma.$queryRaw.mockResolvedValue([
				{ date: new Date('2026-08-01T00:00:00Z'), revenue: 1000, transactionCount: 3n }
			])

			const result = await service.getDashboard({ period: DashboardPeriod.WEEK }, 'market-1')

			expect(result.revenueTrend).toEqual([
				{ date: '2026-08-01', revenue: 1000, transactionCount: 3 }
			])
		})

		it('limits top debtors to 10 by remaining debt', async () => {
			await service.getDashboard({}, 'market-1')

			const groupByCall = prisma.transaction.groupBy.mock.calls
				.map((call: any[]) => call[0])
				.find((call: any) => call.by[0] === 'debtorId')
			expect(groupByCall.take).toBe(10)
			expect(groupByCall.type ?? groupByCall.where.type).toBe('DEBT')
		})

		it('propagates sellerId into paymentDistribution grouping', async () => {
			await service.getDashboard({ sellerId: 'seller-1' }, 'market-1')

			const groupByCall = prisma.transaction.groupBy.mock.calls
				.map((call: any[]) => call[0])
				.find((call: any) => call.by[0] === 'paymentType')
			expect(groupByCall.where.marketId).toBe('market-1')
			expect(groupByCall.where.createdById).toBe('seller-1')
		})

		it('groups revenue trend by month for the YEAR period', async () => {
			await service.getDashboard({ period: DashboardPeriod.YEAR }, 'market-1')

			const rawCall = prisma.$queryRaw.mock.calls[0]
			expect(rawCall[1]).toBe('month')
		})

		it('groups revenue trend by day for day/week/month periods', async () => {
			await service.getDashboard({ period: DashboardPeriod.MONTH }, 'market-1')

			const rawCall = prisma.$queryRaw.mock.calls[0]
			expect(rawCall[1]).toBe('day')
		})

		it('passes marketId and sellerId into revenue trend SQL conditions', async () => {
			await service.getDashboard({ sellerId: 'seller-1', dateFrom: '2026-08-01', dateTo: '2026-08-06' }, 'market-1')

			const rawCall = prisma.$queryRaw.mock.calls[0]
			const conditions = rawCall[2]
			expect(conditions.values).toContain('market-1')
			expect(conditions.values).toContain('seller-1')
			expect(conditions.values).toContainEqual(new Date('2026-08-01'))
			expect(conditions.values).toContainEqual(new Date('2026-08-06'))
		})
	})
})
