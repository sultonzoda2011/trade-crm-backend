import { AnalyticsPeriod } from '../dto/period-query.dto'
import { buildComparison, resolvePeriod, round2 } from './period.util'

describe('resolvePeriod', () => {
	// Середина месяца и середина недели — так видно, что окна не «доезжают»
	// до конца месяца и что неделя считается с понедельника.
	const now = new Date('2026-08-12T15:30:00Z') // среда

	it('defaults to the current month when nothing is passed', () => {
		const { current } = resolvePeriod({}, now)

		expect(current.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z')
		expect(current.lte.toISOString()).toBe('2026-08-12T23:59:59.999Z')
	})

	it('starts the week on Monday', () => {
		const { current } = resolvePeriod({ period: AnalyticsPeriod.WEEK }, now)

		expect(current.gte.toISOString()).toBe('2026-08-10T00:00:00.000Z')
	})

	it('treats Sunday as the last day of the week, not the first', () => {
		const sunday = new Date('2026-08-16T10:00:00Z')

		const { current } = resolvePeriod({ period: AnalyticsPeriod.WEEK }, sunday)

		expect(current.gte.toISOString()).toBe('2026-08-10T00:00:00.000Z')
	})

	// Главное правило сравнения: сопоставимые окна одинаковой длины.
	it('shifts the window back instead of taking the whole previous month', () => {
		const { previous } = resolvePeriod({ period: AnalyticsPeriod.MONTH }, now)

		// 12 дней августа сравниваются с 12 днями июля, а не с 31 днём.
		expect(previous.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z')
		expect(previous.lte.toISOString()).toBe('2026-07-12T23:59:59.999Z')
	})

	it('clamps the day of month when shifting into a shorter month', () => {
		const march31 = new Date('2026-03-31T12:00:00Z')

		const { previous } = resolvePeriod({ period: AnalyticsPeriod.MONTH }, march31)

		// 31 марта − 1 месяц = 28 февраля, а не 3 марта.
		expect(previous.lte.toISOString().slice(0, 10)).toBe('2026-02-28')
	})

	it('extends a bare dateTo to the end of that day', () => {
		const { current } = resolvePeriod(
			{ dateFrom: '2026-08-01', dateTo: '2026-08-05' },
			now,
		)

		// Иначе весь последний день выпал бы из выборки.
		expect(current.lte.toISOString()).toBe('2026-08-05T23:59:59.999Z')
	})

	it('places the previous window immediately before a custom range', () => {
		const { current, previous } = resolvePeriod(
			{ dateFrom: '2026-08-01', dateTo: '2026-08-05' },
			now,
		)

		expect(previous.lte.getTime()).toBe(current.gte.getTime() - 1)
		expect(previous.lte.getTime() - previous.gte.getTime()).toBe(
			current.lte.getTime() - current.gte.getTime(),
		)
	})

	it('groups the year by month and shorter periods by day', () => {
		expect(resolvePeriod({ period: AnalyticsPeriod.YEAR }, now).truncUnit).toBe('month')
		expect(resolvePeriod({ period: AnalyticsPeriod.WEEK }, now).truncUnit).toBe('day')
	})

	it('never reports a zero-day duration', () => {
		// Иначе «средние продажи в день» делились бы на ноль.
		const { durationDays } = resolvePeriod({ period: AnalyticsPeriod.TODAY }, now)

		expect(durationDays).toBeGreaterThanOrEqual(1)
	})
})

describe('buildComparison', () => {
	it('reports growth as a rounded percentage', () => {
		expect(buildComparison(118, 100)).toEqual({
			current: 118,
			previous: 100,
			difference: 18,
			changePercent: 18,
		})
	})

	it('reports decline as a negative percentage', () => {
		expect(buildComparison(88, 100).changePercent).toBe(-12)
	})

	// Рост «с нуля» в процентах не выражается — показывать +100% было бы враньём.
	it('returns null percent when the previous value was zero', () => {
		expect(buildComparison(500, 0).changePercent).toBeNull()
	})

	it('returns a zero percent change for equal values', () => {
		expect(buildComparison(100, 100).changePercent).toBe(0)
	})

	it('keeps one decimal place of precision', () => {
		expect(buildComparison(103, 96).changePercent).toBe(7.3)
	})
})

describe('round2', () => {
	it('rounds monetary values to two decimals', () => {
		expect(round2(10.005)).toBe(10.01)
		expect(round2(0.1 + 0.2)).toBe(0.3)
	})
})
