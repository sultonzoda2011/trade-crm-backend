import { Prisma } from '@prisma/client'
import { round2 } from '../common/utils/period.util'

/**
 * Весь денежный учёт продавца — в этом файле, чтобы цифры в списке, на карточке
 * и в профиле продавца считались ОДНИМ кодом и сходились.
 *
 * Модель. Продавец зарабатывает надбавку (`TransactionItem.markup`) со своих
 * SALE/DEBT. Возврат откатывает надбавку строки (`refundOfItem` → исходный чек
 * → его продавец: возврат оформляет владелец, а минус получает тот, кто
 * продавал). Выплата — запись `SellerCredit`; отмена выплаты — встречная запись
 * с отрицательной суммой. Хранимого баланса нет:
 *
 *   balance = earned − refunded − paidOut
 *
 * Лента (`fetchEarningsFeed`) — те же три источника по одной строке на чек /
 * возврат / выплату, поэтому Σ amount всех её записей ВСЕГДА равна balance.
 */

/** Клиент Prisma или транзакция — всё, что умеет `$queryRaw`. */
export type RawDb = Pick<Prisma.TransactionClient, '$queryRaw'>

export interface SellerBalance {
	sellerId: string
	earned: number
	refunded: number
	paidOut: number
	/** Сколько продавцу должны. Меньше нуля — переплата. */
	balance: number
	/** Часть earned, которая сидит в ещё не погашенных долгах (ACTIVE/PARTIAL). */
	pendingInDebts: number
}

export interface SellerPeriodTotals {
	salesCount: number
	/** Продано за период: SALE + DEBT минус возвраты по продажам этого продавца. */
	sold: number
	/** Надбавка за период минус надбавка возвращённых за период строк. */
	earned: number
}

export type EarningsEntryKind = 'EARNED' | 'REFUNDED' | 'PAYOUT' | 'PAYOUT_REVERSAL'

export interface EarningsEntry {
	id: string
	kind: EarningsEntryKind
	at: Date
	/** Влияние на баланс со знаком: начисление +, возврат −, выплата −, отмена выплаты +. */
	amount: number
	transactionId: string | null
	/** Для REFUNDED — чек продажи, который вернули. */
	relatedTransactionId: string | null
	transactionType: string | null
	transactionStatus: string | null
	/** Должник или покупатель чека. */
	counterparty: string | null
	note: string | null
	/** Кто выдал/отменил выплату. */
	byName: string | null
	/** Для PAYOUT_REVERSAL — какую выплату отменяет. */
	reversalOfId: string | null
	/** Для PAYOUT — запись, которая его отменила (если отменена). */
	reversedById: string | null
}

const emptyBalance = (sellerId: string): SellerBalance => ({
	sellerId,
	earned: 0,
	refunded: 0,
	paidOut: 0,
	balance: 0,
	pendingInDebts: 0
})

/**
 * Балансы нескольких продавцов одним запросом. Для одного продавца вызывается
 * с `[id]` — отдельного «одиночного» расчёта нет.
 */
export async function fetchBalances(db: RawDb, sellerIds: string[]): Promise<Map<string, SellerBalance>> {
	const result = new Map<string, SellerBalance>(sellerIds.map(id => [id, emptyBalance(id)]))
	if (sellerIds.length === 0) return result

	const rows = await db.$queryRaw<{ sellerId: string; kind: string; value: number }[]>`
		SELECT "sellerId", "kind", SUM("value")::float8 AS "value"
		FROM (
			SELECT t."createdById" AS "sellerId", 'earned' AS "kind", i."markup" AS "value"
			FROM "TransactionItem" i
			JOIN "Transaction" t ON t."id" = i."transactionId"
			WHERE t."createdById" IN (${Prisma.join(sellerIds)})
				AND t."type" IN ('SALE', 'DEBT')
				AND i."markup" > 0
			UNION ALL
			SELECT t."createdById", 'pending', i."markup"
			FROM "TransactionItem" i
			JOIN "Transaction" t ON t."id" = i."transactionId"
			WHERE t."createdById" IN (${Prisma.join(sellerIds)})
				AND t."type" = 'DEBT'
				AND t."status" IN ('ACTIVE', 'PARTIAL')
				AND i."markup" > 0
			UNION ALL
			SELECT ot."createdById", 'refunded', ri."markup"
			FROM "TransactionItem" ri
			JOIN "Transaction" r ON r."id" = ri."transactionId"
			JOIN "TransactionItem" oi ON oi."id" = ri."refundOfItemId"
			JOIN "Transaction" ot ON ot."id" = oi."transactionId"
			WHERE ot."createdById" IN (${Prisma.join(sellerIds)})
				AND r."type" = 'REFUND'
				AND ri."markup" > 0
			UNION ALL
			SELECT c."sellerId", 'paidOut', c."amount"
			FROM "SellerCredit" c
			WHERE c."sellerId" IN (${Prisma.join(sellerIds)})
		) x
		GROUP BY "sellerId", "kind"
	`

	for (const row of rows) {
		const entry = result.get(row.sellerId)
		if (!entry) continue
		const value = round2(row.value ?? 0)
		if (row.kind === 'earned') entry.earned = value
		else if (row.kind === 'refunded') entry.refunded = value
		else if (row.kind === 'paidOut') entry.paidOut = value
		else if (row.kind === 'pending') entry.pendingInDebts = value
	}
	for (const entry of result.values()) {
		entry.balance = round2(entry.earned - entry.refunded - entry.paidOut)
	}
	return result
}

