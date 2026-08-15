import { IsBoolean, IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'
import { AnalyticsPeriod } from '../../common/dto/period-query.dto'
import { ProductHealth, ReorderPriority } from '../../analytics/analytics.service'

export class QueryProductDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Return only products at or below their low-stock threshold' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStock?: boolean

  @ApiPropertyOptional({ description: 'Minimum price filter' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number

  @ApiPropertyOptional({ description: 'Maximum price filter' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number

  // Окно, за которое считается скорость продаж. Намеренно НЕ переиспользует
  // dateFrom/dateTo из BaseQueryDto: там они фильтруют дату создания товара,
  // и смешивание двух смыслов в одних параметрах читалось бы неоднозначно.
  @ApiPropertyOptional({
    enum: AnalyticsPeriod,
    description: 'Window used to compute sales velocity and health. Default: month',
  })
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod

  @ApiPropertyOptional({
    enum: ProductHealth,
    description: 'Filter by computed business health (drill-through from dashboard)',
  })
  @IsOptional()
  @IsEnum(ProductHealth)
  health?: ProductHealth

  @ApiPropertyOptional({
    enum: ReorderPriority,
    description: 'Filter by computed reorder urgency',
  })
  @IsOptional()
  @IsEnum(ReorderPriority)
  reorderPriority?: ReorderPriority

  @ApiPropertyOptional({
    description: 'Return only products that need reordering, sorted by urgency',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  needsReorder?: boolean
}
