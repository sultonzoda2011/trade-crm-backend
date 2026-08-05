import {
	ConflictException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { hash } from 'bcrypt'
import { Express } from 'express'
import { Role } from '../enums'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { CreateUserDto } from './dto/create-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

@Injectable()
export class UsersService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService,
	) {}

	private userSelect = {
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

	async create(dto: CreateUserDto, file?: Express.Multer.File) {
		const existing = await this.prisma.user.findUnique({
			where: { email: dto.email }
		})
		if (existing) throw new ConflictException('Email already in use')

		const hashed = await hash(dto.password, 10)
		const image = file ? await this.storageService.save(file, 'users') : undefined

		return this.prisma.user.create({
			data: {
				name: dto.name,
				email: dto.email,
				password: hashed,
				image,
				role: dto.role
			},
			select: this.userSelect
		})
	}

	async findAll(query: QueryUserDto): Promise<PaginatedResult<unknown>> {
		const where: any = {}

		if (query.role) where.role = query.role
		if (query.marketId) where.marketId = query.marketId
		if (query.search) {
			where.OR = [
				{ name: { contains: query.search, mode: 'insensitive' } },
				{ email: { contains: query.search, mode: 'insensitive' } }
			]
		}
		if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
		if (query.isOwner != null) {
			where.ownedMarkets = query.isOwner ? { some: {} } : { none: {} }
		}

		return paginate(query, ({ skip, take }) =>
			this.prisma.user.findMany({
				where,
				select: this.userSelect,
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

	async findOne(id: string) {
		const user = await this.prisma.user.findUnique({
			where: { id },
			select: this.userSelect
		})
		if (!user) throw new NotFoundException('User not found')
		return user
	}

	async update(id: string, dto: UpdateUserDto, file?: Express.Multer.File) {
		const user = await this.findOne(id)

		// Нельзя снять последний админский аккаунт — иначе система останется
		// без управления.
		if (dto.role && user.role === Role.ADMIN && dto.role !== Role.ADMIN) {
			await this.ensureNotLastAdmin(id)
		}

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
			if (user.image) {
				await this.storageService.delete(user.image)
			}
			data.image = await this.storageService.save(file, 'users')
		}

		return this.prisma.user.update({
			where: { id },
			data,
			select: this.userSelect
		})
	}

	async remove(id: string) {
		const user = await this.findOne(id)
		if (user.role === Role.ADMIN) {
			await this.ensureNotLastAdmin(id)
		}
		if (user.image) {
			await this.storageService.delete(user.image)
		}
		await this.prisma.user.delete({ where: { id } })
	}

	private async ensureNotLastAdmin(userId: string): Promise<void> {
		const adminCount = await this.prisma.user.count({
			where: { role: Role.ADMIN }
		})
		if (adminCount <= 1) {
			throw new ConflictException(
				'Cannot remove or demote the last admin account'
			)
		}
	}
}
