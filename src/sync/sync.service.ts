import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtPayload } from '../interfaces'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Инклюд транзакций для sync ровно того же вида, что и в TransactionsService
 * (transactionInclude), но объявлен отдельно: модуль sync не должен зависеть
 * от внутренностей TransactionsModule, а форма ответа обязана совпадать с
 * тем, что уже умеет парсить фронтенд (types/transactions.ts).
 */
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

@Injectable()
export class SyncService {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Отдаёт всё, что изменилось в маркете пользователя с момента `since`.
	 *
	 * since отсутствует/пуст => отдаём всё (первая синхронизация, приложение
	 * только что установлено). serverTime в ответе — это то, что клиент
	 * сохранит как новый `since` для следующего пула: время СЕРВЕРА, а не
	 * клиента, иначе рассинхрон часов на телефоне может как пропустить
	 * изменения, так и зациклить один и тот же пул.
	 *
	 * Payment/SellerCredit/TransactionItem отдельного updatedAt не имеют —
	 * это неизменяемые записи, привязанные к Transaction. Любое действие,
	 * которое их создаёт (оплата, возврат), обновляет родительскую
	 * Transaction.updatedAt, поэтому вложенный transactionInclude покрывает
	 * их изменения без отдельного запроса.
	 */
	async pull(user: JwtPayload, since?: string) {
		const marketId = user.marketId
		if (!marketId) {
			throw new UnauthorizedException('User is not assigned to a market')
		}

		const sinceDate = since ? new Date(since) : new Date(0)
		if (Number.isNaN(sinceDate.getTime())) {
			throw new UnauthorizedException('Invalid `since` timestamp')
		}

		// Фиксируем момент ДО запросов: если во время выполнения кто-то успеет
		// изменить запись, она просто попадёт в следующий пул, а не потеряется.
		const serverTime = new Date()

		const [products, categories, debtors, transactions] = await Promise.all([
			this.prisma.product.findMany({
				where: { marketId, updatedAt: { gt: sinceDate } }
			}),
			this.prisma.category.findMany({
				where: { marketId, updatedAt: { gt: sinceDate } }
			}),
			this.prisma.debtor.findMany({
				where: { marketId, updatedAt: { gt: sinceDate } }
			}),
			this.prisma.transaction.findMany({
				where: { marketId, updatedAt: { gt: sinceDate } },
				include: transactionInclude,
				orderBy: { createdAt: 'asc' }
			})
		])

		return {
			serverTime: serverTime.toISOString(),
			products,
			categories,
			debtors,
			transactions
		}
	}
}
