import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { hash } from 'bcrypt'
import { Express } from 'express'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { CreateSellerDto } from './dto/create-seller.dto'
import { QuerySellerDto } from './dto/query-seller.dto'
import { UpdateSellerDto } from './dto/update-seller.dto'

const sellerSelect = {
	id: true,
	name: true,
	email: true,
	image: true,
	role: true,
	createdAt: true,
	market: {
		select: { id: true, name: true, address: true, image: true }
	}
} as const

@Injectable()
export class SellersService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService,
	) {}

	async create(dto: CreateSellerDto, file?: Express.Multer.File, marketId?: string) {
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		const existing = await this.prisma.user.findUnique({
			where: { email: dto.email }
		})
		if (existing) throw new ConflictException('Email already in use')

		const hashedPassword = await hash(dto.password, 10)
		const image = file ? await this.storageService.save(file, 'sellers') : undefined

		return this.prisma.user.create({
			data: {
				name: dto.name,
				email: dto.email,
				password: hashedPassword,
				image,
				role: 'SELLER',
				marketId
			},
			select: sellerSelect
		})
	}

	async findAll(
		query: QuerySellerDto,
		marketId?: string
	): Promise<PaginatedResult<unknown>> {
		const where: any = { role: 'SELLER' }
		if (marketId) where.marketId = marketId

		if (query.search) {
			where.OR = [
				{ name: { contains: query.search, mode: 'insensitive' } },
				{ email: { contains: query.search, mode: 'insensitive' } }
			]
		}
		if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)

		return paginate(query, ({ skip, take }) =>
			this.prisma.user.findMany({
				where,
				select: sellerSelect,
				orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
					'createdAt',
					'name',
					'email',
					'updatedAt'
				]),
				skip,
				take
			}),
			() => this.prisma.user.count({ where })
		)
	}

	async findOne(id: string, marketId?: string) {
		const where: any = { id, role: 'SELLER' }
		if (marketId) where.marketId = marketId

		const seller = await this.prisma.user.findFirst({
			where,
			select: sellerSelect
		})
		if (!seller) throw new NotFoundException('Seller not found')
		return seller
	}

	async update(id: string, dto: UpdateSellerDto, file?: Express.Multer.File, marketId?: string) {
		const seller = await this.findOne(id, marketId)

		if (dto.email) {
			const existing = await this.prisma.user.findUnique({
				where: { email: dto.email }
			})
			if (existing && existing.id !== id)
				throw new ConflictException('Email already in use')
		}

		const data: any = { ...dto }
		if (dto.password) data.password = await hash(dto.password, 10)

		if (file) {
			if (seller.image) {
				await this.storageService.delete(seller.image)
			}
			data.image = await this.storageService.save(file, 'sellers')
		}

		return this.prisma.user.update({
			where: { id },
			data,
			select: sellerSelect
		})
	}

	async remove(id: string, marketId?: string) {
		const seller = await this.findOne(id, marketId)

		if (seller.image) {
			await this.storageService.delete(seller.image)
		}

		await this.prisma.user.delete({ where: { id } })
	}
}
