import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { CreateMarketDto } from './dto/create-market.dto'
import { QueryMarketDto } from './dto/query-market.dto'
import { UpdateMarketDto } from './dto/update-market.dto'
import { Express } from 'express'

const marketInclude = {
  users: { select: { id: true, name: true, email: true, role: true } },
  _count: { select: { products: true, debtors: true, transactions: true } },
} as const

const ownerSelect = { id: true, name: true, email: true, role: true } as const

@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  private async enrichMarket(market: any) {
    const owner = await this.prisma.user.findUnique({
      where: { id: market.ownerId },
      select: ownerSelect,
    })
    const { _count, ...rest } = market
    return { ...rest, count: _count, owner }
  }

  private async enrichManyMarkets(markets: any[]) {
    const ownerIds = [...new Set(markets.map(m => m.ownerId))]
    const owners = await this.prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: ownerSelect,
    })
    const ownerMap = new Map(owners.map(o => [o.id, o]))
    return markets.map(m => {
      const { _count, ...rest } = m
      return { ...rest, count: _count, owner: ownerMap.get(m.ownerId) ?? null }
    })
  }

  async create(dto: CreateMarketDto, file: Express.Multer.File, ownerId?: string) {
    const resolvedOwnerId = dto.ownerId ?? ownerId
    if (!resolvedOwnerId) throw new NotFoundException('Owner ID is required')

    const image = file ? this.storageService.save(file, 'markets') : undefined

    const market = await this.prisma.market.create({
      data: { ...dto, image, ownerId: resolvedOwnerId },
      include: marketInclude,
    })

    await this.prisma.user.update({
      where: { id: resolvedOwnerId },
      data: { marketId: market.id },
    })

    return this.enrichMarket(market)
  }

  async findAll(query: QueryMarketDto): Promise<PaginatedResult<unknown>> {
    const where: any = {}

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { address: { contains: query.search, mode: 'insensitive' } },
      ]
    }

    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.market.findMany({
        where,
        include: marketInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.market.count({ where }),
    ])

    return {
      data: await this.enrichManyMarkets(data),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async findOne(id: string) {
    const market = await this.prisma.market.findUnique({
      where: { id },
      include: marketInclude,
    })
    if (!market) throw new NotFoundException('Market not found')
    return this.enrichMarket(market)
  }

  async update(id: string, dto: UpdateMarketDto, file: Express.Multer.File) {
    const existing = await this.prisma.market.findUnique({
      where: { id },
      include: marketInclude,
    })
    if (!existing) throw new NotFoundException('Market not found')

    const data: any = { ...dto }

    if (file) {
      if (existing.image) {
        this.storageService.delete(existing.image)
      }
      data.image = this.storageService.save(file, 'markets')
    }

    if (dto.ownerId && dto.ownerId !== existing.ownerId) {
      await this.prisma.user.update({
        where: { id: existing.ownerId },
        data: { marketId: null },
      })
      await this.prisma.user.update({
        where: { id: dto.ownerId },
        data: { marketId: id },
      })
    }

    const updated = await this.prisma.market.update({
      where: { id },
      data,
      include: marketInclude,
    })

    return this.enrichMarket(updated)
  }

  async remove(id: string) {
    const market = await this.prisma.market.findUnique({
      where: { id },
      include: marketInclude,
    })
    if (!market) throw new NotFoundException('Market not found')

    if (market.image) {
      this.storageService.delete(market.image)
    }

    await this.prisma.user.update({
      where: { id: market.ownerId },
      data: { marketId: null },
    })

    await this.prisma.market.delete({ where: { id } })
  }
}
