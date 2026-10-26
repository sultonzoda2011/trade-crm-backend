import { DebtorRisk } from '../enums'

/**
 * Баллы за факторы риска.
 *
 * Все факторы безразмерные (доли, дни, отношение к среднему по маркету) —
 * абсолютных сумм в порогах нет намеренно: порог «долг больше 500» зависел бы
 * от валюты и масштаба магазина и врал бы на любой другой базе.
 */
export const RISK_SCORES = {
	/** Доля просроченного в текущем долге. */
	overdueShare: {
		some: 2,
		majority: 4
	},
	/** Максимальная просрочка по активным долгам, дни. */
	maxDaysOverdue: {
		upTo7: 1,
		upTo30: 2,
		over30: 3
	},
	/** Долг относительно среднего активного долга по маркету. */
	relativeSize: {
		aboveAverage: 1,
		farAboveAverage: 2
	},
	/** Какую часть когда-либо выданного человек вернул. */
	repayment: {
		partial: 1,
		low: 2
	},
	/** Давность последнего платежа. */
	paymentActivity: {
		stale: 1,
		none: 2
	}
} as const

/** Границы итогового счёта. Максимум по всем факторам — 13. */
export const RISK_THRESHOLDS = { HIGH: 7, MEDIUM: 4 } as const

/** Долг «давно без движения», дни. */
const STALE_PAYMENT_DAYS = 45

export interface DebtorRiskInput {
	/** Текущий остаток долга. */
	totalDebtAmount: number
	overdueAmount: number
	maxDaysOverdue: number
	/** Сколько всего когда-либо выдавалось в долг этому человеку. */
	totalIssued: number
	/** Сколько из этого собрано платежами. */
	totalCollected: number
	daysSinceLastPayment: number | null
	/** Средний активный долг на должника в маркете — база для сравнения. */
	marketAverageDebt: number
}

export interface DebtorRiskResult {
	risk: DebtorRisk
	score: number
	/** Ключи факторов для i18n — текст живёт на фронтенде. */
	factors: string[]
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max)
}

/**
 * Детерминированная скоринговая модель риска должника.
 *
 * Формула открытая: каждый фактор добавляет фиксированные баллы из
 * RISK_SCORES, сумма маппится в { LOW, MEDIUM, HIGH } по RISK_THRESHOLDS.
 * Возвращаем и счёт, и список сработавших факторов — интерфейс может
 * объяснить пользователю, почему риск именно такой.
 *
 * Чистая функция: тестируется без БД.
 */
export function scoreDebtorRisk(input: DebtorRiskInput): DebtorRiskResult {
	// Нет текущего долга — нечего оценивать. Прошлые закрытые долги риском
	// не считаем: человек всё вернул.
	if (input.totalDebtAmount <= 0) {
		return { risk: DebtorRisk.LOW, score: 0, factors: [] }
	}

	const factors: string[] = []
	let score = 0

	const overdueShare = clamp(input.overdueAmount / input.totalDebtAmount, 0, 1)
	if (overdueShare >= 0.5) {
		score += RISK_SCORES.overdueShare.majority
		factors.push('overdueShare.majority')
	} else if (overdueShare > 0) {
		score += RISK_SCORES.overdueShare.some
		factors.push('overdueShare.some')
	}

	if (input.maxDaysOverdue > 30) {
		score += RISK_SCORES.maxDaysOverdue.over30
		factors.push('daysOverdue.over30')
	} else if (input.maxDaysOverdue > 7) {
		score += RISK_SCORES.maxDaysOverdue.upTo30
		factors.push('daysOverdue.upTo30')
	} else if (input.maxDaysOverdue > 0) {
		score += RISK_SCORES.maxDaysOverdue.upTo7
		factors.push('daysOverdue.upTo7')
	}

	// Размер долга оцениваем относительно среднего по маркету, а не по
	// абсолютной сумме: так порог работает в любой валюте и на любом масштабе.
	if (input.marketAverageDebt > 0) {
		const relative = input.totalDebtAmount / input.marketAverageDebt
		if (relative >= 3) {
			score += RISK_SCORES.relativeSize.farAboveAverage
			factors.push('size.farAboveAverage')
		} else if (relative >= 1.5) {
			score += RISK_SCORES.relativeSize.aboveAverage
			factors.push('size.aboveAverage')
		}
	}

	// Платёжная дисциплина: какую долю выданного человек уже вернул.
	if (input.totalIssued > 0) {
		const repaid = clamp(input.totalCollected / input.totalIssued, 0, 1)
		if (repaid < 0.3) {
			score += RISK_SCORES.repayment.low
			factors.push('repayment.low')
		} else if (repaid < 0.7) {
			score += RISK_SCORES.repayment.partial
			factors.push('repayment.partial')
		}
	}

	// Ни одного платежа — риск выше, чем «платил, но давно».
	if (input.daysSinceLastPayment === null) {
		score += RISK_SCORES.paymentActivity.none
		factors.push('activity.noPayments')
	} else if (input.daysSinceLastPayment > STALE_PAYMENT_DAYS) {
		score += RISK_SCORES.paymentActivity.stale
		factors.push('activity.stale')
	}

	const risk =
		score >= RISK_THRESHOLDS.HIGH
			? DebtorRisk.HIGH
			: score >= RISK_THRESHOLDS.MEDIUM
				? DebtorRisk.MEDIUM
				: DebtorRisk.LOW

	return { risk, score, factors }
}

