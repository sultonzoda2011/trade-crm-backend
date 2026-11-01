import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { compare, hash } from 'bcrypt'
import { Express } from 'express'
import { StorageService } from '../common/services/storage.service'
import { round2 } from '../common/utils/period.util'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { marketScope } from '../markets/market-scope.util'
import { MarketsService } from '../markets/markets.service'
import { PrismaService } from '../prisma/prisma.service'
import { SellersService } from '../sellers/sellers.service'
import { QuerySellerCreditDto } from '../sellers/dto/query-seller-credit.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'

/** Сколько последних выплат показываем на экране «Мой заработок». */
const EARNINGS_CREDITS_PREVIEW = 5
/** Аватар хранится квадратом 512×512 — хватает для любого экрана. */
const AVATAR_SIZE = 512

const PROFILE_SELECT = {
	id: true,
	name: true,
	email: true,
	phone: true,
	image: true,
	role: true,
	marketId: true,
	createdAt: true,
	passwordChangedAt: true
} as const

export interface ProfileEarnings {
	/** Накопленная надбавка за всё время: earned − refunded − paidOut = balance. */
	balance: { earned: number; refunded: number; paidOut: number; balance: number }
	/** Текущий месяц (UTC, как и вся аналитика): число продаж и чистая надбавка. */
	month: { since: string; salesCount: number; earned: number }
	/** Последние выплаты. */
	credits: unknown[]
}

@Injectable()
export class ProfileService {
	private readonly logger = new Logger(ProfileService.name)

	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService,
		private readonly marketsService: MarketsService,
		private readonly sellersService: SellersService,
		private readonly config: ConfigService
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
	 * Экран профиля одним запросом: сам человек, его рынок и — только для
	 * продавца — заработок. Продажи/товары/должники сюда не входят: это «моя
	 * работа», она живёт в своих разделах.
	 */
	async getFullProfile(user: JwtPayload) {
		const [profile, market, earnings] = await Promise.all([
			this.getProfile(user.sub),
			user.marketId
				? this.marketsService.findOne(user.marketId, marketScope(user), { hideEmails: user.role === Role.SELLER })
				: Promise.resolve(null),
			user.role === Role.SELLER && user.marketId ? this.getEarnings(user) : Promise.resolve(null)
		])
		return { profile, market, earnings }
	}

	/** Заработок продавца (надбавки): баланс, месяц, последние выплаты. */
	async getEarnings(user: JwtPayload): Promise<ProfileEarnings> {
		if (user.role !== Role.SELLER) throw new NotFoundException('Earnings are available for sellers only')

		const now = new Date()
		const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

		const [balance, credits, salesCount, earnedAgg, refundedAgg] = await Promise.all([
			this.sellersService.getBalance(user.sub, user.marketId),
			this.sellersService.listCredits(
				user.sub,
				{ page: 1, limit: EARNINGS_CREDITS_PREVIEW } as QuerySellerCreditDto,
				user.marketId
			),
			this.prisma.transaction.count({
				where: { createdById: user.sub, type: { in: ['SALE', 'DEBT'] }, createdAt: { gte: monthStart } }
			}),
			this.prisma.transactionItem.aggregate({
				where: {
					markup: { gt: 0 },
					transaction: { createdById: user.sub, type: { in: ['SALE', 'DEBT'] }, createdAt: { gte: monthStart } }
				},
				_sum: { markup: true }
			}),
			this.prisma.transactionItem.aggregate({
				where: {
					markup: { gt: 0 },
					transaction: { type: 'REFUND', createdAt: { gte: monthStart } },
					refundOfItem: { transaction: { createdById: user.sub } }
				},
				_sum: { markup: true }
			})
		])

		return {
			balance: {
				earned: balance.earned,
				refunded: balance.refunded,
				paidOut: balance.paidOut,
				balance: balance.balance
			},
			month: {
				since: monthStart.toISOString(),
				salesCount,
				earned: round2((earnedAgg._sum.markup ?? 0) - (refundedAgg._sum.markup ?? 0))
			},
			credits: credits.data
		}
	}

