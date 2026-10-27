import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { buildDateWhere, buildOrderBy, paginate } from '../common/utils/paginate.util'
import { MS_PER_DAY, round2 } from '../common/utils/period.util'
import { JwtPayload } from '../interfaces'
import { TransactionStatus } from '../enums'
import { PrismaService } from '../prisma/prisma.service'
import { QueryTransactionDto } from '../transactions/dto/query-transaction.dto'
import { TransactionsService } from '../transactions/transactions.service'
import {
  buildRiskComparator,
  clamp,
  DebtorDebtProfile,
  DebtorLastPurchase,
  DebtorRiskInput,
  DebtorRiskResult,
  EMPTY_DEBTOR_PROFILE,
  RISK_SORT_FIELDS,
  scoreDebtorRisk,
} from './debtor-risk.util'
import { buildDebtorLedger } from './debtor-ledger.util'
import { planDebtorPayment } from './debtor-payment.util'
import { isValidPhone, normalizePhone } from './debtor-phone.util'
import { CreateDebtorDto } from './dto/create-debtor.dto'
import { CreateDebtorPaymentDto } from './dto/create-debtor-payment.dto'
import { QueryDebtorDto } from './dto/query-debtor.dto'
import { UpdateDebtorDto } from './dto/update-debtor.dto'

export { DebtorDebtProfile, DebtorLastPurchase, DebtorRiskInput, DebtorRiskResult, scoreDebtorRisk }

/** Превью транзакций должника на детальной странице — дальше кнопка "Все". */
const DEBTOR_TRANSACTIONS_PREVIEW_LIMIT = 5

/** Сколько товаров последней покупки показывать превью-миниатюрами на карточке. */
const LAST_PURCHASE_ITEMS_LIMIT = 3

/** Потолок ленты: сколько последних долговых транзакций должника учитываем. */
const LEDGER_TRANSACTIONS_LIMIT = 1000

/** После напоминания человек не попадает в «позвонить сегодня» столько дней. */
const REMIND_COOLDOWN_DAYS = 2

/** Сколько должников показывать в блоке «позвонить сегодня». */
const CALL_TODAY_LIMIT = 5

const ACTIVE_DEBT_STATUSES: TransactionStatus[] = [TransactionStatus.ACTIVE, TransactionStatus.PARTIAL]

const debtorInclude = {
  market: { select: { id: true, name: true, address: true, image: true } },
  _count: { select: { transactions: true } },
} as const

/**
 * Потолок аналитического пути. Должников в маркете столько не бывает,
 * но без ограничения одна аномальная база съела бы память процесса.
 */
const RISK_PATH_LIMIT = 5000

