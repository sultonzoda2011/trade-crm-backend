import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QueryDashboardDto, DashboardPeriod } from './dto/query-dashboard.dto'

function buildPeriodDateRange(period: DashboardPeriod) {
	const now = new Date()
	const end = new Date(now)
	end.setHours(23, 59, 59, 999)

	switch (period) {
		case DashboardPeriod.TODAY: {
			const start = new Date(now)
			start.setHours(0, 0, 0, 0)
			return { gte: start, lte: end }
		}
		case DashboardPeriod.WEEK: {
			const monday = new Date(now)
			monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
			monday.setHours(0, 0, 0, 0)
			return { gte: monday, lte: end }
		}
		case DashboardPeriod.MONTH:
			return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: end }
		case DashboardPeriod.YEAR:
			return { gte: new Date(now.getFullYear(), 0, 1), lte: end }
	}
}

@Injectable()
export class DashboardService {
	constructor(private readonly prisma: PrismaService) {}

	async getDashboard(query: QueryDashboardDto, marketId?: string) {
		const marketFilter: { marketId?: string } = marketId ? { marketId } : {}

		const transactionWhere: Record<string, any> = { ...marketFilter }
		if (query.sellerId) transactionWhere.createdById = query.sellerId

		let dateFilter: { gte?: Date; lte?: Date } = {}
		if (query.period) {
			dateFilter = buildPeriodDateRange(query.period)
		} else if (query.dateFrom || query.dateTo) {
			if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom)
			if (query.dateTo) dateFilter.lte = new Date(query.dateTo)
		}

		const hasDateFilter = Object.keys(dateFilter).length > 0
		const dateWhere = hasDateFilter
			? { ...transactionWhere, createdAt: dateFilter }
			: transactionWhere

		const userWhere: { marketId?: string } = { ...marketFilter }
		const debtorWhere: Record<string, any> = { ...marketFilter }
		if (query.sellerId) {
			debtorWhere.transactions = { some: { createdById: query.sellerId } }
		}

		const todayStart = new Date()
		todayStart.setHours(0, 0, 0, 0)
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
			topDebtorGroups
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
				where: { ...dateWhere, type: 'SALE' }
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
				take: 5
			})
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
			topDebtors
		}
	}

	/**
	 * Отчёт по продавцам: сколько и на какую сумму продал каждый пользователь
	 * маркета за опциональный период. SALE и DEBT считаются отдельно, REFUND
	 * вычитается из суммы продаж того продавца, который совершил исходную SALE
	 * (а не того, кто оформил возврат).
	 */
	async getSellersReport(query: QueryDashboardDto, marketId?: string) {
		const where: any = marketId ? { marketId } : {}
		if (query.sellerId) where.createdById = query.sellerId

		let dateFilter: { gte?: Date; lte?: Date } = {}
		if (query.period) {
			dateFilter = buildPeriodDateRange(query.period)
		} else if (query.dateFrom || query.dateTo) {
			if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom)
			if (query.dateTo) dateFilter.lte = new Date(query.dateTo)
		}
		if (Object.keys(dateFilter).length) where.createdAt = dateFilter

		const [saleGroups, refundRows, debtGroups] = await Promise.all([
			this.prisma.transaction.groupBy({
				by: ['createdById'],
				where: { ...where, type: 'SALE' },
				_sum: { totalAmount: true },
				_count: { id: true }
			}),
			this.prisma.transaction.findMany({
				where: { ...where, type: 'REFUND' },
				select: {
					totalAmount: true,
					// Относим возврат к продавцу исходной продажи через refundOf.
					refundOf: { select: { createdById: true } }
				}
			}),
			this.prisma.transaction.groupBy({
				by: ['createdById'],
				where: { ...where, type: 'DEBT' },
				_sum: { totalAmount: true },
				_count: { id: true }
			})
		])

		const refundCounts = new Map<string, number>()
		const refundAmounts = new Map<string, number>()
		for (const row of refundRows) {
			const sellerId = row.refundOf?.createdById
			if (!sellerId) continue
			refundCounts.set(sellerId, (refundCounts.get(sellerId) ?? 0) + 1)
			refundAmounts.set(
				sellerId,
				(refundAmounts.get(sellerId) ?? 0) + row.totalAmount
			)
		}

		const sellerIds = [
			...new Set([
				...saleGroups.map(g => g.createdById),
				...refundAmounts.keys(),
				...refundRows.map(r => r.refundOf?.createdById),
				...debtGroups.map(g => g.createdById)
			])
		].filter(Boolean) as string[]

		const sellers = sellerIds.length
			? await this.prisma.user.findMany({
					where: { id: { in: sellerIds } },
					select: { id: true, name: true, email: true, image: true, role: true }
				})
			: []
		const sellerMap = new Map(sellers.map(s => [s.id, s]))

		const saleMap = new Map(saleGroups.map(g => [g.createdById, g]))
		const debtMap = new Map(debtGroups.map(g => [g.createdById, g]))

		return sellerIds.map(id => {
			const sale = saleMap.get(id)
			const debt = debtMap.get(id)
			const saleAmount = sale?._sum.totalAmount ?? 0
			const refundAmount = refundAmounts.get(id) ?? 0
			const refundCount = refundCounts.get(id) ?? 0

			return {
				seller: sellerMap.get(id) ?? null,
				salesCount: sale?._count.id ?? 0,
				salesAmount: saleAmount - refundAmount,
				refundsCount: refundCount,
				refundsAmount: refundAmount,
				debtsCount: debt?._count.id ?? 0,
				debtsAmount: debt?._sum.totalAmount ?? 0
			}
		})
	}
}
