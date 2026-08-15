import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { DateRange, round2 } from '../common/utils/period.util'

/**
 * Насколько срочно товар нужно закупать.
 * Порядок членов = порядок приоритета в выдаче.
 */
export enum ReorderPriority {
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  OK = 'OK',
  /** Товар не продаётся — закупать его не нужно вообще. */
  NOT_NEEDED = 'NOT_NEEDED',
}

/** Состояние товара с точки зрения бизнеса, а не только остатка. */
export enum ProductHealth {
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  CRITICAL = 'CRITICAL',
  LOW_STOCK = 'LOW_STOCK',
  HIGH_RETURNS = 'HIGH_RETURNS',
  NO_SALES = 'NO_SALES',
  SLOW_MOVING = 'SLOW_MOVING',
  HEALTHY = 'HEALTHY',
}

/**
 * Пороги, на которых держится вся логика рекомендаций.
 * Собраны в одном месте намеренно: это бизнес-правила, а не магические числа,
 * разбросанные по запросам.
 */
export const ANALYTICS_THRESHOLDS = {
  /** Меньше этого запаса в днях — закупать немедленно. */
  CRITICAL_DAYS_OF_STOCK: 3,
  /** Меньше этого — закупать в ближайшее время. */
  WARNING_DAYS_OF_STOCK: 7,
  /** На сколько дней вперёд рекомендуем закупать. */
  TARGET_COVER_DAYS: 14,
  /** Доля возвратов, выше которой товар считается проблемным. */
  HIGH_RETURN_RATE: 0.15,
  /** Минимум продаж, чтобы return rate вообще был статистически осмыслен. */
  MIN_UNITS_FOR_RETURN_RATE: 5,
  /** Запас в днях, выше которого товар «замораживает деньги». */
  SLOW_MOVING_DAYS_OF_STOCK: 90,
  /** Изменение в процентах, ниже которого это шум, а не тренд. */
  SIGNIFICANT_CHANGE_PERCENT: 15,
} as const

/** Сырая строка агрегата продаж по товару за период. */
interface ProductSalesRow {
  productId: string
  unitsSold: number
  refundedUnits: number
  revenue: number
  transactionCount: number
}

