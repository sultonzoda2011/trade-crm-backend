import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QueryDashboardDto } from './dto/query-dashboard.dto'

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(marketId?: string) {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0))

    const marketWhere = marketId ? { id: marketId } : {}
    const where = marketId ? { marketId } : {}
    const daysWhere = marketId ? { ...where, createdAt: { gte: todayStart } } : { createdAt: { gte: todayStart } }

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
    ] = await Promise.all([
      this.prisma.market.count({ where: marketWhere }),
      this.prisma.user.count({ where }),
      this.prisma.debtor.count({ where }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.count({ where: { ...where, type: 'DEBT', status: 'ACTIVE' } }),
      this.prisma.transaction.count({ where: { ...where, type: 'DEBT', status: 'PARTIAL' } }),
      this.prisma.transaction.aggregate({
        _sum: { remainingAmount: true },
        where: { ...where, type: 'DEBT', status: { in: ['ACTIVE', 'PARTIAL'] } },
      }),
      this.prisma.transaction.aggregate({
        _sum: { totalAmount: true },
        where: { ...where, type: 'SALE' },
      }),
      this.prisma.transaction.count({ where: daysWhere }),
      this.prisma.transaction.findMany({
        where,
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          debtor: { select: { id: true, name: true } },
          market: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.transaction.groupBy({
        by: ['debtorId'],
        where: {
          ...where,
          debtorId: { not: null },
          type: 'DEBT',
          status: { in: ['ACTIVE', 'PARTIAL'] },
        },
        _sum: { remainingAmount: true },
        _count: { id: true },
        orderBy: { _sum: { remainingAmount: 'desc' } },
        take: 5,
      }),
    ])

    const debtorIds = topDebtorGroups.map((g) => g.debtorId).filter(Boolean) as string[]

    const debtors = debtorIds.length > 0
      ? await this.prisma.debtor.findMany({
          where: { id: { in: debtorIds } },
          include: { market: { select: { id: true, name: true } } },
        })
      : []

    const debtorMap = new Map(debtors.map((d) => [d.id, d]))

    const topDebtors = topDebtorGroups.map((g) => {
      const debtor = debtorMap.get(g.debtorId!)
      return {
        id: g.debtorId!,
        name: debtor?.name ?? 'Unknown',
        phone: debtor?.phone ?? '',
        market: debtor?.market ?? undefined,
        totalDebt: g._sum.remainingAmount ?? 0,
        activeTransactions: g._count.id,
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
        todayTransactions,
      },
      recentTransactions,
      topDebtors,
    }
  }

  /**
   * Отчёт по продавцам: сколько и на какую сумму продал каждый пользователь
   * маркета за опциональный период. SALE и DEBT считаются отдельно, REFUND
   * вычитается из суммы продаж того же продавца.
   */
  async getSellersReport(query: QueryDashboardDto, marketId?: string) {
    const dateFilter: any = {}
    if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom)
    if (query.dateTo) dateFilter.lte = new Date(query.dateTo)

    const where: any = {
      ...(marketId ? { marketId } : {}),
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    }

    const [saleGroups, refundGroups, debtGroups] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['createdById'],
        where: { ...where, type: 'SALE' },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['createdById'],
        where: { ...where, type: 'REFUND' },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['createdById'],
        where: { ...where, type: 'DEBT' },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ])

    const sellerIds = [
      ...new Set([
        ...saleGroups.map((g) => g.createdById),
        ...refundGroups.map((g) => g.createdById),
        ...debtGroups.map((g) => g.createdById),
      ]),
    ]

    const sellers = sellerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: sellerIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : []
    const sellerMap = new Map(sellers.map((s) => [s.id, s]))

    const saleMap = new Map(saleGroups.map((g) => [g.createdById, g]))
    const refundMap = new Map(refundGroups.map((g) => [g.createdById, g]))
    const debtMap = new Map(debtGroups.map((g) => [g.createdById, g]))

    return sellerIds.map((id) => {
      const sale = saleMap.get(id)
      const refund = refundMap.get(id)
      const debt = debtMap.get(id)
      const saleAmount = sale?._sum.totalAmount ?? 0
      const refundAmount = refund?._sum.totalAmount ?? 0

      return {
        seller: sellerMap.get(id) ?? null,
        salesCount: sale?._count.id ?? 0,
        salesAmount: saleAmount - refundAmount,
        refundsCount: refund?._count.id ?? 0,
        refundsAmount: refundAmount,
        debtsCount: debt?._count.id ?? 0,
        debtsAmount: debt?._sum.totalAmount ?? 0,
      }
    })
  }
}