	async updateProfile(userId: string, dto: UpdateProfileDto, file?: Express.Multer.File) {
		const user = await this.prisma.user.findUnique({ where: { id: userId } })
		if (!user) throw new NotFoundException('User not found')

		const data: Prisma.UserUpdateInput = {}
		if (dto.name !== undefined) data.name = dto.name
		if (dto.phone !== undefined) data.phone = dto.phone === '' ? null : dto.phone

		if (dto.email !== undefined && dto.email !== user.email.toLowerCase()) {
			if (!dto.currentPassword) {
				throw new BadRequestException({
					message: 'Current password is required to change the email',
					code: 'CURRENT_PASSWORD_REQUIRED'
				})
			}
			if (!(await compare(dto.currentPassword, user.password))) {
				throw new BadRequestException({
					message: 'Current password is incorrect',
					code: 'CURRENT_PASSWORD_INCORRECT'
				})
			}
			const taken = await this.prisma.user.findFirst({
				where: { id: { not: userId }, email: { equals: dto.email, mode: 'insensitive' } },
				select: { id: true }
			})
			if (taken) {
				throw new ConflictException({ message: 'Email already in use', code: 'EMAIL_IN_USE' })
			}
			data.email = dto.email
		}

		// Сначала грузим новое фото, потом пишем в базу, и только потом удаляем
		// старое: если что-то упадёт посередине, человек не останется без аватара.
		let uploaded: string | undefined
		if (file) {
			uploaded = await this.storageService.save(file, 'users', { square: AVATAR_SIZE })
			data.image = uploaded
		}

		let updated
		try {
			updated = await this.prisma.user.update({ where: { id: userId }, data, select: PROFILE_SELECT })
		} catch (error) {
			if (uploaded) await this.deleteImageQuietly(uploaded)
			throw error
		}

		if (uploaded && user.image) await this.deleteImageQuietly(user.image)
		return updated
	}

	async removeImage(userId: string) {
		const user = await this.prisma.user.findUnique({ where: { id: userId } })
		if (!user) throw new NotFoundException('User not found')
		if (!user.image) return this.getProfile(userId)

		const updated = await this.prisma.user.update({
			where: { id: userId },
			data: { image: null },
			select: PROFILE_SELECT
		})
		await this.deleteImageQuietly(user.image)
		return updated
	}

	/**
	 * Смена пароля. Ошибки отдаём с машинным `code`, чтобы фронт показал текст
	 * под нужным полем. Статус именно 400, а не 401: на 401 клиент разлогинивает.
	 */
	async changePassword(userId: string, dto: ChangePasswordDto) {
		const user = await this.prisma.user.findUnique({ where: { id: userId } })
		if (!user) throw new NotFoundException('User not found')

		if (dto.newPassword !== dto.confirmPassword) {
			throw new BadRequestException({
				message: 'New password and confirm password do not match',
				code: 'PASSWORD_MISMATCH'
			})
		}
		if (!(await compare(dto.currentPassword, user.password))) {
			throw new BadRequestException({
				message: 'Current password is incorrect',
				code: 'CURRENT_PASSWORD_INCORRECT'
			})
		}
		if (dto.newPassword === dto.currentPassword) {
			throw new BadRequestException({
				message: 'New password must differ from the current one',
				code: 'PASSWORD_SAME_AS_CURRENT'
			})
		}

		const rounds = this.config.get<number>('BCRYPT_ROUNDS') ?? 12
		const passwordChangedAt = new Date()
		await this.prisma.user.update({
			where: { id: userId },
			data: { password: await hash(dto.newPassword, rounds), passwordChangedAt }
		})
		return { passwordChangedAt }
	}

	private async deleteImageQuietly(url: string) {
		try {
			await this.storageService.delete(url)
		} catch (error) {
			this.logger.warn(`Could not delete old avatar: ${(error as Error).message}`)
		}
	}
}
