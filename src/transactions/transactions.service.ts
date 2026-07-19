import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TransactionStatus } from '../enums'
import { JwtPayload } from '../interfaces'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { CreateTransactionDto } from './dto/create-transaction.dto'
import { QueryTransactionDto } from './dto/query-transaction.dto'
import { UpdateTransactionDto } from './dto/update-transaction.dto'

const transactionInclude = {
  items: {
    include: {
      product: { select: { id: true, name: true, price: true } },
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  debtor: { select: { id: true, name: true, phone: true } },
  market: { select: { id: true, name: true, address: true } },
} as const

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTransactionDto, user: JwtPayload) {
    const marketId = user.marketId
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')

    const productIds = dto.items.map((i) => i.productId)
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    })
    const productMap = new Map(products.map((p) => [p.id, p.name]))

    const itemsTotal = dto.items.reduce((sum, item) => sum + item.quantity * item.price, 0)

    return this.prisma.transaction.create({
      data: {
        marketId,
        createdById: user.sub,
        debtorId: dto.debtorId,
        type: dto.type,
        paymentType: dto.paymentType,
        totalAmount: itemsTotal,
        status: TransactionStatus.ACTIVE,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            productName: productMap.get(item.productId) ?? item.productId,
            quantity: item.quantity,
            price: item.price,
            totalPrice: item.quantity * item.price,
          })),
        },
      },
      include: transactionInclude,
    })
  }

  async findAll(query: QueryTransactionDto, userMarketId?: string): Promise<PaginatedResult<unknown>> {
    const where: any = {}

    if (userMarketId) where.marketId = userMarketId
    if (query.debtorId) where.debtorId = query.debtorId
    if (query.type) where.type = query.type
    if (query.status) where.status = query.status
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {}
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom)
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo)
    }

    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: transactionInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
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
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: transactionInclude,
    })
    if (!transaction) throw new NotFoundException('Transaction not found')
    if (userMarketId && transaction.marketId !== userMarketId) {
      throw new NotFoundException('Transaction not found')
    }
    return transaction
  }

  async update(id: string, dto: UpdateTransactionDto, userMarketId?: string) {
    await this.findOne(id, userMarketId)
    return this.prisma.transaction.update({
      where: { id },
      data: dto,
      include: transactionInclude,
    })
  }

  async remove(id: string, userMarketId?: string) {
    await this.findOne(id, userMarketId)
    await this.prisma.transaction.delete({ where: { id } })
  }
}
