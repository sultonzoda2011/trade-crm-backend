import {
	BadRequestException,
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TransactionStatus, TransactionType } from '../enums'
import { JwtPayload } from '../interfaces'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { CreateTransactionDto } from './dto/create-transaction.dto'
import { CreatePaymentDto } from './dto/create-payment.dto'
import { QueryTransactionDto } from './dto/query-transaction.dto'
import { UpdateTransactionDto } from './dto/update-transaction.dto'

const transactionInclude = {
	items: {
		include: {
			product: { select: { id: true, name: true, price: true, image: true } }
		}
	},
	createdBy: { select: { id: true, name: true, email: true } },
	debtor: { select: { id: true, name: true, phone: true } },
	market: { select: { id: true, name: true, address: true, image: true } },
	payments: {
		include: {
			createdBy: { select: { id: true, name: true, email: true } }
		},
		orderBy: { createdAt: 'desc' }
	}
} as const

@Injectable()
export class TransactionsService {
	constructor(private readonly prisma: PrismaService) {}

	async create(dto: CreateTransactionDto, user: JwtPayload) {
		const marketId = user.marketId
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		const productIds = [...new Set(dto.items.map(i => i.productId))]

		return this.prisma.$transaction(async tx => {
			// Берём товары в рамках маркета пользователя, блокировкой строк через
			// обычный SELECT (Prisma не даёт FOR UPDATE напрямую) — конкурентные
			// продажи одного и того же товара обрабатываются через атомарный
			// decrement ниже с проверкой условия в WHERE.
			const products = await tx.product.findMany({
				where: { id: { in: productIds }, marketId }
			})

			if (products.length !== productIds.length) {
				throw new BadRequestException(
					'One or more products were not found in your market'
				)
			}

			const productMap = new Map(products.map(p => [p.id, p]))

			// Цена и totalPrice всегда считаются от актуальной цены товара в БД,
			// а не от того, что прислал клиент — иначе можно занизить сумму продажи.
			let itemsTotal = 0
			const itemsData = dto.items.map(item => {
				const product = productMap.get(item.productId)!
				const discount = item.discount ?? 0
				const lineTotal = item.quantity * product.price - discount
				if (lineTotal < 0) {
					throw new BadRequestException(
						`Discount exceeds line total for product "${product.name}"`
					)
				}
				itemsTotal += lineTotal
				return {
					productId: product.id,
					productName: product.name,
					quantity: item.quantity,
					price: product.price,
					discount,
					totalPrice: lineTotal
				}
			})

			const isDebt = dto.type === TransactionType.DEBT

			// Проверяем остаток и списываем сток атомарно: decrement только если
			// quantity >= списываемого количества, иначе запись не обновится и мы
			// узнаём об этом по count === 0 в результате updateMany.
			for (const item of dto.items) {
				const product = productMap.get(item.productId)!
				const result = await tx.product.updateMany({
					where: { id: product.id, quantity: { gte: item.quantity } },
					data: { quantity: { decrement: item.quantity } }
				})
				if (result.count === 0) {
					throw new BadRequestException(
						`Not enough stock for product "${product.name}"`
					)
				}
			}

			return tx.transaction.create({
				data: {
					marketId,
					createdById: user.sub,
					debtorId: dto.debtorId,
					type: dto.type,
					paymentType: dto.paymentType,
					totalAmount: itemsTotal,
					discountAmount: itemsData.reduce((s, i) => s + i.discount, 0),
					remainingAmount: isDebt ? itemsTotal : 0,
					status: isDebt ? TransactionStatus.ACTIVE : TransactionStatus.PAID,
					dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
					items: { create: itemsData }
				},
				include: transactionInclude
			})
		})
	}

	async findAll(
		query: QueryTransactionDto,
		userMarketId?: string
	): Promise<PaginatedResult<unknown>> {
		const where: any = {}

		if (userMarketId) where.marketId = userMarketId
		if (query.debtorId) where.debtorId = query.debtorId
		if (query.createdById) where.createdById = query.createdById
		if (query.type) where.type = query.type
		if (query.status) where.status = query.status
		if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
		if (query.search) {
			where.debtor = { name: { contains: query.search, mode: 'insensitive' } }
		}
		if (query.paymentType) where.paymentType = query.paymentType
		if (query.categoryId || query.productId) {
			where.items = {
				some: {
					...(query.productId ? { productId: query.productId } : {}),
					...(query.categoryId ? { product: { categoryId: query.categoryId } } : {})
				}
			}
		}
		if (query.minAmount != null || query.maxAmount != null) {
			where.totalAmount = {}
			if (query.minAmount != null) where.totalAmount.gte = query.minAmount
			if (query.maxAmount != null) where.totalAmount.lte = query.maxAmount
		}

		return paginate(
			query,
			({ skip, take }) =>
				this.prisma.transaction.findMany({
					where,
					include: transactionInclude,
					orderBy: buildOrderBy(query.sortBy, query.sortOrder),
					skip,
					take
				}),
			() => this.prisma.transaction.count({ where })
		)
	}

