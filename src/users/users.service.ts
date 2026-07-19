import {
	ConflictException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { hash } from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { CreateUserDto } from './dto/create-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

@Injectable()
export class UsersService {
	constructor(private readonly prisma: PrismaService) {}

	private userSelect = {
		id: true,
		name: true,
		email: true,
		role: true,
		createdAt: true,
		market: {
			select: { id: true, name: true, address: true }
		}
	} as const

	async create(dto: CreateUserDto) {
		const existing = await this.prisma.user.findUnique({
			where: { email: dto.email }
		})
		if (existing) throw new ConflictException('Email already in use')

		const hashed = await hash(dto.password, 10)

		return this.prisma.user.create({
			data: {
				name: dto.name,
				email: dto.email,
				password: hashed,
				role: dto.role,
				marketId: dto.marketId
			},
			select: this.userSelect
		})
	}

	async findAll(query: QueryUserDto): Promise<PaginatedResult<unknown>> {
		const where: any = {}

		if (query.role) where.role = query.role
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
				select: this.userSelect,
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.user.count({ where }),
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

	async findOne(id: string) {
		const user = await this.prisma.user.findUnique({
			where: { id },
			select: this.userSelect
		})
		if (!user) throw new NotFoundException('User not found')
		return user
	}

	async update(id: string, dto: UpdateUserDto) {
		await this.findOne(id)

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
			select: this.userSelect
		})
	}

	async remove(id: string) {
		await this.findOne(id)
		await this.prisma.user.delete({ where: { id } })
	}
}
