import { Prisma, StockMovementType } from '@prisma/client'

/** Транзакционный клиент Prisma: все изменения остатка делаются только внутри $transaction. */
export type StockTx = Prisma.TransactionClient

/**
 * Потолок и для одного пополнения, и для остатка после него. `Product.quantity`
 * — Int (до ~2.1 млрд), так что запас по переполнению остаётся с большим
 * зазором, а опечатка вроде лишних нулей отсекается сразу.
 */
export const MAX_STOCK = 1_000_000_000

export interface StockMovementInput {
	productId: string
	marketId: string
	type: StockMovementType
	/** Со знаком: приход > 0, расход < 0. Нулевое движение не записывается. */
	delta: number
	reason?: string | null
	note?: string | null
	transactionId?: string | null
	createdById?: string | null
}

/**
 * Атомарно двигает остаток товара и возвращает остаток ПОСЛЕ движения, либо
 * null, если защитное условие не выполнилось (расход больше остатка или
 * приход выше потолка). Решение, что делать с null (400/409), — за вызывающим:
 * у продажи, списания и пополнения тексты ошибок разные.
 *
 * Сам инкремент считает БД (`increment`/`decrement` внутри UPDATE с условием в
 * WHERE), поэтому параллельные продажи и пополнения не затирают друг друга.
 * Чтение остатка после обновления безопасно: строка уже заблокирована нашей
 * транзакцией до её конца, других записей между UPDATE и SELECT не будет.
 */
export async function moveStock(
	tx: StockTx,
	productId: string,
	delta: number
): Promise<number | null> {
	const where =
		delta < 0
			? { id: productId, quantity: { gte: -delta } }
			: { id: productId, quantity: { lte: MAX_STOCK - delta } }

	const { count } = await tx.product.updateMany({
		where,
		data: { quantity: { increment: delta } }
	})
	if (count === 0) return null

	const { quantity } = await tx.product.findUniqueOrThrow({
		where: { id: productId },
		select: { quantity: true }
	})
	return quantity
}

/** Пишет одну строку журнала. balanceAfter берётся из moveStock. */
export function logMovement(
	tx: StockTx,
	input: StockMovementInput,
	balanceAfter: number
) {
	return tx.stockMovement.create({
		data: {
			productId: input.productId,
			marketId: input.marketId,
			type: input.type,
			delta: input.delta,
			balanceAfter,
			reason: input.reason ?? null,
			note: input.note?.trim() || null,
			transactionId: input.transactionId ?? null,
			createdById: input.createdById ?? null
		}
	})
}

/** Несколько строк журнала одним запросом (строки чека). */
export function logMovements(
	tx: StockTx,
	rows: (StockMovementInput & { balanceAfter: number })[]
) {
	return tx.stockMovement.createMany({
		data: rows.map(row => ({
			productId: row.productId,
			marketId: row.marketId,
			type: row.type,
			delta: row.delta,
			balanceAfter: row.balanceAfter,
			reason: row.reason ?? null,
			note: row.note?.trim() || null,
			transactionId: row.transactionId ?? null,
			createdById: row.createdById ?? null
		}))
	})
}
