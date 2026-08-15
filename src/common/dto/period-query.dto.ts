import { IsDateString, IsEnum, IsOptional } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Период аналитики. Не Prisma-энум: существует только на уровне API,
 * значения в нижнем регистре, чтобы читаться в query-строке.
 */
export enum AnalyticsPeriod {
  TODAY = 'today',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

/**
 * Базовый DTO для любого аналитического запроса с периодом.
 * period ПЕРЕКРЫВАЕТ dateFrom/dateTo; если не передано ничего — сервис
 * берёт текущий месяц, чтобы не сканировать всю историю транзакций.
 */
export class PeriodQueryDto {
  @ApiPropertyOptional({ description: 'Start of period for period-scoped stats' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @ApiPropertyOptional({ description: 'End of period for period-scoped stats' })
  @IsOptional()
  @IsDateString()
  dateTo?: string

  @ApiPropertyOptional({
    enum: AnalyticsPeriod,
    description: 'Predefined period (overrides dateFrom/dateTo)',
  })
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod
}
