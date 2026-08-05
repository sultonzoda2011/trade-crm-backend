import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { CreateDebtorDto } from './dto/create-debtor.dto'
import { QueryDebtorDto } from './dto/query-debtor.dto'
import { UpdateDebtorDto } from './dto/update-debtor.dto'
import { TransactionStatus } from '../enums'

const ACTIVE_DEBT_STATUSES: TransactionStatus[] = [TransactionStatus.ACTIVE, TransactionStatus.PARTIAL]

const debtorInclude = {
  market: { select: { id: true, name: true, address: true } },
  _count: { select: { transactions: true } },
} as const

@Injectable()
export class DebtorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDebtorDto, marketId?: string) {
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')
    return this.prisma.debtor.create({ data: { ...dto, marketId }, include: debtorInclude })
  }

  async findAll(query: QueryDebtorDto, userMarketId?: string): Promise<PaginatedResult<unknown>> {
    const where: any = {}

    if (userMarketId) where.marketId = userMarketId
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ]
    }
    if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
    if (query.hasActiveDebts != null) {
      where.transactions = query.hasActiveDebts
        ? { some: { type: 'DEBT', status: { in: ACTIVE_DEBT_STATUSES } } }
        : { none: { type: 'DEBT', status: { in: ACTIVE_DEBT_STATUSES } } }
    }
    if (query.minDebtAmount != null || query.maxDebtAmount != null) {
      const having: any = {}
      if (query.minDebtAmount != null) having.remainingAmount = { _sum: { gte: query.minDebtAmount } }
      if (query.maxDebtAmount != null) {
        having.remainingAmount = { ...having.remainingAmount, _sum: { ...(having.remainingAmount?._sum ?? {}), lte: query.maxDebtAmount } }
      }

      const debtGroups = await this.prisma.transaction.groupBy({
        by: ['debtorId'],
        where: {
          debtorId: { not: null },
          type: 'DEBT',
          status: { in: ACTIVE_DEBT_STATUSES },
          ...(userMarketId ? { marketId: userMarketId } : {}),
        },
        _sum: { remainingAmount: true },
        having,
      })

      const debtorIds = debtGroups.map(g => g.debtorId).filter(Boolean) as string[]
      if (debtorIds.length === 0) {
        return { data: [], meta: { page: query.page ?? 1, limit: query.limit ?? 20, total: 0, totalPages: 0 } }
      }
      where.id = { in: debtorIds }
    }

    const result = await paginate(
      query,
      ({ skip, take }) =>
        this.prisma.debtor.findMany({
          where,
          include: debtorInclude,
          orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
            'createdAt',
            'name',
            'phone',
            'updatedAt'
          ]),
          skip,
          take,
        }),
      () => this.prisma.debtor.count({ where }),
    )

    const debtorIds = result.data.map(d => d.id)
    if (debtorIds.length > 0) {
      const debtAggs = await this.prisma.transaction.groupBy({
        by: ['debtorId'],
        where: {
          debtorId: { in: debtorIds },
          type: 'DEBT',
          status: { in: ACTIVE_DEBT_STATUSES },
        },
        _sum: { remainingAmount: true },
      })
      const debtMap = new Map(debtAggs.map(a => [a.debtorId, a._sum?.remainingAmount ?? 0]))
      result.data.forEach((d: any) => { d.totalDebtAmount = debtMap.get(d.id) ?? 0 })
    } else {
      result.data.forEach((d: any) => { d.totalDebtAmount = 0 })
    }

    return result
  }

  async findOne(id: string, userMarketId?: string) {
    const debtor = await this.prisma.debtor.findUnique({
      where: { id },
      include: debtorInclude,
    })
    if (!debtor) throw new NotFoundException('Debtor not found')
    if (userMarketId && debtor.marketId !== userMarketId) {
      throw new NotFoundException('Debtor not found')
    }
    return debtor
  }

  async update(id: string, dto: UpdateDebtorDto, userMarketId?: string) {
    await this.findOne(id, userMarketId)
    return this.prisma.debtor.update({ where: { id }, data: dto, include: debtorInclude })
  }

  async remove(id: string, userMarketId?: string) {
    await this.findOne(id, userMarketId)
    await this.prisma.debtor.delete({ where: { id } })
  }
}
