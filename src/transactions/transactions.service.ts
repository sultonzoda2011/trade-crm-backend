import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { Prisma, TransactionStatus } from '@prisma/client'
import { PaginatedResult } from '../common/dto/pagination.dto'
import {
	buildDateWhere,
	buildOrderBy,
	paginate
} from '../common/utils/paginate.util'
import { DUE_SOON_DAYS, MS_PER_DAY, round2 } from '../common/utils/period.util'
import { DebtStatusFilter, Role, TransactionType } from '../enums'
import { JwtPayload } from '../interfaces'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePaymentDto } from './dto/create-payment.dto'
import { CreateTransactionDto } from './dto/create-transaction.dto'
import { QueryTransactionDto } from './dto/query-transaction.dto'
import { RefundTransactionDto } from './dto/refund-transaction.dto'
import { UpdateTransactionDto } from './dto/update-transaction.dto'

const transactionInclude = {
	items: {
		include: {
			product: { select: { id: true, name: true, price: true, image: true } }
		}
	},
	createdBy: { select: { id: true, name: true, email: true, image: true } },
	debtor: { select: { id: true, name: true, phone: true } },
	market: { select: { id: true, name: true, address: true, image: true } },
	payments: {
		include: {
			createdBy: { select: { id: true, name: true, email: true, image: true } }
		},
		orderBy: { createdAt: 'desc' }
	}
} as const

/**
 * Детальный include: дополнительно тянет связанные возвраты и исходную продажу,
 * чтобы страница транзакции показывала весь бизнес-процесс
 * (Sale → Payment → Refund) без второго round-trip.
 * В списках не используется намеренно — там это лишние джойны на каждую строку.
 */
const transactionDetailInclude = {
	...transactionInclude,
	refundOf: {
		select: {
			id: true,
			type: true,
			status: true,
			totalAmount: true,
			createdAt: true,
			createdBy: { select: { id: true, name: true } }
		}
	},
	refunds: {
		select: {
			id: true,
			type: true,
			status: true,
			totalAmount: true,
			createdAt: true,
			createdBy: { select: { id: true, name: true } },
			items: {
				select: {
					id: true,
					productId: true,
					productName: true,
					quantity: true,
					price: true,
					totalPrice: true,
					refundOfItemId: true
				}
			}
		},
		orderBy: { createdAt: 'asc' }
	}
} as const

@Injectable()
export class TransactionsService {
	constructor(private readonly prisma: PrismaService) {}

	async create(dto: CreateTransactionDto, user: JwtPayload) {
		const marketId = user.marketId
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		// SELLER фиксирует только долги (DEBT). Обычные продажи за наличные
		// оформляет OWNER/ADMIN — иначе продавец может бесконтрольно
		// списывать товар со склада без долговой обязанности.
		if (user.role === Role.SELLER && dto.type !== TransactionType.DEBT) {
			throw new ForbiddenException('Sellers can only create DEBT transactions')
		}

		const isDebt = dto.type === TransactionType.DEBT

		// DEBT без должника бессмыслен: не к кому будет предъявить долг.
		if (isDebt && !dto.debtorId) {
			throw new BadRequestException('Debtor is required for DEBT transactions')
		}

		// Для SALE должник не используется: покупатель необязательный и хранится
		// в customerName («кому продали»). Переданный для SALE debtorId молча
		// игнорируется — долговая связка без долга бессмысленна.
		const debtorId = isDebt ? dto.debtorId : null

		const productIds = [...new Set(dto.items.map(i => i.productId))]

		return this.prisma.$transaction(async tx => {
			// Должник обязан принадлежать маркету пользователя — иначе можно
			// привязать долг к чужому должнику (IDOR).
			if (isDebt && dto.debtorId) {
				const debtor = await tx.debtor.findUnique({
					where: { id: dto.debtorId },
					select: { marketId: true }
				})
				if (!debtor || debtor.marketId !== marketId) {
					throw new BadRequestException('Debtor was not found in your market')
				}
			}
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
					debtorId,
					customerName: isDebt ? null : (dto.customerName ?? null),
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
		const where: Prisma.TransactionWhereInput = {}

		if (userMarketId) where.marketId = userMarketId
		if (query.debtorId) where.debtorId = query.debtorId
		if (query.createdById) where.createdById = query.createdById
		if (query.type) where.type = query.type
		if (query.status) where.status = query.status
		if (query.dateFrom || query.dateTo)
			where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
		if (query.search) {
			// Ищем и по должнику, и по имени создателя, чтобы SALE-транзакции
			// (без должника) тоже попадали в результаты поиска.
			where.OR = [
				{ debtor: { name: { contains: query.search, mode: 'insensitive' } } },
				{
					createdBy: { name: { contains: query.search, mode: 'insensitive' } }
				},
				{ customerName: { contains: query.search, mode: 'insensitive' } }
			]
		}
		if (query.paymentType) where.paymentType = query.paymentType
		if (query.categoryId || query.productId) {
			where.items = {
				some: {
					...(query.productId ? { productId: query.productId } : {}),
					...(query.categoryId
						? { product: { categoryId: query.categoryId } }
						: {})
				}
			}
		}
		if (query.minAmount != null || query.maxAmount != null) {
			where.totalAmount = {}
			if (query.minAmount != null) where.totalAmount.gte = query.minAmount
			if (query.maxAmount != null) where.totalAmount.lte = query.maxAmount
		}
		if (query.debtStatus) this.applyDebtStatusFilter(where, query.debtStatus)

		return paginate(
			query,
			({ skip, take }) =>
				this.prisma.transaction.findMany({
					where,
					include: transactionInclude,
					orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
						'createdAt',
						'totalAmount',
						'status',
						'type',
						'updatedAt'
					]),
					skip,
					take
				}),
			() => this.prisma.transaction.count({ where })
		)
	}