/** Показатели за окно: сколько чеков, продано, заработано. */
export async function fetchPeriodTotals(
	db: RawDb,
	sellerIds: string[],
	range: { gte: Date; lte: Date }
): Promise<Map<string, SellerPeriodTotals>> {
	const result = new Map<string, SellerPeriodTotals>(
		sellerIds.map(id => [id, { salesCount: 0, sold: 0, earned: 0 }])
	)
	if (sellerIds.length === 0) return result

	const rows = await db.$queryRaw<{ sellerId: string; kind: string; value: number }[]>`
		SELECT "sellerId", "kind", SUM("value")::float8 AS "value"
		FROM (
			SELECT t."createdById" AS "sellerId", 'count' AS "kind", 1::float8 AS "value"
			FROM "Transaction" t
			WHERE t."createdById" IN (${Prisma.join(sellerIds)})
				AND t."type" IN ('SALE', 'DEBT')
				AND t."createdAt" >= ${range.gte} AND t."createdAt" <= ${range.lte}
			UNION ALL
			SELECT t."createdById", 'sold', t."totalAmount"
			FROM "Transaction" t
			WHERE t."createdById" IN (${Prisma.join(sellerIds)})
				AND t."type" IN ('SALE', 'DEBT')
				AND t."createdAt" >= ${range.gte} AND t."createdAt" <= ${range.lte}
			UNION ALL
			SELECT ot."createdById", 'refunds', r."totalAmount"
			FROM "Transaction" r
			JOIN "Transaction" ot ON ot."id" = r."refundOfId"
			WHERE ot."createdById" IN (${Prisma.join(sellerIds)})
				AND r."type" = 'REFUND'
				AND r."createdAt" >= ${range.gte} AND r."createdAt" <= ${range.lte}
			UNION ALL
			SELECT t."createdById", 'earned', i."markup"
			FROM "TransactionItem" i
			JOIN "Transaction" t ON t."id" = i."transactionId"
			WHERE t."createdById" IN (${Prisma.join(sellerIds)})
				AND t."type" IN ('SALE', 'DEBT')
				AND i."markup" > 0
				AND t."createdAt" >= ${range.gte} AND t."createdAt" <= ${range.lte}
			UNION ALL
			SELECT ot."createdById", 'refundedMarkup', ri."markup"
			FROM "TransactionItem" ri
			JOIN "Transaction" r ON r."id" = ri."transactionId"
			JOIN "TransactionItem" oi ON oi."id" = ri."refundOfItemId"
			JOIN "Transaction" ot ON ot."id" = oi."transactionId"
			WHERE ot."createdById" IN (${Prisma.join(sellerIds)})
				AND r."type" = 'REFUND'
				AND ri."markup" > 0
				AND r."createdAt" >= ${range.gte} AND r."createdAt" <= ${range.lte}
		) x
		GROUP BY "sellerId", "kind"
	`

	const raw = new Map<string, Record<string, number>>()
	for (const row of rows) {
		const bucket = raw.get(row.sellerId) ?? {}
		bucket[row.kind] = row.value ?? 0
		raw.set(row.sellerId, bucket)
	}
	for (const [id, b] of raw) {
		const entry = result.get(id)
		if (!entry) continue
		entry.salesCount = Math.round(b.count ?? 0)
		entry.sold = round2((b.sold ?? 0) - (b.refunds ?? 0))
		entry.earned = round2((b.earned ?? 0) - (b.refundedMarkup ?? 0))
	}
	return result
}

