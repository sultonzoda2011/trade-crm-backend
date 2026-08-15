import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { MS_PER_DAY, round2 } from '../common/utils/period.util'
import { CreateDebtorDto } from './dto/create-debtor.dto'
import { QueryDebtorDto } from './dto/query-debtor.dto'
import { UpdateDebtorDto } from './dto/update-debtor.dto'
import { DebtorRisk, TransactionStatus } from '../enums'

const ACTIVE_DEBT_STATUSES: TransactionStatus[] = [TransactionStatus.ACTIVE, TransactionStatus.PARTIAL]

/**
 * Баллы за факторы риска.
 *
 * Все факторы безразмерные (доли, дни, отношение к среднему по маркету) —
 * абсолютных сумм в порогах нет намеренно: порог «долг больше 500» зависел бы
 * от валюты и масштаба магазина и врал бы на любой другой базе.
 */
const RISK_SCORES = {
  /** Доля просроченного в текущем долге. */
  overdueShare: {
    some: 2,
    majority: 4,
  },
  /** Максимальная просрочка по активным долгам, дни. */
  maxDaysOverdue: {
    upTo7: 1,
    upTo30: 2,
    over30: 3,
  },
  /** Долг относительно среднего активного долга по маркету. */
  relativeSize: {
    aboveAverage: 1,
    farAboveAverage: 2,
  },
  /** Какую часть когда-либо выданного человек вернул. */
  repayment: {
    partial: 1,
    low: 2,
  },
  /** Давность последнего платежа. */
  paymentActivity: {
    stale: 1,
    none: 2,
  },
} as const

/** Границы итогового счёта. Максимум по всем факторам — 13. */
const RISK_THRESHOLDS = { HIGH: 7, MEDIUM: 4 } as const

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

function clamp(value: number, min: number, max: number): number {
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

const debtorInclude = {
  market: { select: { id: true, name: true, address: true } },
  _count: { select: { transactions: true } },
} as const

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
}

const EMPTY_PROFILE: DebtorDebtProfile = {
  totalDebtAmount: 0,
  activeDebtCount: 0,
  overdueAmount: 0,
  overdueCount: 0,
  totalIssued: 0,
  totalCollected: 0,
  repaymentRate: 0,
  maxDaysOverdue: 0,
  daysSinceLastPayment: null,
  lastPaymentAt: null,
  nextDueDate: null,
  risk: DebtorRisk.LOW,
  score: 0,
  factors: [],
}

/** Поля сортировки, которых нет в БД: они требуют аналитического пути. */
const RISK_SORT_FIELDS = [
  'risk',
  'score',
  'totalDebtAmount',
  'overdueAmount',
  'maxDaysOverdue',
  'repaymentRate',
]

/**
 * Потолок аналитического пути. Должников в маркете столько не бывает,
 * но без ограничения одна аномальная база съела бы память процесса.
 */
const RISK_PATH_LIMIT = 5000

/** Порядок риска для сортировки: самые проблемные — сверху. */
const RISK_ORDER: Record<DebtorRisk, number> = {
  [DebtorRisk.HIGH]: 0,
  [DebtorRisk.MEDIUM]: 1,
  [DebtorRisk.LOW]: 2,
}

/**
 * Сортировка по вычисленным полям. По умолчанию — по риску: главный вопрос
 * к этому экрану — «с кем разбираться в первую очередь».
 */