	/**
	 * «Просрочен» и «скоро срок» — это состояния на момент запроса, а не
	 * колонки в БД, поэтому фильтр выводится из status + dueDate. Долг без
	 * dueDate не может быть просроченным: срок ему не назначали.
	 *
	 * Фильтр всегда сужает выборку до type = DEBT: у продажи нет срока оплаты,
	 * и включать её в «просроченные» означало бы врать в цифрах.
	 */
	private applyDebtStatusFilter(
		where: Prisma.TransactionWhereInput,
		debtStatus: DebtStatusFilter,
		now: Date = new Date()
	): void {
		where.type = 'DEBT'

		if (debtStatus === DebtStatusFilter.SETTLED) {
			where.status = 'PAID'
			return
		}

		where.status = { in: ['ACTIVE', 'PARTIAL'] }

		if (debtStatus === DebtStatusFilter.OVERDUE) {
			where.dueDate = { lt: now }
		} else if (debtStatus === DebtStatusFilter.DUE_SOON) {
			where.dueDate = {
				gte: now,
				lte: new Date(now.getTime() + DUE_SOON_DAYS * MS_PER_DAY)
			}
		}
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

	/**
	 * Транзакция как бизнес-процесс, а не как строка таблицы.
	 *
	 * Возвращает саму транзакцию, её строки с остатком к возврату,
	 * историю платежей, историю возвратов, связь с исходной продажей
	 * и единый timeline событий (Sale → Payment → Refund).
	 */
	async findOneDetail(id: string, userMarketId?: string) {
		const transaction = await this.prisma.transaction.findUnique({
			where: { id },
			include: transactionDetailInclude
		})
		if (!transaction) throw new NotFoundException('Transaction not found')
		if (userMarketId && transaction.marketId !== userMarketId) {
			throw new NotFoundException('Transaction not found')
		}

		// По каждой строке сразу отдаём, сколько ещё можно вернуть — иначе
		// фронтенду пришлось бы дублировать это правило у себя.
		const items = transaction.items.map(item => ({
			...item,
			refundableQuantity: Math.max(item.quantity - item.refundedQuantity, 0)
		}))

		const paidAmount = round2(
			transaction.payments.reduce((sum, payment) => sum + payment.amount, 0)
		)
		const refundedAmount = round2(
			transaction.refunds.reduce((sum, refund) => sum + refund.totalAmount, 0)
		)

		const timeline = [
			{
				type: transaction.type,
				at: transaction.createdAt,
				amount: transaction.totalAmount,
				actor: transaction.createdBy?.name ?? null,
				transactionId: transaction.id
			},
			...transaction.payments.map(payment => ({
				type: 'PAYMENT' as const,
				at: payment.createdAt,
				amount: payment.amount,
				actor: payment.createdBy?.name ?? null,
				transactionId: transaction.id
			})),
			...transaction.refunds.map(refund => ({
				type: 'REFUND' as const,
				at: refund.createdAt,
				amount: refund.totalAmount,
				actor: refund.createdBy?.name ?? null,
				transactionId: refund.id
			}))
		].sort((a, b) => a.at.getTime() - b.at.getTime())

		return {
			...transaction,
			items,
			summary: {
				totalAmount: transaction.totalAmount,
				discountAmount: transaction.discountAmount,
				paidAmount,
				remainingAmount: transaction.remainingAmount,
				refundedAmount,
				netAmount: round2(transaction.totalAmount - refundedAmount)
			},
			timeline
		}
	}

	async update(id: string, dto: UpdateTransactionDto, userMarketId?: string) {
		const transaction = await this.findOne(id, userMarketId)

		// Финализированные транзакции (PAID, REFUNDED, PARTIALLY_REFUNDED)
		// редактировать нельзя — их данные зафиксированы и изменение нарушило бы
		// аудит. Частично возвращённая продажа тоже финализирована: её строки уже
		// участвуют в расчёте возвратов.
		// Для оплаты долгов используйте эндпоинт /pay.
		const finalizedStatuses: TransactionStatus[] = [
			TransactionStatus.PAID,
			TransactionStatus.REFUNDED,
			TransactionStatus.PARTIALLY_REFUNDED
		]
		if (finalizedStatuses.includes(transaction.status as TransactionStatus)) {
			throw new BadRequestException(
				'Cannot edit a finalized transaction (PAID, REFUNDED or PARTIALLY_REFUNDED). Use /pay endpoint for payments.'
			)
		}

		if (dto.debtorId && userMarketId) {
			const debtor = await this.prisma.debtor.findUnique({
				where: { id: dto.debtorId },
				select: { marketId: true }
			})
			if (!debtor || debtor.marketId !== userMarketId) {
				throw new BadRequestException('Debtor was not found in your market')
			}
		}

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
		const transaction = await this.findOne(id, userMarketId)

		// Продажу с возвратами удалять нельзя: её строки — база для расчёта
		// refundedQuantity, и удаление оставило бы возвраты без исходника.
		// Сначала удаляются сами возвраты.
		if (transaction.type !== TransactionType.REFUND) {
			const refundCount = await this.prisma.transaction.count({
				where: { refundOfId: id }
			})
			if (refundCount > 0) {
				throw new BadRequestException(
					'Cannot delete a transaction that has refunds. Delete its refunds first.'
				)
			}
		}

		return this.prisma.$transaction(async tx => {
			// SALE/DEBT списывали товар со склада при создании — при удалении
			// возвращаем его обратно. REFUND, наоборот, возвращал товар на склад —
			// при удалении списываем, чтобы не «раздуть» остатки.
			const direction = transaction.type === TransactionType.REFUND ? -1 : 1

			const items = await tx.transactionItem.findMany({
				where: { transactionId: id }
			})

			for (const item of items) {
				await tx.product.update({
					where: { id: item.productId },
					data: { quantity: { increment: item.quantity * direction } }
				})

				// Откат возврата: освобождаем возвращённое количество на исходной
				// строке, иначе товар нельзя было бы вернуть повторно, а выручка
				// осталась бы заниженной навсегда.
				if (direction === -1 && item.refundOfItemId) {
					await tx.transactionItem.update({
						where: { id: item.refundOfItemId },
						data: { refundedQuantity: { decrement: item.quantity } }
					})
				}
			}

			await tx.transaction.delete({
				where: { id }
			})

			// После отката пересчитываем статус исходной продажи: она снова
			// PAID, если возвратов не осталось, либо PARTIALLY_REFUNDED.
			if (
				transaction.type === TransactionType.REFUND &&
				transaction.refundOfId
			) {
				const originalItems = await tx.transactionItem.findMany({
					where: { transactionId: transaction.refundOfId },
					select: { quantity: true, refundedQuantity: true }
				})
				const refundedUnits = originalItems.reduce(
					(sum, item) => sum + item.refundedQuantity,
					0
				)
				const fullyRefunded =
					originalItems.length > 0 &&
					originalItems.every(item => item.refundedQuantity >= item.quantity)

				await tx.transaction.update({
					where: { id: transaction.refundOfId },
					data: {
						status: fullyRefunded
							? TransactionStatus.REFUNDED
							: refundedUnits > 0
								? TransactionStatus.PARTIALLY_REFUNDED
								: TransactionStatus.PAID
					}
				})
			}
		})
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
	 * Возврат продажи — полный или частичный.
	 *
	 * Без dto.items возвращается весь непогашенный остаток каждой строки
	 * (прежнее поведение эндпоинта сохранено). С dto.items возвращаются
	 * только указанные строки в указанном количестве.
	 *
	 * Инвариант «нельзя вернуть больше купленного» держится на
	 * TransactionItem.refundedQuantity исходной строки, а не на уникальности
	 * связи refundOfId: одна продажа может иметь несколько частичных возвратов.
	 */
	async refund(id: string, user: JwtPayload, dto: RefundTransactionDto = {}) {
		const marketId = user.marketId
		if (!marketId)
			throw new UnauthorizedException('User is not assigned to a market')

		const original = await this.prisma.transaction.findUnique({
			where: { id },
			include: { items: true }
		})

		if (!original || original.marketId !== marketId) {
			throw new NotFoundException('Transaction not found')
		}
		if (original.type === TransactionType.REFUND) {
			throw new BadRequestException('Cannot refund a refund transaction')
		}
		if (original.type !== TransactionType.SALE) {
			throw new BadRequestException('Only SALE transactions can be refunded')
		}
		if (
			original.status !== TransactionStatus.PAID &&
			original.status !== TransactionStatus.PARTIALLY_REFUNDED
		) {
			throw new BadRequestException(
				'Only fully paid SALE transactions can be refunded'
			)
		}

		const itemMap = new Map(original.items.map(item => [item.id, item]))

		// Что именно возвращаем: явный список или весь остаток по всем строкам.
		const requested = dto.items?.length
			? dto.items.map(requestedItem => {
					const item = itemMap.get(requestedItem.itemId)
					if (!item) {
						throw new BadRequestException(
							`Item ${requestedItem.itemId} does not belong to this transaction`
						)
					}
					const refundable = item.quantity - item.refundedQuantity
					if (refundable <= 0) {
						throw new BadRequestException(
							`Product "${item.productName}" has already been fully refunded`
						)
					}
					if (requestedItem.quantity > refundable) {
						throw new BadRequestException(
							`Cannot refund ${requestedItem.quantity} of "${item.productName}": only ${refundable} left to refund`
						)
					}
					return { item, quantity: requestedItem.quantity }
				})
			: original.items
					.filter(item => item.quantity - item.refundedQuantity > 0)
					.map(item => ({
						item,
						quantity: item.quantity - item.refundedQuantity
					}))

		if (requested.length === 0) {
			throw new BadRequestException('Transaction was already refunded')
		}

		// Сумма возврата считается по цене и скидке ИСХОДНОЙ строки,
		// пропорционально возвращаемому количеству — иначе частичный возврат
		// по товару со скидкой вернул бы покупателю больше, чем он заплатил.
		const refundItems = requested.map(({ item, quantity }) => {
			const unitNet = item.totalPrice / item.quantity
			return {
				item,
				quantity,
				productId: item.productId,
				productName: item.productName,
				price: item.price,
				discount: round2((item.discount / item.quantity) * quantity),
				totalPrice: round2(unitNet * quantity)
			}
		})

		const refundTotal = round2(
			refundItems.reduce((sum, line) => sum + line.totalPrice, 0)
		)

		return this.prisma.$transaction(async tx => {
			for (const line of refundItems) {
				// Атомарно двигаем refundedQuantity: обновляем только если
				// с момента чтения его никто не увеличил. Это защищает от двух
				// параллельных возвратов, которые вместе превысили бы купленное.
				const claimed = await tx.transactionItem.updateMany({
					where: {
						id: line.item.id,
						refundedQuantity: line.item.refundedQuantity
					},
					data: { refundedQuantity: { increment: line.quantity } }
				})
				if (claimed.count === 0) {
					throw new BadRequestException(
						`Refund for "${line.productName}" conflicted with another refund, please retry`
					)
				}

				await tx.product.update({
					where: { id: line.productId },
					data: { quantity: { increment: line.quantity } }
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
					totalAmount: refundTotal,
					discountAmount: round2(
						refundItems.reduce((sum, line) => sum + line.discount, 0)
					),
					remainingAmount: 0,
					status: TransactionStatus.PAID,
					items: {
						create: refundItems.map(line => ({
							productId: line.productId,
							productName: line.productName,
							quantity: line.quantity,
							price: line.price,
							discount: line.discount,
							totalPrice: line.totalPrice,
							refundOfItemId: line.item.id
						}))
					}
				},
				include: transactionInclude
			})

			// REFUNDED только когда возвращено всё до последней единицы,
			// иначе PARTIALLY_REFUNDED — продажа остаётся частично действующей.
			const refundedByItem = new Map(
				refundItems.map(line => [line.item.id, line.quantity])
			)
			const fullyRefunded = original.items.every(
				item =>
					item.refundedQuantity + (refundedByItem.get(item.id) ?? 0) >=
					item.quantity
			)

			await tx.transaction.update({
				where: { id: original.id },
				data: {
					status: fullyRefunded
						? TransactionStatus.REFUNDED
						: TransactionStatus.PARTIALLY_REFUNDED
				}
			})

			return refundTx
		})
	}
}
