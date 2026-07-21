import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { hash } from 'bcrypt'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { PrismaService } from '../prisma/prisma.service'
import { CreateSellerDto } from './dto/create-seller.dto'
import { QuerySellerDto } from './dto/query-seller.dto'
import { UpdateSellerDto } from './dto/update-seller.dto'

const sellerSelect = {
	id: true,
	name: true,
	email: true,
	role: true,
	createdAt: true,
	market: {
		select: { id: true, name: true, address: true }
	}
} as const

@Injectable()
export class SellersService {
	constructor(private readonly prisma: PrismaService) {}

	async create(dto: CreateSellerDto, marketId?: string) {
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		const existing = await this.prisma.user.findUnique({
			where: { email: dto.email }
		})
		if (existing) throw new ConflictException('Email already in use')

		const hashedPassword = await hash(dto.password, 10)

		return this.prisma.user.create({
			data: {
				name: dto.name,
				email: dto.email,
				password: hashedPassword,
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

		const page = query.page ?? 1
		const limit = query.limit ?? 20
		const skip = (page - 1) * limit

		const [data, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				select: sellerSelect,
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit
			}),
			this.prisma.user.count({ where })
		])

		return {
			data,
			meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
		}
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

	async update(id: string, dto: UpdateSellerDto, marketId?: string) {
		await this.findOne(id, marketId)

		if (dto.email) {
			const existing = await this.prisma.user.findUnique({
				where: { email: dto.email }
			})
			if (existing && existing.id !== id)
				throw new ConflictException('Email already in use')
		}

		const data: any = { ...dto }
		if (dto.password) data.password = await hash(dto.password, 10)

		return this.prisma.user.update({
			where: { id },
			data,
			select: sellerSelect
		})
	}

	async remove(id: string, marketId?: string) {
		await this.findOne(id, marketId)
		await this.prisma.user.delete({ where: { id } })
	}
}
