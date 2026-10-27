import { buildDebtorLedger } from './debtor-ledger.util'

const day = (n: number) => new Date(Date.UTC(2026, 9, n))

const debt = (id: string, totalAmount: number, createdAt: Date) => ({
	id,
	totalAmount,
	createdAt,
	dueDate: null,
	createdByName: 'Seller',
	itemNames: ['Товар']
})

const payment = (id: string, transactionId: string, amount: number, createdAt: Date) => ({
	id,
	transactionId,
	amount,
	note: null,
	createdAt,
	createdByName: 'Seller'
})

describe('buildDebtorLedger', () => {
	it('returns newest first with a running balance after every event', () => {
		const ledger = buildDebtorLedger(
			[debt('d1', 500, day(1)), debt('d2', 300, day(5))],
			[payment('p1', 'd1', 200, day(3))]
		)

		expect(ledger.map(event => [event.id, event.balanceAfter])).toEqual([
			['d2', 600],
			['p1', 300],
			['d1', 500]
		])
	})

	it('puts a debt before a payment made at the same moment', () => {
		const ledger = buildDebtorLedger([debt('d1', 100, day(1))], [payment('p1', 'd1', 100, day(1))])

		expect(ledger.map(event => event.balanceAfter)).toEqual([0, 100])
	})

	it('is empty for a debtor without history', () => {
		expect(buildDebtorLedger([], [])).toEqual([])
	})
})
