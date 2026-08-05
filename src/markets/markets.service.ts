import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import {
	buildDateWhere,
	buildOrderBy,
	paginate
} from '../common/utils/paginate.util'
import { CreateMarketDto } from './dto/create-market.dto'
import { QueryMarketDto } from './dto/query-market.dto'
import { UpdateMarketDto } from './dto/update-market.dto'
import { Express } from 'express'

const marketInclude = {
	users: {
		select: { id: true, name: true, image: true, email: true, role: true }
	},
	_count: { select: { products: true, debtors: true, transactions: true } }
} as const

const ownerSelect = {
	id: true,
	name: true,
	image: true,
	email: true,
	role: true
} as const

@Injectable()
export class MarketsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService
	) {}

	private async getScopedMarket(id: string, ownerMarketId?: string) {
		const market = await this.prisma.market.findUnique({
			where: { id },
			include: marketInclude
		})
		if (!market) throw new NotFoundException('Market not found')
		// OWNER может управлять только своим маркетом; чужие id трактуем как
		// «не найдено», чтобы не раскрывать существование записей (IDOR).
		if (ownerMarketId && market.id !== ownerMarketId) {
			throw new NotFoundException('Market not found')
		}
		return market
	}

	private async enrichMarket(market: any) {
		const owner = await this.prisma.user.findUnique({
			where: { id: market.ownerId },
			select: ownerSelect
		})
		const { _count, ...rest } = market
		return { ...rest, count: _count, owner }
	}

	private async enrichManyMarkets(markets: any[]) {
		const ownerIds = [...new Set(markets.map(m => m.ownerId))]
		const owners = await this.prisma.user.findMany({
			where: { id: { in: ownerIds } },
			select: ownerSelect
		})
		const ownerMap = new Map(owners.map(o => [o.id, o]))
		return markets.map(m => {
			const { _count, ...rest } = m
			return { ...rest, count: _count, owner: ownerMap.get(m.ownerId) ?? null }
		})
	}

	async create(
		dto: CreateMarketDto,
		file: Express.Multer.File,
		ownerId?: string
	) {
		const resolvedOwnerId = dto.ownerId ?? ownerId
		if (!resolvedOwnerId) throw new NotFoundException('Owner ID is required')

		const image = file
			? await this.storageService.save(file, 'markets')
			: undefined

		const market = await this.prisma.$transaction(async tx => {
			const created = await tx.market.create({
				data: { ...dto, image, ownerId: resolvedOwnerId },
				include: marketInclude
			})

			await tx.user.update({
				where: { id: resolvedOwnerId },
				data: { marketId: created.id }
			})

			return created
		})

		return this.enrichMarket(market)
	}

	async findAll(
		query: QueryMarketDto,
		ownerMarketId?: string
	): Promise<PaginatedResult<unknown>> {
		const where: any = {}

		// OWNER видит только свой маркет — это блокирует IDOR на чтение чужих данных.
		if (ownerMarketId) where.id = ownerMarketId
		if (query.ownerId) where.ownerId = query.ownerId
		if (query.search) {
			where.OR = [
				{ name: { contains: query.search, mode: 'insensitive' } },
				{ address: { contains: query.search, mode: 'insensitive' } }
			]
		}
		if (query.dateFrom || query.dateTo)
			where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
		if (query.hasUsers != null) {
			where.users = query.hasUsers ? { some: {} } : { none: {} }
		}
		if (query.hasProducts != null) {
			where.products = query.hasProducts ? { some: {} } : { none: {} }
		}

		return paginate(
			query,
			async ({ skip, take }) => {
				const data = await this.prisma.market.findMany({
					where,
					include: marketInclude,
					orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
						'createdAt',
						'name',
						'address',
						'updatedAt'
					]),
					skip,
					take
				})
				return this.enrichManyMarkets(data)
			},
			() => this.prisma.market.count({ where })
		)
	}

	async findOne(id: string, ownerMarketId?: string) {
		const market = await this.prisma.market.findUnique({
			where: { id },
			include: marketInclude
		})
		if (!market) throw new NotFoundException('Market not found')
		if (ownerMarketId && market.id !== ownerMarketId) {
			throw new NotFoundException('Market not found')
		}
		return this.enrichMarket(market)
	}

	async update(
		id: string,
		dto: UpdateMarketDto,
		file: Express.Multer.File,
		ownerMarketId?: string
	) {
		const existing = await this.getScopedMarket(id, ownerMarketId)

		const data: any = { ...dto }

		if (file) {
			if (existing.image) {
				await this.storageService.delete(existing.image)
			}
			data.image = await this.storageService.save(file, 'markets')
		}

		const updated = await this.prisma.$transaction(async tx => {
			if (dto.ownerId && dto.ownerId !== existing.ownerId) {
				await tx.user.update({
					where: { id: existing.ownerId },
					data: { marketId: null }
				})
				await tx.user.update({
					where: { id: dto.ownerId },
					data: { marketId: id }
				})
			}

			return tx.market.update({
				where: { id },
				data,
				include: marketInclude
			})
		})

		return this.enrichMarket(updated)
	}

	async remove(id: string, ownerMarketId?: string) {
		const market = await this.getScopedMarket(id, ownerMarketId)

		if (market.image) {
			await this.storageService.delete(market.image)
		}

		await this.prisma.$transaction(async tx => {
			await tx.user.update({
				where: { id: market.ownerId },
				data: { marketId: null }
			})
			await tx.market.delete({ where: { id } })
		})
	}
}
