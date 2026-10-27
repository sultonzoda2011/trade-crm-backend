import { planDebtorPayment } from './debtor-payment.util'

describe('planDebtorPayment', () => {
	const debts = [
		{ id: 'old', remainingAmount: 300 },
		{ id: 'mid', remainingAmount: 200 },
		{ id: 'new', remainingAmount: 100 }
	]

	it('closes the oldest debt first and spills the rest to the next one', () => {
		const { allocations, excess } = planDebtorPayment(debts, 450)

		expect(excess).toBe(0)
		expect(allocations).toEqual([
			{ transactionId: 'old', amount: 300, remainingAfter: 0, settled: true },
			{ transactionId: 'mid', amount: 150, remainingAfter: 50, settled: false }
		])
	})

	it('keeps a partial payment inside the oldest debt', () => {
		const { allocations } = planDebtorPayment(debts, 120)

		expect(allocations).toHaveLength(1)
		expect(allocations[0]).toMatchObject({ transactionId: 'old', amount: 120, remainingAfter: 180, settled: false })
	})

	it('closes everything when the payment equals the total debt', () => {
		const { allocations, excess } = planDebtorPayment(debts, 600)

		expect(excess).toBe(0)
		expect(allocations.every(part => part.settled)).toBe(true)
	})

	it('reports the excess instead of silently dropping money', () => {
		expect(planDebtorPayment(debts, 650).excess).toBe(50)
	})

	it('does not leave float dust after fractional amounts', () => {
		const { allocations, excess } = planDebtorPayment([{ id: 'a', remainingAmount: 0.3 }], 0.1 + 0.2)

		expect(excess).toBe(0)
		expect(allocations[0]).toMatchObject({ remainingAfter: 0, settled: true })
	})

	it('skips already closed debts', () => {
		const { allocations } = planDebtorPayment([{ id: 'zero', remainingAmount: 0 }, { id: 'open', remainingAmount: 50 }], 20)

		expect(allocations.map(part => part.transactionId)).toEqual(['open'])
	})
})