/** Сколько записей в ленте заработка (для пагинации). */
export async function countEarningsFeed(db: RawDb, sellerId: string): Promise<number> {
	const [row] = await db.$queryRaw<{ total: number }[]>`
		SELECT (
			(SELECT COUNT(DISTINCT t."id")
				FROM "Transaction" t
				JOIN "TransactionItem" i ON i."transactionId" = t."id"
				WHERE t."createdById" = ${sellerId} AND t."type" IN ('SALE', 'DEBT') AND i."markup" > 0)
			+ (SELECT COUNT(DISTINCT r."id")
				FROM "Transaction" r
				JOIN "TransactionItem" ri ON ri."transactionId" = r."id"
				JOIN "TransactionItem" oi ON oi."id" = ri."refundOfItemId"
				JOIN "Transaction" ot ON ot."id" = oi."transactionId"
				WHERE ot."createdById" = ${sellerId} AND r."type" = 'REFUND' AND ri."markup" > 0)
			+ (SELECT COUNT(*) FROM "SellerCredit" c WHERE c."sellerId" = ${sellerId})
		)::int AS "total"
	`
	return row?.total ?? 0
}

/**
 * Лента «из чего сложился баланс», от новых к старым. Одна строка на чек
 * (начисление), на возврат (откат) и на выплату / её отмену.
 */
export async function fetchEarningsFeed(
	db: RawDb,
	sellerId: string,
	skip: number,
	take: number
): Promise<EarningsEntry[]> {
	const rows = await db.$queryRaw<EarningsEntry[]>`
		SELECT * FROM (
			SELECT
				t."id" AS "id",
				'EARNED'::text AS "kind",
				t."createdAt" AS "at",
				SUM(i."markup")::float8 AS "amount",
				t."id" AS "transactionId",
				NULL::text AS "relatedTransactionId",
				t."type"::text AS "transactionType",
				t."status"::text AS "transactionStatus",
				COALESCE(d."name", t."customerName") AS "counterparty",
				NULL::text AS "note",
				NULL::text AS "byName",
				NULL::text AS "reversalOfId",
				NULL::text AS "reversedById"
			FROM "Transaction" t
			JOIN "TransactionItem" i ON i."transactionId" = t."id"
			LEFT JOIN "Debtor" d ON d."id" = t."debtorId"
			WHERE t."createdById" = ${sellerId} AND t."type" IN ('SALE', 'DEBT') AND i."markup" > 0
			GROUP BY t."id", d."name"
			UNION ALL
			SELECT
				r."id",
				'REFUNDED'::text,
				r."createdAt",
				-SUM(ri."markup")::float8,
				r."id",
				MIN(ot."id"),
				r."type"::text,
				r."status"::text,
				MIN(COALESCE(od."name", ot."customerName")),
				r."note",
				NULL::text,
				NULL::text,
				NULL::text
			FROM "Transaction" r
			JOIN "TransactionItem" ri ON ri."transactionId" = r."id"
			JOIN "TransactionItem" oi ON oi."id" = ri."refundOfItemId"
			JOIN "Transaction" ot ON ot."id" = oi."transactionId"
			LEFT JOIN "Debtor" od ON od."id" = ot."debtorId"
			WHERE ot."createdById" = ${sellerId} AND r."type" = 'REFUND' AND ri."markup" > 0
			GROUP BY r."id"
			UNION ALL
			SELECT
				c."id",
				CASE WHEN c."reversalOfId" IS NULL THEN 'PAYOUT' ELSE 'PAYOUT_REVERSAL' END,
				c."createdAt",
				-c."amount",
				NULL::text,
				NULL::text,
				NULL::text,
				NULL::text,
				NULL::text,
				c."note",
				u."name",
				c."reversalOfId",
				rv."id"
			FROM "SellerCredit" c
			JOIN "User" u ON u."id" = c."createdById"
			LEFT JOIN "SellerCredit" rv ON rv."reversalOfId" = c."id"
			WHERE c."sellerId" = ${sellerId}
		) f
		ORDER BY f."at" DESC, f."id" DESC
		LIMIT ${take} OFFSET ${skip}
	`
	return rows.map(row => ({ ...row, amount: round2(row.amount) }))
}
