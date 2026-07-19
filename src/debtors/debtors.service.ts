import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { CreateDebtorDto } from './dto/create-debtor.dto'
import { QueryDebtorDto } from './dto/query-debtor.dto'
import { UpdateDebtorDto } from './dto/update-debtor.dto'

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

    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.debtor.findMany({
        where,
        include: debtorInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.debtor.count({ where }),
    ])

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
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