/** Готовый профиль долгов должника — то, что уезжает во фронтенд. */
export interface DebtorDebtProfile extends DebtorRiskResult {
	totalDebtAmount: number
	activeDebtCount: number
	overdueAmount: number
	overdueCount: number
	totalIssued: number
	totalCollected: number
	/** Доля возвращённого от когда-либо выданного, 0..1. */
	repaymentRate: number
	maxDaysOverdue: number
	daysSinceLastPayment: number | null
	lastPaymentAt: Date | null
	nextDueDate: Date | null
	/**
	 * Транзакция для быстрого «Погасить долг» одним тапом из списка/карточки.
	 * Заполняется, только когда у должника РОВНО один активный долг — иначе
	 * непонятно, какую из транзакций гасить, и фронт вместо модалки платежа
	 * должен вести на страницу должника со списком.
	 */
	activeDebtTransactionId: string | null
	/** Последняя долговая покупка — для превью товаров на карточке должника. */
	lastPurchase: DebtorLastPurchase | null
}

export interface DebtorLastPurchase {
	at: Date
	items: Array<{ productId: string; name: string; quantity: number; image: string | null }>
}

export const EMPTY_DEBTOR_PROFILE: DebtorDebtProfile = {
	totalDebtAmount: 0,
	activeDebtCount: 0,
	overdueAmount: 0,
	overdueCount: 0,
	totalIssued: 0,
	totalCollected: 0,
	repaymentRate: 0,
	maxDaysOverdue: 0,
	activeDebtTransactionId: null,
	lastPurchase: null,
	daysSinceLastPayment: null,
	lastPaymentAt: null,
	nextDueDate: null,
	risk: DebtorRisk.LOW,
	score: 0,
	factors: []
}

/** Поля сортировки, которых нет в БД: они требуют аналитического пути. */
export const RISK_SORT_FIELDS = [
	'risk',
	'score',
	'totalDebtAmount',
	'overdueAmount',
	'maxDaysOverdue',
	'repaymentRate'
]

/** Порядок риска для сортировки: самые проблемные — сверху. */
const RISK_ORDER: Record<DebtorRisk, number> = {
	[DebtorRisk.HIGH]: 0,
	[DebtorRisk.MEDIUM]: 1,
	[DebtorRisk.LOW]: 2
}

/**
 * Сортировка по вычисленным полям. По умолчанию — по риску: главный вопрос
 * к этому экрану — «с кем разбираться в первую очередь».
 */
export function buildRiskComparator(sortBy: string | undefined, sortOrder: 'asc' | 'desc' = 'desc') {
	const direction = sortOrder === 'asc' ? 1 : -1

	return (a: DebtorDebtProfile & { name: string }, b: DebtorDebtProfile & { name: string }) => {
		if (!sortBy || sortBy === 'risk') {
			const diff = RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
			// Внутри одного риска первым идёт тот, у кого больше денег на кону.
			if (diff !== 0) return diff
			return b.totalDebtAmount - a.totalDebtAmount
		}

		const aValue = a[sortBy as keyof DebtorDebtProfile]
		const bValue = b[sortBy as keyof DebtorDebtProfile]
		if (typeof aValue === 'number' && typeof bValue === 'number') {
			return (aValue - bValue) * direction
		}
		return a.name.localeCompare(b.name) * direction
	}
}