export interface ProductMetrics {
  productId: string
  /** Продано единиц за период, за вычетом возвращённых. */
  netUnitsSold: number
  unitsSold: number
  refundedUnits: number
  /** Выручка за период за вычетом возвратов. */
  revenue: number
  transactionCount: number
  returnRate: number
  /** Средние продажи в день за период. */
  avgDailySales: number
  /** На сколько дней хватит текущего остатка. null — продаж не было. */
  daysOfStockRemaining: number | null
  reorderPriority: ReorderPriority
  /** Сколько рекомендуется заказать. 0 — заказывать не нужно. */
  recommendedQuantity: number
  health: ProductHealth
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Агрегат продаж по товарам за период — одним запросом на все товары,
   * чтобы не порождать N+1 при расчёте метрик списка.
   *
   * Считаются SALE и DEBT: оба типа списывают товар со склада, поэтому оба
   * формируют скорость расхода запаса. REFUND-транзакции здесь не участвуют:
   * возвраты берутся из refundedQuantity исходных строк, чтобы возврат
   * относился к дате продажи, а не к дате возврата — иначе return rate
   * «переезжал» бы между периодами.
   */
  async getProductSalesRows(
    range: DateRange,
    marketId?: string,
    productIds?: string[],
  ): Promise<Map<string, ProductSalesRow>> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`t."type" IN ('SALE', 'DEBT')`,
      Prisma.sql`t."createdAt" >= ${range.gte}`,
      Prisma.sql`t."createdAt" <= ${range.lte}`,
    ]
    if (marketId) conditions.push(Prisma.sql`t."marketId" = ${marketId}`)
    if (productIds?.length) {
      conditions.push(
        Prisma.sql`ti."productId" IN (${Prisma.join(productIds)})`,
      )
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        productId: string
        unitsSold: bigint
        refundedUnits: bigint
        revenue: number
        transactionCount: bigint
      }>
    >`
			SELECT
				ti."productId" AS "productId",
				COALESCE(SUM(ti."quantity"), 0) AS "unitsSold",
				COALESCE(SUM(ti."refundedQuantity"), 0) AS "refundedUnits",
				COALESCE(
					SUM(
						ti."totalPrice"
						- (ti."refundedQuantity" * ti."price")
					),
					0
				)::float AS "revenue",
				COUNT(DISTINCT t."id") AS "transactionCount"
			FROM "TransactionItem" ti
			INNER JOIN "Transaction" t ON t."id" = ti."transactionId"
			WHERE ${Prisma.join(conditions, ' AND ')}
			GROUP BY ti."productId"
		`

    return new Map(
      rows.map(row => [
        row.productId,
        {
          productId: row.productId,
          unitsSold: Number(row.unitsSold),
          refundedUnits: Number(row.refundedUnits),
          revenue: round2(row.revenue),
          transactionCount: Number(row.transactionCount),
        },
      ]),
    )
  }

  /**
   * Превращает сырой агрегат в бизнес-метрики конкретного товара.
   *
   * Чистая функция: никаких обращений к БД — так её легко тестировать
   * и переиспользовать и в списке товаров, и в дашборде.
   */
  computeProductMetrics(
    product: { id: string; quantity: number; lowStockThreshold: number },
    sales: ProductSalesRow | undefined,
    durationDays: number,
  ): ProductMetrics {
    const unitsSold = sales?.unitsSold ?? 0
    const refundedUnits = sales?.refundedUnits ?? 0
    const netUnitsSold = Math.max(unitsSold - refundedUnits, 0)
    const revenue = sales?.revenue ?? 0
    const transactionCount = sales?.transactionCount ?? 0

    const returnRate =
      unitsSold >= ANALYTICS_THRESHOLDS.MIN_UNITS_FOR_RETURN_RATE
        ? round2(refundedUnits / unitsSold)
        : 0

    const avgDailySales = round2(netUnitsSold / Math.max(durationDays, 1))

    // Без продаж скорость расхода неизвестна — честнее вернуть null,
    // чем делить на ноль и рисовать «бесконечный запас».
    const daysOfStockRemaining =
      avgDailySales > 0 ? round2(product.quantity / avgDailySales) : null

    const reorderPriority = this.resolveReorderPriority(
      product,
      avgDailySales,
      daysOfStockRemaining,
    )

    const recommendedQuantity = this.resolveRecommendedQuantity(
      product,
      avgDailySales,
      reorderPriority,
    )

    return {
      productId: product.id,
      unitsSold,
      refundedUnits,
      netUnitsSold,
      revenue,
      transactionCount,
      returnRate,
      avgDailySales,
      daysOfStockRemaining,
      reorderPriority,
      recommendedQuantity,
      health: this.resolveHealth(
        product,
        netUnitsSold,
        returnRate,
        daysOfStockRemaining,
      ),
    }
  }

  private resolveReorderPriority(
    product: { quantity: number; lowStockThreshold: number },
    avgDailySales: number,
    daysOfStockRemaining: number | null,
  ): ReorderPriority {
    if (product.quantity <= 0) {
      // Кончившийся товар критичен, только если его вообще покупают.
      return avgDailySales > 0
        ? ReorderPriority.OUT_OF_STOCK
        : ReorderPriority.NOT_NEEDED
    }

    // Ручной порог владельца проверяем отдельно от скорости продаж —
    // иначе товар без единой продажи в выбранном периоде никогда не
    // попадёт в список закупки, даже если физически ниже порога.
    const belowManualThreshold =
      product.lowStockThreshold > 0 &&
      product.quantity <= product.lowStockThreshold

    // Нет продаж за период — по скорости расхода закупка не нужна,
    // но ручной порог всё ещё может её потребовать.
    if (avgDailySales <= 0 || daysOfStockRemaining === null) {
      return belowManualThreshold
        ? ReorderPriority.WARNING
        : ReorderPriority.NOT_NEEDED
    }
    if (daysOfStockRemaining <= ANALYTICS_THRESHOLDS.CRITICAL_DAYS_OF_STOCK) {
      return ReorderPriority.CRITICAL
    }
    if (daysOfStockRemaining <= ANALYTICS_THRESHOLDS.WARNING_DAYS_OF_STOCK) {
      return ReorderPriority.WARNING
    }
    // Ручной порог владельца уважаем, даже если по скорости запас ещё есть.
    if (belowManualThreshold) {
      return ReorderPriority.WARNING
    }
    return ReorderPriority.OK
  }

  /**
   * Сколько заказать: добить запас до TARGET_COVER_DAYS дней продаж.
   * Для товаров без продаж рекомендация не выдаётся — иначе система
   * советовала бы закупать то, что и так лежит мёртвым грузом.
   */
  private resolveRecommendedQuantity(
    product: { quantity: number; lowStockThreshold: number },
    avgDailySales: number,
    priority: ReorderPriority,
  ): number {
    if (priority === ReorderPriority.NOT_NEEDED || priority === ReorderPriority.OK) {
      return 0
    }
    const target = avgDailySales * ANALYTICS_THRESHOLDS.TARGET_COVER_DAYS
    // Не опускаемся ниже порога, заданного владельцем вручную.
    const floor = Math.max(target, product.lowStockThreshold)
    return Math.max(Math.ceil(floor - product.quantity), 0)
  }

  private resolveHealth(
    product: { quantity: number; lowStockThreshold: number },
    netUnitsSold: number,
    returnRate: number,
    daysOfStockRemaining: number | null,
  ): ProductHealth {
    if (product.quantity <= 0) return ProductHealth.OUT_OF_STOCK
    if (
      daysOfStockRemaining !== null &&
      daysOfStockRemaining <= ANALYTICS_THRESHOLDS.CRITICAL_DAYS_OF_STOCK
    ) {
      return ProductHealth.CRITICAL
    }
    if (returnRate >= ANALYTICS_THRESHOLDS.HIGH_RETURN_RATE) {
      return ProductHealth.HIGH_RETURNS
    }
    if (product.quantity <= product.lowStockThreshold) {
      return ProductHealth.LOW_STOCK
    }
    if (netUnitsSold <= 0) return ProductHealth.NO_SALES
    if (
      daysOfStockRemaining !== null &&
      daysOfStockRemaining >= ANALYTICS_THRESHOLDS.SLOW_MOVING_DAYS_OF_STOCK
    ) {
      return ProductHealth.SLOW_MOVING
    }
    return ProductHealth.HEALTHY
  }
}
