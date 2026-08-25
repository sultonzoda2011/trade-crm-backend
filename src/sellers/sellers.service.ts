import { ConfigService } from '@nestjs/config'
import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { hash } from 'bcrypt'
import { Prisma } from '@prisma/client'
import { Express } from 'express'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../common/services/storage.service'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { round2 } from '../common/utils/period.util'
import { JwtPayload } from '../interfaces'
import { CreateSellerDto } from './dto/create-seller.dto'
import { QuerySellerDto } from './dto/query-seller.dto'
import { UpdateSellerDto } from './dto/update-seller.dto'
import { CreateSellerCreditDto } from './dto/create-seller-credit.dto'
import { QuerySellerCreditDto } from './dto/query-seller-credit.dto'

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
		private readonly configService: ConfigService
	) {}

	async create(dto: CreateSellerDto, file?: Express.Multer.File, marketId?: string) {
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		const existing = await this.prisma.user.findUnique({
			where: { email: dto.email }
		})
		if (existing) throw new ConflictException('Email already in use')

		const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') ?? 12
		const hashedPassword = await hash(dto.password, bcryptRounds)
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
		const where: Prisma.UserWhereInput = { role: 'SELLER' }
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
		const where: Prisma.UserWhereInput = { id, role: 'SELLER' }
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
		if (dto.password) {
			const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') ?? 12
			data.password = await hash(dto.password, bcryptRounds)
		}

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

	/**
	 * Баланс продавца по надбавкам (markup): сколько он накопил сверх цены
	 * по своим SALE/DEBT-транзакциям, минус markup, откатившийся возвратами
	 * тех же строк, минус то, что ему уже выдано (SellerCredit).
	 * Считается двумя отдельными запросами (earned/refunded), а не одним
	 * агрегатом — потому что "refunded" ищется по цепочке
	 * refundOfItem -> исходная транзакция -> createdById, а не напрямую
	 * по продавцу REFUND-транзакции (возврат обычно оформляет OWNER/ADMIN).
	 */
	async getBalance(id: string, marketId?: string): Promise<{
		sellerId: string
		earned: number
		refunded: number
		paidOut: number
		balance: number
	}> {
		await this.findOne(id, marketId)

		const earnedItems = await this.prisma.transactionItem.findMany({
			where: {
				markup: { gt: 0 },
				transaction: { createdById: id, type: { in: ['SALE', 'DEBT'] } }
			},
			select: { markup: true }
		})
		const earned = earnedItems.reduce((sum, i) => sum + i.markup, 0)

		const refundedItems = await this.prisma.transactionItem.findMany({
			where: {
				markup: { gt: 0 },
				transaction: { type: 'REFUND' },
				refundOfItem: { transaction: { createdById: id } }
			},
			select: { markup: true }
		})
		const refunded = refundedItems.reduce((sum, i) => sum + i.markup, 0)

		const creditsAgg = await this.prisma.sellerCredit.aggregate({
			where: { sellerId: id },
			_sum: { amount: true }
		})
		const paidOut = creditsAgg._sum.amount ?? 0

		return {
			sellerId: id,
			earned: round2(earned),
			refunded: round2(refunded),
			paidOut: round2(paidOut),
			balance: round2(earned - refunded - paidOut)
		}
	}

	/**
	 * Выдать продавцу часть или весь накопленный баланс. Доступно только
	 * OWNER/ADMIN (контроллер ограничивает роли). Сумма не может превышать
	 * текущий баланс — иначе можно было бы "уйти в минус".
	 */
	async createCredit(id: string, dto: CreateSellerCreditDto, user: JwtPayload, marketId?: string) {
		await this.findOne(id, marketId)

		const { balance } = await this.getBalance(id, marketId)
		if (dto.amount > balance) {
			throw new BadRequestException(
				`Payout amount (${dto.amount}) exceeds seller's current balance (${balance})`
			)
		}

		return this.prisma.sellerCredit.create({
			data: {
				sellerId: id,
				amount: dto.amount,
				note: dto.note,
				createdById: user.sub
			},
			include: { createdBy: { select: { id: true, name: true } } }
		})
	}

	async listCredits(
		id: string,
		query: QuerySellerCreditDto,
		marketId?: string
	): Promise<PaginatedResult<unknown>> {
		await this.findOne(id, marketId)

		const where: Prisma.SellerCreditWhereInput = { sellerId: id }
		if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)

		return paginate(query, ({ skip, take }) =>
			this.prisma.sellerCredit.findMany({
				where,
				include: { createdBy: { select: { id: true, name: true } } },
				orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
					'createdAt',
					'amount'
				]),
				skip,
				take
			}),
			() => this.prisma.sellerCredit.count({ where })
		)
	}
}