	async findOne(id: string, userMarketId?: string) {
		const transaction = await this.prisma.transaction.findUnique({
			where: { id },
			include: transactionInclude
		})
		if (!transaction) throw new NotFoundException('Transaction not found')
		if (userMarketId && transaction.marketId !== userMarketId) {
			throw new NotFoundException('Transaction not found')
		}
		return transaction
	}

	async update(id: string, dto: UpdateTransactionDto, userMarketId?: string) {
		await this.findOne(id, userMarketId)
		return this.prisma.transaction.update({
			where: { id },
			data: {
				...dto,
				dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined
			},
			include: transactionInclude
		})
	}

	async remove(id: string, userMarketId?: string) {
		await this.findOne(id, userMarketId)
		await this.prisma.transaction.delete({ where: { id } })
	}

	async pay(id: string, dto: CreatePaymentDto, user: JwtPayload) {
		const marketId = user.marketId
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		const transaction = await this.findOne(id, marketId)

		if (transaction.remainingAmount <= 0) {
			throw new BadRequestException('Transaction is already fully paid')
		}

		if (dto.amount > transaction.remainingAmount) {
			throw new BadRequestException(
				`Payment amount (${dto.amount}) exceeds remaining debt (${transaction.remainingAmount})`
			)
		}

		return this.prisma.$transaction(async tx => {
			// Атомарное списание долга прямо в БД: обновляем, только если
			// remainingAmount всё ещё не меньше суммы платежа — это защищает
			// от гонки при двух одновременных платежах по одному долгу
			// (lost update). Если условие не совпало — кто-то уже успел
			// провести другой платёж, отдаём понятную ошибку.
			const candidates = await tx.transaction.findMany({
				where: { id, remainingAmount: { gte: dto.amount } },
				select: { remainingAmount: true }
			})
			if (candidates.length === 0) {
				throw new BadRequestException(
					'Payment amount exceeds the current remaining debt'
				)
			}

			const current = candidates[0].remainingAmount
			const newRemaining = current - dto.amount
			const newStatus =
				newRemaining <= 0 ? TransactionStatus.PAID : TransactionStatus.PARTIAL

			const updateResult = await tx.transaction.updateMany({
				where: { id, remainingAmount: current },
				data: { remainingAmount: newRemaining, status: newStatus }
			})

			if (updateResult.count === 0) {
				throw new BadRequestException(
					'Transaction was modified concurrently, please retry'
				)
			}

			await tx.payment.create({
				data: {
					transactionId: id,
					amount: dto.amount,
					note: dto.note,
					createdById: user.sub
				}
			})

			return tx.transaction.findUniqueOrThrow({
				where: { id },
				include: transactionInclude
			})
		})
	}

	/**
	 * Возврат продажи: создаёт REFUND-транзакцию, возвращает товар на склад
	 * и помечает исходную SALE-транзакцию как REFUNDED.
	 */
	async refund(id: string, user: JwtPayload) {
		const marketId = user.marketId
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		const original = await this.prisma.transaction.findUnique({
			where: { id },
			include: { items: true, refund: true }
		})

		if (!original || original.marketId !== marketId) {
			throw new NotFoundException('Transaction not found')
		}
		if (original.type === TransactionType.REFUND) {
			throw new BadRequestException('Cannot refund a refund transaction')
		}
		if (original.refund) {
			throw new BadRequestException('Transaction was already refunded')
		}

		return this.prisma.$transaction(async tx => {
			for (const item of original.items) {
				await tx.product.update({
					where: { id: item.productId },
					data: { quantity: { increment: item.quantity } }
				})
			}

			const refundTx = await tx.transaction.create({
				data: {
					marketId,
					createdById: user.sub,
					debtorId: original.debtorId,
					refundOfId: original.id,
					type: TransactionType.REFUND,
					paymentType: original.paymentType,
					totalAmount: original.totalAmount,
					remainingAmount: 0,
					status: TransactionStatus.PAID,
					items: {
						create: original.items.map(item => ({
							productId: item.productId,
							productName: item.productName,
							quantity: item.quantity,
							price: item.price,
							discount: item.discount,
							totalPrice: item.totalPrice
						}))
					}
				},
				include: transactionInclude
			})

			await tx.transaction.update({
				where: { id: original.id },
				data: { status: TransactionStatus.REFUNDED }
			})

			return refundTx
		})
	}
}
