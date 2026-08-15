import { DebtorRisk } from '../enums'
import { scoreDebtorRisk } from './debtors.service'

describe('scoreDebtorRisk', () => {
	// Базовый «здоровый» должник: платит, срок не наступил, долг средний.
	const healthy = {
		totalDebtAmount: 100,
		overdueAmount: 0,
		maxDaysOverdue: 0,
		totalIssued: 1000,
		totalCollected: 900,
		daysSinceLastPayment: 5,
		marketAverageDebt: 100,
	}

	it('rates a paying debtor with no overdue as LOW', () => {
		const { risk, factors } = scoreDebtorRisk(healthy)

		expect(risk).toBe(DebtorRisk.LOW)
		expect(factors).toEqual([])
	})

	// Закрытые долги риском не считаются: человек всё вернул.
	it('rates a debtor with no outstanding debt as LOW regardless of history', () => {
		const { risk, score } = scoreDebtorRisk({
			...healthy,
			totalDebtAmount: 0,
			totalCollected: 0,
			maxDaysOverdue: 400,
		})

		expect(risk).toBe(DebtorRisk.LOW)
		expect(score).toBe(0)
	})

	it('escalates when most of the debt is overdue and long overdue', () => {
		const { risk, factors } = scoreDebtorRisk({
			...healthy,
			overdueAmount: 100,
			maxDaysOverdue: 60,
			totalCollected: 100,
			daysSinceLastPayment: 90,
		})

		expect(risk).toBe(DebtorRisk.HIGH)
		expect(factors).toContain('overdueShare.majority')
		expect(factors).toContain('daysOverdue.over30')
		expect(factors).toContain('repayment.low')
	})

	it('separates partial overdue from full overdue', () => {
		const partial = scoreDebtorRisk({ ...healthy, overdueAmount: 20, maxDaysOverdue: 3 })
		const full = scoreDebtorRisk({ ...healthy, overdueAmount: 100, maxDaysOverdue: 3 })

		expect(partial.factors).toContain('overdueShare.some')
		expect(full.factors).toContain('overdueShare.majority')
		expect(full.score).toBeGreaterThan(partial.score)
	})

	// Порог по размеру долга безразмерный: в абсолютных суммах он зависел бы
	// от валюты и масштаба магазина.
	it('scores debt size relative to the market average, not an absolute amount', () => {
		const bigMarket = scoreDebtorRisk({
			...healthy,
			totalDebtAmount: 100_000,
			marketAverageDebt: 100_000,
		})
		const outlier = scoreDebtorRisk({
			...healthy,
			totalDebtAmount: 400,
			marketAverageDebt: 100,
		})

		expect(bigMarket.factors).not.toContain('size.aboveAverage')
		expect(bigMarket.factors).not.toContain('size.farAboveAverage')
		expect(outlier.factors).toContain('size.farAboveAverage')
	})

	it('penalises a debtor who never made a payment', () => {
		const { factors } = scoreDebtorRisk({
			...healthy,
			totalCollected: 0,
			daysSinceLastPayment: null,
		})

		expect(factors).toContain('activity.noPayments')
	})

	it('penalises a stale payment less than no payment at all', () => {
		const stale = scoreDebtorRisk({ ...healthy, daysSinceLastPayment: 90 })
		const never = scoreDebtorRisk({ ...healthy, daysSinceLastPayment: null })

		expect(stale.factors).toContain('activity.stale')
		expect(never.score).toBeGreaterThan(stale.score)
	})

	it('is deterministic for identical input', () => {
		const input = { ...healthy, overdueAmount: 60, maxDaysOverdue: 20 }

		expect(scoreDebtorRisk(input)).toEqual(scoreDebtorRisk(input))
	})

	it('orders risk levels monotonically with the score', () => {
		const low = scoreDebtorRisk(healthy)
		const medium = scoreDebtorRisk({
			...healthy,
			overdueAmount: 100,
			maxDaysOverdue: 10,
		})
		const high = scoreDebtorRisk({
			...healthy,
			overdueAmount: 100,
			maxDaysOverdue: 60,
			totalCollected: 0,
			daysSinceLastPayment: null,
		})

		expect(low.score).toBeLessThan(medium.score)
		expect(medium.score).toBeLessThan(high.score)
		expect([low.risk, medium.risk, high.risk]).toEqual([
			DebtorRisk.LOW,
			DebtorRisk.MEDIUM,
			DebtorRisk.HIGH,
		])
	})
})
