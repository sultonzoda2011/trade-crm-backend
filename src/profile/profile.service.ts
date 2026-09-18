import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { compare, hash } from 'bcrypt'
import { Express } from 'express'
import { StorageService } from '../common/services/storage.service'
import { PrismaService } from '../prisma/prisma.service'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { MarketsService } from '../markets/markets.service'
import { TransactionsService } from '../transactions/transactions.service'
import { QueryTransactionDto } from '../transactions/dto/query-transaction.dto'
import { JwtPayload } from '../interfaces'
import { Role } from '../enums'

/** Превью транзакций на странице профиля. */
const PROFILE_TRANSACTIONS_PREVIEW_LIMIT = 5

const PROFILE_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
	role: true,
	marketId: true,
	createdAt: true
} as const

@Injectable()
export class ProfileService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService,
		private readonly marketsService: MarketsService,
		private readonly transactionsService: TransactionsService
	) {}

	async getProfile(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: PROFILE_SELECT
		})
		if (!user) throw new NotFoundException('User not found')
		return user
	}

	/**
	 * Профиль + маркет + превью транзакций — одним запросом.
	 *
	 * Товары/должники на этой странице намеренно НЕ включены: на фронте они
	 * грузятся только при реальном открытии соответствующей вкладки
	 * (`activeTab === 'products'/'debtors'`) — это уже правильно сделанная
	 * ленивая загрузка, тащить их сюда заранее было бы шагом назад.
	 */
	async getFullProfile(user: JwtPayload) {
		const [profile, market, transactions] = await Promise.all([
			this.getProfile(user.sub),
			user.marketId
				? this.marketsService.findOne(user.marketId, user.role === Role.OWNER ? user.marketId : undefined)
				: Promise.resolve(null),
			this.transactionsService.findAll(
				{ page: 1, limit: PROFILE_TRANSACTIONS_PREVIEW_LIMIT } as QueryTransactionDto,
				user.marketId
			)
		])
		return { profile, market, transactions }
	}

	async updateProfile(
		userId: string,
		dto: UpdateProfileDto,
		file?: Express.Multer.File
	) {
		const user = await this.prisma.user.findUnique({ where: { id: userId } })
		if (!user) throw new NotFoundException('User not found')

		if (dto.email && dto.email !== user.email) {
			const existing = await this.prisma.user.findUnique({
				where: { email: dto.email }
			})
			if (existing) throw new ConflictException('Email already in use')
		}

		const data: any = {}
		if (dto.name !== undefined) data.name = dto.name
		if (dto.email !== undefined) data.email = dto.email

		if (file) {
			if (user.image) {
				await this.storageService.delete(user.image)
			}
			data.image = await this.storageService.save(file, 'users')
		}

		return this.prisma.user.update({
			where: { id: userId },
			data,
			select: PROFILE_SELECT
		})
	}

	async changePassword(userId: string, dto: ChangePasswordDto) {
		const user = await this.prisma.user.findUnique({ where: { id: userId } })
		if (!user) throw new NotFoundException('User not found')

		if (dto.newPassword !== dto.confirmPassword) {
			throw new BadRequestException(
				'New password and confirm password do not match'
			)
		}

		const isCurrentPasswordValid = await compare(dto.currentPassword, user.password)
		if (!isCurrentPasswordValid) {
			throw new BadRequestException('Current password is incorrect')
		}

		await this.prisma.$transaction(async tx => {
			await tx.user.update({
				where: { id: userId },
				data: { password: await hash(dto.newPassword, 10) }
			})

	
		})
	}
}