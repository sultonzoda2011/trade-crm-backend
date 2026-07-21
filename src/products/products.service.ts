import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { CreateProductDto } from './dto/create-product.dto'
import { QueryProductDto } from './dto/query-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { Express } from 'express'

const productInclude = {
  market: { select: { id: true, name: true, address: true,image:true } },
  _count: { select: { transactionItems: true } },
} as const

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async create(dto: CreateProductDto, file: Express.Multer.File, marketId?: string) {
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')
    const image = file ? this.storageService.save(file, 'products') : undefined
    return this.prisma.product.create({ data: { ...dto, image, marketId }, include: productInclude })
  }

  async findAll(query: QueryProductDto, userMarketId?: string): Promise<PaginatedResult<unknown>> {
    const where: any = {}

    if (userMarketId) where.marketId = userMarketId
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' }
    }

    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
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
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    })
    if (!product) throw new NotFoundException('Product not found')
    if (userMarketId && product.marketId !== userMarketId) {
      throw new NotFoundException('Product not found')
    }
    return product
  }

  async update(id: string, dto: UpdateProductDto, file: Express.Multer.File, userMarketId?: string) {
    const product = await this.findOne(id, userMarketId)

    const data: any = { ...dto }

    if (file) {
      if (product.image) {
        this.storageService.delete(product.image)
      }
      data.image = this.storageService.save(file, 'products')
    }

    return this.prisma.product.update({ where: { id }, data, include: productInclude })
  }

  async remove(id: string, userMarketId?: string) {
    const product = await this.findOne(id, userMarketId)

    if (product.image) {
      this.storageService.delete(product.image)
    }

    await this.prisma.product.delete({ where: { id } })
  }
}
