import { stripCostPrice } from './strip-cost.util'

describe('stripCostPrice', () => {
	it('removes costPrice from a plain product', () => {
		expect(stripCostPrice({ id: 'p1', price: 10, costPrice: 6 })).toEqual({
			id: 'p1',
			price: 10
		})
	})

	it('removes it from every element of a paginated list and from nested objects', () => {
		const result = stripCostPrice({
			data: [
				{ id: 'p1', costPrice: 6, metrics: { revenue: 5 } },
				{ id: 'p2', costPrice: null }
			],
			meta: { total: 2 }
		})
		expect(result).toEqual({
			data: [{ id: 'p1', metrics: { revenue: 5 } }, { id: 'p2' }],
			meta: { total: 2 }
		})
	})

	it('keeps dates, nulls and primitives intact', () => {
		const createdAt = new Date('2026-10-28T00:00:00Z')
		expect(stripCostPrice({ createdAt, note: null, n: 1 })).toEqual({
			createdAt,
			note: null,
			n: 1
		})
		expect(stripCostPrice(null)).toBeNull()
		expect(stripCostPrice(5)).toBe(5)
	})

	it('does not mutate the input', () => {
		const input = { id: 'p1', costPrice: 6 }
		stripCostPrice(input)
		expect(input.costPrice).toBe(6)
	})
})
