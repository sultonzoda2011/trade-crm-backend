import { Prisma } from '@prisma/client'
import { DUE_SOON_DAYS, MS_PER_DAY } from '../common/utils/period.util'
import { DebtStatusFilter } from '../enums'

export const transactionInclude = {
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
 * Облегчённый include для пагинированного списка транзакций.
 *
 * Список рендерит только превью товаров и должника — payments/createdBy/полный
 * market ему не нужны (не отображаются ни в таблице, ни в мобильной карточке),
 * но раньше тянулись на каждую из 20 строк каждой страницы. History платежей
 * и подробности market/createdBy остаются в transactionDetailInclude — они
 * нужны только на карточке одной транзакции.
 */
export const transactionListInclude = {
	items: {
		include: {
			product: { select: { id: true, name: true, price: true, image: true } }
		}
	},
	debtor: { select: { id: true, name: true, phone: true } },
	market: { select: { id: true, name: true } }
} as const

/**
 * Детальный include: дополнительно тянет связанные возвраты и исходную продажу,
 * чтобы страница транзакции показывала весь бизнес-процесс
 * (Sale → Payment → Refund) без второго round-trip.
 * В списках не используется намеренно — там это лишние джойны на каждую строку.
 */
export const transactionDetailInclude = {
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

/**
 * «Просрочен» и «скоро срок» — это состояния на момент запроса, а не
 * колонки в БД, поэтому фильтр выводится из status + dueDate. Долг без
 * dueDate не может быть просроченным: срок ему не назначали.
 *
 * Фильтр всегда сужает выборку до type = DEBT: у продажи нет срока оплаты,
 * и включать её в «просроченные» означало бы врать в цифрах.
 */
export function applyDebtStatusFilter(
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

export function buildTransactionTimeline(transaction: {
	id: string
	type: string
	createdAt: Date
	totalAmount: number
	createdBy?: { name: string } | null
	payments: Array<{ createdAt: Date; amount: number; createdBy?: { name: string } | null }>
	refunds: Array<{ id: string; createdAt: Date; totalAmount: number; createdBy?: { name: string } | null }>
}) {
	return [
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
}
