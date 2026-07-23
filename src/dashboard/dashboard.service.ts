import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

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
}