@Injectable()
export class DebtorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService
  ) {}

  /**
   * Долговой профиль по списку должников — один запрос на всю страницу,
   * без N+1. Возвраты здесь не участвуют: долг уменьшается только платежами,
   * а возврат товара по долговой продаже уже меняет remainingAmount самой
   * транзакции.
   */
  private async getDebtProfiles(
    debtors: Array<{ id: string; marketId: string }>,
    now: Date,
  ): Promise<Map<string, DebtorDebtProfile>> {
    if (debtors.length === 0) return new Map()
    const debtorIds = debtors.map(d => d.id)
    const marketOf = new Map(debtors.map(d => [d.id, d.marketId]))

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
        soleActiveTransactionId: string | null
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
				MAX(t."createdAt") AS "lastDebtAt",
				-- Только когда активная долговая транзакция ровно одна: иначе фронту
				-- нечем однозначно распорядиться при быстром "Погасить долг".
				CASE WHEN COUNT(*) FILTER (WHERE t."status" IN ('ACTIVE', 'PARTIAL')) = 1
					THEN MAX(t."id") FILTER (WHERE t."status" IN ('ACTIVE', 'PARTIAL'))
					ELSE NULL END AS "soleActiveTransactionId"
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
    const lastPurchases = await this.getLastPurchases(debtorIds)

    // База сравнения размера долга — средний активный долг по ВСЕМУ маркету,
    // а не по текущей странице: иначе риск одного человека менялся бы от
    // фильтра, страницы и сортировки списка.
    const marketAverages = await this.getMarketAverageDebts([...new Set(marketOf.values())])

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
        marketAverageDebt: marketAverages.get(marketOf.get(row.debtorId) ?? '') ?? 0,
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
        activeDebtTransactionId: row.soleActiveTransactionId ?? null,
        lastPurchase: lastPurchases.get(row.debtorId) ?? null,
        ...scored,
      })
    }

    return profiles
  }

  /** Средний активный долг на должника — по каждому маркету одним запросом. */
  private async getMarketAverageDebts(marketIds: string[]): Promise<Map<string, number>> {
    if (marketIds.length === 0) return new Map()

    const rows = await this.prisma.$queryRaw<Array<{ marketId: string; average: number }>>`
			SELECT d."marketId" AS "marketId", AVG(x."debt")::float AS "average"
			FROM (
				SELECT t."debtorId" AS "debtorId", SUM(t."remainingAmount") AS "debt"
				FROM "Transaction" t
				WHERE t."type" = 'DEBT' AND t."status" IN ('ACTIVE', 'PARTIAL')
				GROUP BY t."debtorId"
				HAVING SUM(t."remainingAmount") > 0
			) x
			INNER JOIN "Debtor" d ON d."id" = x."debtorId"
			WHERE d."marketId" IN (${Prisma.join(marketIds)})
			GROUP BY d."marketId"
		`

    return new Map(rows.map(row => [row.marketId, Number(row.average)]))
  }

  /**
   * Последняя DEBT-транзакция каждого должника + до 3 её товаров (для
   * превью на карточке — "за что именно образовался долг"). Две отдельные
   * группированные выборки на всю страницу вместо запроса на должника:
   * DISTINCT ON берёт саму транзакцию, второй запрос — её позиции разом.
   */
  private async getLastPurchases(debtorIds: string[]): Promise<Map<string, DebtorLastPurchase>> {
    if (debtorIds.length === 0) return new Map()

    const lastTx = await this.prisma.$queryRaw<
      Array<{ debtorId: string; transactionId: string; createdAt: Date }>
    >`
			SELECT DISTINCT ON (t."debtorId")
				t."debtorId" AS "debtorId",
				t."id" AS "transactionId",
				t."createdAt" AS "createdAt"
			FROM "Transaction" t
			WHERE t."type" = 'DEBT'
				AND t."debtorId" IN (${Prisma.join(debtorIds)})
			ORDER BY t."debtorId", t."createdAt" DESC
		`

    if (lastTx.length === 0) return new Map()

    const items = await this.prisma.transactionItem.findMany({
      where: { transactionId: { in: lastTx.map(row => row.transactionId) } },
      select: {
        transactionId: true,
        productId: true,
        productName: true,
        quantity: true,
        product: { select: { image: true } },
      },
    })

    const itemsByTx = new Map<string, DebtorLastPurchase['items']>()
    for (const item of items) {
      const list = itemsByTx.get(item.transactionId) ?? []
      // Позиций может быть больше, чем нужно карточке — режем на лету, без
      // отдельного query per transaction ради LIMIT.
      if (list.length < LAST_PURCHASE_ITEMS_LIMIT) {
        list.push({
          productId: item.productId,
          name: item.productName,
          quantity: item.quantity,
          image: item.product?.image ?? null,
        })
      }
      itemsByTx.set(item.transactionId, list)
    }

    const result = new Map<string, DebtorLastPurchase>()
    for (const row of lastTx) {
      result.set(row.debtorId, { at: row.createdAt, items: itemsByTx.get(row.transactionId) ?? [] })
    }
    return result
  }

  async create(dto: CreateDebtorDto, marketId?: string) {
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')

    const phone = this.cleanPhone(dto.phone)
    const duplicate = await this.findPhoneDuplicate(phone, marketId)
    const debtor = await this.prisma.debtor.create({
      data: { ...dto, phone, marketId },
      include: debtorInclude,
    })

    // Дубль номера не блокируем: на рынке один телефон бывает у двух людей
    // (семейная лавка). Просто говорим клиенту, чтобы он спросил продавца.
    return { ...debtor, phoneDuplicateOf: duplicate }
  }

  private cleanPhone(raw: string): string {
    const phone = normalizePhone(raw)
    if (!isValidPhone(phone)) {
      throw new BadRequestException('Phone must contain 7-15 digits, optionally starting with +')
    }
    return phone
  }

  private findPhoneDuplicate(phone: string, marketId: string, excludeId?: string) {
    return this.prisma.debtor.findFirst({
      where: { marketId, phone, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true },
    })
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
    const profiles = await this.getDebtProfiles(result.data, now)

    return {
      ...result,
      data: result.data.map(debtor => ({
        ...debtor,
        ...(profiles.get(debtor.id) ?? EMPTY_DEBTOR_PROFILE),
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
    const profiles = await this.getDebtProfiles(debtors, now)

    let rows = debtors.map(debtor => ({
      ...debtor,
      ...(profiles.get(debtor.id) ?? EMPTY_DEBTOR_PROFILE),
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

    const profiles = await this.getDebtProfiles([debtor], new Date())
    return { ...debtor, ...(profiles.get(id) ?? EMPTY_DEBTOR_PROFILE) }
  }

  /**
   * Карточка должника + превью его транзакций одним запросом вместо двух
   * отдельных round-trip'ов с фронта (раньше это были параллельные, но всё
   * равно два разных HTTP-запроса на мобильном интернете магазина).
   */
  async findOneFull(id: string, userMarketId?: string) {
    const [debtor, transactions] = await Promise.all([
      this.findOne(id, userMarketId),
      this.transactionsService.findAll(
        { debtorId: id, page: 1, limit: DEBTOR_TRANSACTIONS_PREVIEW_LIMIT } as QueryTransactionDto,
        userMarketId
      )
    ])
    return { debtor, transactions }
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
    const current = await this.getDebtorOrThrow(id, userMarketId)
    const phone = dto.phone != null ? this.cleanPhone(dto.phone) : undefined
    const duplicate = phone ? await this.findPhoneDuplicate(phone, current.marketId, id) : null
    const debtor = await this.prisma.debtor.update({
      where: { id },
      data: { ...dto, ...(phone ? { phone } : {}) },
      include: debtorInclude,
    })
    return { ...debtor, phoneDuplicateOf: duplicate }
  }

  async remove(id: string, userMarketId?: string) {
    await this.getDebtorOrThrow(id, userMarketId)
    await this.prisma.debtor.delete({ where: { id } })
  }

  /**
   * Лента выдач и оплат с остатком после каждого события (новые сверху).
   * События двух таблиц склеиваются в памяти: у одного должника их десятки-
   * сотни, а остаток «после» нельзя посчитать постраничным SQL.
   */
  async getLedger(id: string, query: { page?: number; limit?: number }, userMarketId?: string) {
    await this.getDebtorOrThrow(id, userMarketId)

    const debts = await this.prisma.transaction.findMany({
      where: { debtorId: id, type: 'DEBT' },
      orderBy: { createdAt: 'desc' },
      take: LEDGER_TRANSACTIONS_LIMIT,
      select: {
        id: true,
        totalAmount: true,
        createdAt: true,
        dueDate: true,
        createdBy: { select: { name: true } },
        items: { select: { productName: true }, take: LAST_PURCHASE_ITEMS_LIMIT },
        payments: {
          select: {
            id: true,
            transactionId: true,
            amount: true,
            note: true,
            createdAt: true,
            createdBy: { select: { name: true } },
          },
        },
      },
    })

    const events = buildDebtorLedger(
      debts.map(debt => ({
        id: debt.id,
        totalAmount: debt.totalAmount,
        createdAt: debt.createdAt,
        dueDate: debt.dueDate,
        createdByName: debt.createdBy?.name ?? null,
        itemNames: debt.items.map(item => item.productName),
      })),
      debts.flatMap(debt =>
        debt.payments.map(payment => ({
          id: payment.id,
          transactionId: payment.transactionId,
          amount: payment.amount,
          note: payment.note,
          createdAt: payment.createdAt,
          createdByName: payment.createdBy?.name ?? null,
        })),
      ),
    )

    const page = query.page ?? 1
    const limit = Math.min(query.limit ?? 30, 100)
    const total = events.length

    return {
      data: events.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  }

  /**
   * Платёж «человек принёс сумму»: раскладывается по открытым долгам от
   * старых к новым (FIFO). Всё в одной транзакции БД — либо списались все
   * долги и записались все платежи, либо ничего.
   */
  async payDebtor(id: string, dto: CreateDebtorPaymentDto, user: JwtPayload) {
    if (!user.marketId) throw new UnauthorizedException('User is not assigned to a market')
    await this.getDebtorOrThrow(id, user.marketId)

    return this.prisma.$transaction(async tx => {
      const debts = await tx.transaction.findMany({
        where: { debtorId: id, type: 'DEBT', status: { in: ACTIVE_DEBT_STATUSES }, remainingAmount: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, remainingAmount: true },
      })

      if (debts.length === 0) throw new BadRequestException('Debtor has no active debts')

      const plan = planDebtorPayment(debts, dto.amount)
      if (plan.excess > 0) {
        const total = round2(debts.reduce((sum, debt) => sum + debt.remainingAmount, 0))
        throw new BadRequestException(`Payment amount (${dto.amount}) exceeds total debt (${total})`)
      }

      const before = new Map(debts.map(debt => [debt.id, debt.remainingAmount]))
      for (const part of plan.allocations) {
        // Та же защита от lost update, что и в TransactionsService.pay():
        // пишем, только если остаток не изменился с момента чтения.
        const updated = await tx.transaction.updateMany({
          where: { id: part.transactionId, remainingAmount: before.get(part.transactionId) },
          data: {
            remainingAmount: part.remainingAfter,
            status: part.settled ? TransactionStatus.PAID : TransactionStatus.PARTIAL,
          },
        })
        if (updated.count === 0) {
          throw new BadRequestException('Debt was modified concurrently, please retry')
        }

        await tx.payment.create({
          data: {
            transactionId: part.transactionId,
            amount: part.amount,
            note: dto.note,
            createdById: user.sub,
          },
        })
      }

      const remainingDebt = round2(
        debts.reduce((sum, debt) => sum + debt.remainingAmount, 0) - dto.amount,
      )

      return {
        totalApplied: round2(dto.amount),
        remainingDebt,
        allocations: plan.allocations,
      }
    })
  }

  /** Отметка «напомнили о долге» — после звонка/WhatsApp/SMS. */
  async markReminded(id: string, userMarketId?: string) {
    await this.getDebtorOrThrow(id, userMarketId)
    const debtor = await this.prisma.debtor.update({
      where: { id },
      data: { lastRemindedAt: new Date() },
      select: { id: true, lastRemindedAt: true },
    })
    return debtor
  }

  /**
   * Сводка над списком: сколько должны всего, сколько просрочено и с кем
   * разбираться сегодня. Считается по всем должникам маркета, а не по
   * странице — иначе цифры «прыгали» бы при листании.
   */
  async getSummary(userMarketId?: string) {
    const debtors = await this.prisma.debtor.findMany({
      where: {
        ...(userMarketId ? { marketId: userMarketId } : {}),
        transactions: { some: { type: 'DEBT', status: { in: ACTIVE_DEBT_STATUSES } } },
      },
      select: { id: true, name: true, phone: true, marketId: true, lastRemindedAt: true },
      take: RISK_PATH_LIMIT,
    })

    const now = new Date()
    const profiles = await this.getDebtProfiles(debtors, now)
    const rows = debtors.map(debtor => ({
      ...debtor,
      ...(profiles.get(debtor.id) ?? EMPTY_DEBTOR_PROFILE),
    }))

    const remindedRecently = (at: Date | null) => at != null && now.getTime() - at.getTime() < REMIND_COOLDOWN_DAYS * MS_PER_DAY

    const callToday = rows
      .filter(row => row.overdueAmount > 0 && !remindedRecently(row.lastRemindedAt))
      .sort(buildRiskComparator('risk'))
      .slice(0, CALL_TODAY_LIMIT)
      .map(row => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        overdueAmount: row.overdueAmount,
        maxDaysOverdue: row.maxDaysOverdue,
        risk: row.risk,
      }))

    return {
      totalDebt: round2(rows.reduce((sum, row) => sum + row.totalDebtAmount, 0)),
      overdueAmount: round2(rows.reduce((sum, row) => sum + row.overdueAmount, 0)),
      debtorsWithDebt: rows.length,
      overdueDebtors: rows.filter(row => row.overdueAmount > 0).length,
      highRiskDebtors: rows.filter(row => row.risk === 'HIGH').length,
      callToday,
    }
  }
}
