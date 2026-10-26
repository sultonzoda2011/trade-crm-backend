import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AnalyticsPeriod } from '../common/dto/period-query.dto'
import { buildComparison, resolvePeriod, round2 } from '../common/utils/period.util'
import { PrismaService } from '../prisma/prisma.service'
import { DashboardPeriod, QueryDashboardDto } from './dto/query-dashboard.dto'

export interface SellerTotals {
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

function toAnalyticsPeriod(
	period: DashboardPeriod | undefined
): AnalyticsPeriod | undefined {
	return period as unknown as AnalyticsPeriod | undefined
}

@Injectable()
export class DashboardSellersService {
	constructor(private readonly prisma: PrismaService) {}

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
}
