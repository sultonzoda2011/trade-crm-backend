import { IsBoolean, IsEnum, IsOptional } from 'class-validator'
import { Transform } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'
import { AnalyticsPeriod } from '../../common/dto/period-query.dto'
import { toBoolean } from '../../products/dto/query-product.dto'

export enum SellerStatusFilter {
  ALL = 'all',
  ACTIVE = 'active',
  DISABLED = 'disabled'
}

/** Поля, по которым можно сортировать список. Первые три считаются из чеков. */
export const SELLER_SORT_FIELDS = [
  'sold',
  'earned',
  'balance',
  'lastSaleAt',
  'createdAt',
  'name',
  'email'
] as const

/**
 * Список продавцов. `period` и `dateFrom/dateTo` задают окно, за которое
 * считаются «продал» и «заработал» (по умолчанию — текущий месяц); «к выплате»
 * всегда за всё время — это долг владельца, а не показатель периода.
 */
export class QuerySellerDto extends BaseQueryDto {
  @ApiPropertyOptional({ enum: SellerStatusFilter, description: 'Default: all' })
  @IsOptional()
  @IsEnum(SellerStatusFilter)
  status?: SellerStatusFilter

  @ApiPropertyOptional({ enum: AnalyticsPeriod, description: 'Window for sold/earned. Default: month' })
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod

  @ApiPropertyOptional({
    description:
      'true — add `stats` (sold, earned, balance, last sale) to each row. Pickers that only need names leave it off. Implied by sortBy = sold | earned | balance | lastSaleAt.'
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  withStats?: boolean
}
