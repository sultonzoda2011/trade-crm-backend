import {
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import {
	buildDateWhere,
	buildOrderBy,
	paginate
} from '../common/utils/paginate.util'
import { CreateProductDto } from './dto/create-product.dto'
import { QueryProductDto } from './dto/query-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { Express } from 'express'

const productInclude = {
	market: { select: { id: true, name: true, address: true, image: true } },
	category: { select: { id: true, name: true, image: true } },
	_count: { select: { transactionItems: true } }
} as const

@Injectable()
export class ProductsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService
	) {}

	async create(
		dto: CreateProductDto,
		file: Express.Multer.File,
		marketId?: string
	) {
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')
		const image = file
			? await this.storageService.save(file, 'products')
			: undefined
		return this.prisma.product.create({
			data: { ...dto, image, marketId },
			include: productInclude
		})
	}

	async findAll(
		query: QueryProductDto,
		userMarketId?: string
	): Promise<PaginatedResult<unknown>> {
		const where: any = {}

		if (userMarketId) where.marketId = userMarketId
		if (query.categoryId) where.categoryId = query.categoryId
		if (query.search) {
			where.name = { contains: query.search, mode: 'insensitive' }
		}
		if (query.dateFrom || query.dateTo)
			where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
		if (query.priceMin != null || query.priceMax != null) {
			where.price = {}
			if (query.priceMin != null) where.price.gte = query.priceMin
			if (query.priceMax != null) where.price.lte = query.priceMax
		}
		if (query.lowStock) {
			// Prisma не умеет сравнивать два поля одной модели в where напрямую,
			// поэтому для флага "мало на складе" фильтруем через $queryRaw-подобный
			// подход: сначала берём кандидатов, а сравнение quantity <= threshold
			// делаем в приложении. Для больших каталогов лучше вынести в raw SQL,
			// но для MVP объём данных это не оправдывает.
			const candidates = await this.prisma.product.findMany({
				where,
				include: productInclude,
				orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
					'createdAt',
					'name',
					'price',
					'quantity',
					'updatedAt'
				])
			})
			const lowStockItems = candidates.filter(
				p => p.quantity <= p.lowStockThreshold
			)
			const page = query.page ?? 1
			const limit = query.limit ?? 20
			const start = (page - 1) * limit
			return {
				data: lowStockItems.slice(start, start + limit),
				meta: {
					page,
					limit,
					total: lowStockItems.length,
					totalPages: Math.ceil(lowStockItems.length / limit)
				}
			}
		}

		return paginate(
			query,
			({ skip, take }) =>
				this.prisma.product.findMany({
					where,
					include: productInclude,
					orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
						'createdAt',
						'name',
						'price',
						'quantity',
						'updatedAt'
					]),
					skip,
					take
				}),
			() => this.prisma.product.count({ where })
		)
	}

	async findOne(id: string, userMarketId?: string) {
		const product = await this.prisma.product.findUnique({
			where: { id },
			include: productInclude
		})
		if (!product) throw new NotFoundException('Product not found')
		if (userMarketId && product.marketId !== userMarketId) {
			throw new NotFoundException('Product not found')
		}
		return product
	}

	async update(
		id: string,
		dto: UpdateProductDto,
		file: Express.Multer.File,
		userMarketId?: string
	) {
		const product = await this.findOne(id, userMarketId)

		const data: any = { ...dto }

		if (file) {
			if (product.image) {
				await this.storageService.delete(product.image)
			}
			data.image = await this.storageService.save(file, 'products')
		}

		return this.prisma.product.update({
			where: { id },
			data,
			include: productInclude
		})
	}

	async remove(id: string, userMarketId?: string) {
		const product = await this.findOne(id, userMarketId)

		if (product.image) {
			await this.storageService.delete(product.image)
		}

		await this.prisma.product.delete({ where: { id } })
	}
}