function buildRiskComparator(sortBy: string | undefined, sortOrder: 'asc' | 'desc' = 'desc') {
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

@Injectable()
export class DebtorsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Долговой профиль по списку должников — один запрос на всю страницу,
   * без N+1. Возвраты здесь не участвуют: долг уменьшается только платежами,
   * а возврат товара по долговой продаже уже меняет remainingAmount самой
   * транзакции.
   */
  private async getDebtProfiles(
    debtorIds: string[],
    now: Date,
  ): Promise<Map<string, DebtorDebtProfile>> {
    if (debtorIds.length === 0) return new Map()

    const rows = await this.prisma.$queryRaw<
      Array<{
        debtorId: string
        totalDebtAmount: number
        activeDebtCount: bigint
        overdueAmount: number
        overdueCount: bigint
        oldestDueDate: Date | null
        nextDueDate: Date | null
        totalIssued: number
        lastDebtAt: Date | null
      }>
    >`
			SELECT
				t."debtorId" AS "debtorId",
				COALESCE(SUM(t."remainingAmount") FILTER (
					WHERE t."status" IN ('ACTIVE', 'PARTIAL')
				), 0)::float AS "totalDebtAmount",
				COUNT(*) FILTER (
					WHERE t."status" IN ('ACTIVE', 'PARTIAL')
				) AS "activeDebtCount",
				COALESCE(SUM(t."remainingAmount") FILTER (
					WHERE t."status" IN ('ACTIVE', 'PARTIAL')
						AND t."dueDate" IS NOT NULL
						AND t."dueDate" < ${now}
				), 0)::float AS "overdueAmount",
				COUNT(*) FILTER (
					WHERE t."status" IN ('ACTIVE', 'PARTIAL')
						AND t."dueDate" IS NOT NULL
						AND t."dueDate" < ${now}
				) AS "overdueCount",
				MIN(t."dueDate") FILTER (
					WHERE t."status" IN ('ACTIVE', 'PARTIAL')
						AND t."dueDate" IS NOT NULL
						AND t."dueDate" < ${now}
				) AS "oldestDueDate",
				MIN(t."dueDate") FILTER (
					WHERE t."status" IN ('ACTIVE', 'PARTIAL')
						AND t."dueDate" IS NOT NULL
						AND t."dueDate" >= ${now}
				) AS "nextDueDate",
				COALESCE(SUM(t."totalAmount"), 0)::float AS "totalIssued",
				MAX(t."createdAt") AS "lastDebtAt"
			FROM "Transaction" t
			WHERE t."type" = 'DEBT'
				AND t."debtorId" IN (${Prisma.join(debtorIds)})
			GROUP BY t."debtorId"
		`

    // Платежи считаем отдельным запросом: JOIN Payment к Transaction в том же
    // агрегате размножил бы строки и сломал SUM(remainingAmount).
    const paymentRows = await this.prisma.$queryRaw<
      Array<{ debtorId: string; totalCollected: number; lastPaymentAt: Date | null }>
    >`
			SELECT
				t."debtorId" AS "debtorId",
				COALESCE(SUM(p."amount"), 0)::float AS "totalCollected",
				MAX(p."createdAt") AS "lastPaymentAt"
			FROM "Payment" p
			INNER JOIN "Transaction" t ON t."id" = p."transactionId"
			WHERE t."type" = 'DEBT'
				AND t."debtorId" IN (${Prisma.join(debtorIds)})
			GROUP BY t."debtorId"
		`

    const payments = new Map(paymentRows.map(row => [row.debtorId, row]))

    // База сравнения размера долга — средний активный долг по этой выборке.
    const withDebt = rows.filter(row => Number(row.totalDebtAmount) > 0)
    const marketAverageDebt =
      withDebt.length > 0
        ? withDebt.reduce((sum, row) => sum + Number(row.totalDebtAmount), 0) / withDebt.length
        : 0

    const profiles = new Map<string, DebtorDebtProfile>()

    for (const row of rows) {
      const payment = payments.get(row.debtorId)
      const totalDebtAmount = round2(Number(row.totalDebtAmount))
      const totalIssued = round2(Number(row.totalIssued))
      const totalCollected = round2(Number(payment?.totalCollected ?? 0))
      const lastPaymentAt = payment?.lastPaymentAt ?? null

      const maxDaysOverdue = row.oldestDueDate
        ? Math.max(Math.floor((now.getTime() - new Date(row.oldestDueDate).getTime()) / MS_PER_DAY), 0)
        : 0

      const daysSinceLastPayment = lastPaymentAt
        ? Math.max(Math.floor((now.getTime() - new Date(lastPaymentAt).getTime()) / MS_PER_DAY), 0)
        : null

      const scored = scoreDebtorRisk({
        totalDebtAmount,
        overdueAmount: round2(Number(row.overdueAmount)),
        maxDaysOverdue,
        totalIssued,
        totalCollected,
        daysSinceLastPayment,
        marketAverageDebt,
      })

      profiles.set(row.debtorId, {
        totalDebtAmount,
        activeDebtCount: Number(row.activeDebtCount),
        overdueAmount: round2(Number(row.overdueAmount)),
        overdueCount: Number(row.overdueCount),
        totalIssued,
        totalCollected,
        repaymentRate: totalIssued > 0 ? round2(clamp(totalCollected / totalIssued, 0, 1)) : 0,
        maxDaysOverdue,
        daysSinceLastPayment,
        lastPaymentAt,
        nextDueDate: row.nextDueDate ?? null,
        ...scored,
      })
    }

    return profiles
  }

  async create(dto: CreateDebtorDto, marketId?: string) {
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')
    return this.prisma.debtor.create({ data: { ...dto, marketId }, include: debtorInclude })
  }

  async findAll(query: QueryDebtorDto, userMarketId?: string): Promise<PaginatedResult<unknown>> {
    const where: Prisma.DebtorWhereInput = {}

    if (userMarketId) where.marketId = userMarketId
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ]
    }
    if (query.dateFrom || query.dateTo) where.createdAt = buildDateWhere(query.dateFrom, query.dateTo)
    if (query.hasActiveDebts != null) {
      where.transactions = query.hasActiveDebts
        ? { some: { type: 'DEBT', status: { in: ACTIVE_DEBT_STATUSES } } }
        : { none: { type: 'DEBT', status: { in: ACTIVE_DEBT_STATUSES } } }
    }
    if (query.overdue != null && query.overdue === true) {
      where.transactions = {
        ...(where.transactions ?? {}),
        some: {
          type: 'DEBT',
          status: { in: ACTIVE_DEBT_STATUSES },
          dueDate: { lt: new Date() },
        },
      }
    }
    if (query.minDebtAmount != null || query.maxDebtAmount != null) {
      const having: Prisma.TransactionGroupByArgs['having'] = {
        remainingAmount: {
          _sum: {
            ...(query.minDebtAmount != null ? { gte: query.minDebtAmount } : {}),
            ...(query.maxDebtAmount != null ? { lte: query.maxDebtAmount } : {}),
          },
        },
      } as Prisma.TransactionGroupByArgs['having']

      const debtGroups = await this.prisma.transaction.groupBy({
        by: ['debtorId'],
        where: {
          debtorId: { not: null },
          type: 'DEBT',
          status: { in: ACTIVE_DEBT_STATUSES },
          ...(userMarketId ? { marketId: userMarketId } : {}),
        },
        _sum: { remainingAmount: true },
        having,
      })

      const debtorIds = debtGroups.map((g) => g.debtorId).filter(Boolean) as string[]
      if (debtorIds.length === 0) {
        return { data: [], meta: { page: query.page ?? 1, limit: query.limit ?? 20, total: 0, totalPages: 0 } }
      }
      where.id = { in: debtorIds }
    }

    if (query.risk || RISK_SORT_FIELDS.includes(query.sortBy ?? '')) {
      return this.findAllByRisk(query, where)
    }

    const result = await paginate(
      query,
      ({ skip, take }) =>
        this.prisma.debtor.findMany({
          where,
          include: debtorInclude,
          orderBy: buildOrderBy(query.sortBy, query.sortOrder, 'createdAt', [
            'createdAt',
            'name',
            'phone',
            'updatedAt'
          ]),
          skip,
          take,
        }),
      () => this.prisma.debtor.count({ where }),
    )

    // Профиль долгов и риск считаются для страницы, а не для всей таблицы:
    // один агрегат на выдачу вместо запроса на каждого должника.
    const now = new Date()
    const profiles = await this.getDebtProfiles(result.data.map(d => d.id), now)

    return {
      ...result,
      data: result.data.map(debtor => ({
        ...debtor,
        ...(profiles.get(debtor.id) ?? EMPTY_PROFILE),
      })),
    }
  }

  /**
   * Путь для фильтра/сортировки по риску.
   *
   * Риска нет в БД — он вычисляется из долгов и платежей, поэтому отфильтровать
   * его SQL-ом невозможно. Берём должников маркета (с уже применёнными
   * серверными фильтрами), считаем профили одним агрегатом и режем страницу
   * в памяти. Должников в маркете — сотни, не миллионы; денормализовать риск
   * в таблицу ради этого не стоит: он устаревал бы при каждом платеже.
   */
  private async findAllByRisk(
    query: QueryDebtorDto,
    where: Prisma.DebtorWhereInput,
  ): Promise<PaginatedResult<unknown>> {
    const debtors = await this.prisma.debtor.findMany({
      where,
      include: debtorInclude,
      take: RISK_PATH_LIMIT,
    })

    const now = new Date()
    const profiles = await this.getDebtProfiles(debtors.map(d => d.id), now)

    let rows = debtors.map(debtor => ({
      ...debtor,
      ...(profiles.get(debtor.id) ?? EMPTY_PROFILE),
    }))

    if (query.risk) rows = rows.filter(row => row.risk === query.risk)

    rows.sort(buildRiskComparator(query.sortBy, query.sortOrder))

    const page = query.page ?? 1
    const limit = Math.min(query.limit ?? 20, 100)
    const total = rows.length

    return {
      data: rows.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  }

  async findOne(id: string, userMarketId?: string) {
    const debtor = await this.prisma.debtor.findUnique({
      where: { id },
      include: debtorInclude,
    })
    if (!debtor) throw new NotFoundException('Debtor not found')
    if (userMarketId && debtor.marketId !== userMarketId) {
      throw new NotFoundException('Debtor not found')
    }

    const profiles = await this.getDebtProfiles([id], new Date())
    return { ...debtor, ...(profiles.get(id) ?? EMPTY_PROFILE) }
  }

  /** Проверка существования и принадлежности маркету без расчёта профиля. */
  private async getDebtorOrThrow(id: string, userMarketId?: string) {
    const debtor = await this.prisma.debtor.findUnique({ where: { id } })
    if (!debtor) throw new NotFoundException('Debtor not found')
    if (userMarketId && debtor.marketId !== userMarketId) {
      throw new NotFoundException('Debtor not found')
    }
    return debtor
  }

  async update(id: string, dto: UpdateDebtorDto, userMarketId?: string) {
    await this.getDebtorOrThrow(id, userMarketId)
    return this.prisma.debtor.update({ where: { id }, data: dto, include: debtorInclude })
  }

  async remove(id: string, userMarketId?: string) {
    await this.getDebtorOrThrow(id, userMarketId)
    await this.prisma.debtor.delete({ where: { id } })
  }
}
