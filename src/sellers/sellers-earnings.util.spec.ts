import { fetchBalances, fetchEarningsFeed, fetchPeriodTotals } from './sellers-earnings.util'

/**
 * Сами SQL-запросы проверены на настоящем Postgres (PGlite) при разработке:
 * лента сходится с балансом, периоды складываются в него же. Здесь — разбор
 * ответа БД: округление, нули для продавца без записей, знак баланса.
 */
describe('sellers-earnings.util', () => {
	const dbWith = (rows: unknown[]) => ({ $queryRaw: jest.fn().mockResolvedValue(rows) }) as any

	describe('fetchBalances', () => {
		it('balance = earned − refunded − paidOut from rounded parts', async () => {
			const db = dbWith([
				{ sellerId: 'a', kind: 'earned', value: 100.1 + 0.2 },
				{ sellerId: 'a', kind: 'refunded', value: 10.005 },
				{ sellerId: 'a', kind: 'paidOut', value: 50 },
				{ sellerId: 'a', kind: 'pending', value: 20 }
			])
			const a = (await fetchBalances(db, ['a', 'b'])).get('a')!
			expect(a).toEqual({ sellerId: 'a', earned: 100.3, refunded: 10.01, paidOut: 50, balance: 40.29, pendingInDebts: 20 })
		})

		it('a seller without any rows is all zeros; an unknown id in the rows is ignored', async () => {
			const db = dbWith([{ sellerId: 'ghost', kind: 'earned', value: 5 }])
			const map = await fetchBalances(db, ['a'])
			expect(map.get('a')).toEqual({ sellerId: 'a', earned: 0, refunded: 0, paidOut: 0, balance: 0, pendingInDebts: 0 })
			expect(map.has('ghost')).toBe(false)
		})

		it('paying more than earned shows as a negative balance (overpaid)', async () => {
			const db = dbWith([
				{ sellerId: 'a', kind: 'earned', value: 30 },
				{ sellerId: 'a', kind: 'paidOut', value: 50 }
			])
			expect((await fetchBalances(db, ['a'])).get('a')!.balance).toBe(-20)
		})

		it('does not query for an empty list', async () => {
			const db = dbWith([])
			expect((await fetchBalances(db, [])).size).toBe(0)
			expect(db.$queryRaw).not.toHaveBeenCalled()
		})
	})

	describe('fetchPeriodTotals', () => {
		it('sold = receipts − refunds of their sales; earned = markup − refunded markup', async () => {
			const db = dbWith([
				{ sellerId: 'a', kind: 'count', value: 3 },
				{ sellerId: 'a', kind: 'sold', value: 800 },
				{ sellerId: 'a', kind: 'refunds', value: 200 },
				{ sellerId: 'a', kind: 'earned', value: 35 },
				{ sellerId: 'a', kind: 'refundedMarkup', value: 4 }
			])
			const range = { gte: new Date(0), lte: new Date() }
			const map = await fetchPeriodTotals(db, ['a', 'b'], range)
			expect(map.get('a')).toEqual({ salesCount: 3, sold: 600, earned: 31 })
			expect(map.get('b')).toEqual({ salesCount: 0, sold: 0, earned: 0 })
		})
	})

	describe('fetchEarningsFeed', () => {
		it('rounds the signed amounts', async () => {
			const rows = await fetchEarningsFeed(dbWith([{ id: 'e', amount: -3.0000000000000004 }]), 'a', 0, 10)
			expect(rows[0].amount).toBe(-3)
		})
	})
})
