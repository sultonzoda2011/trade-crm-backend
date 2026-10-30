import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'
import { AnalyticsPeriod } from '../../common/dto/period-query.dto'
import { ProductHealth, ReorderPriority } from '../../analytics/analytics.service'

/**
 * Булевы query-параметры. `@Type(() => Boolean)` (и implicit conversion из
 * main.ts) превращают строку "false" в true — любая непустая строка truthy, —
 * и ?lowStock=false включал бы фильтр. К моменту @Transform `value` уже
 * испорчен конверсией, поэтому читаем исходное значение из `obj`.
 */
export const toBoolean = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key] === true || obj[key] === 'true'

export class QueryProductDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Return only products at or below their low-stock threshold' })
  @IsOptional()
  @Transform(toBoolean)
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
  @Transform(toBoolean)
  @IsBoolean()
  needsReorder?: boolean

  @ApiPropertyOptional({
    description: 'true — show the archive (archived products only). Default: active products only',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  archived?: boolean

  // Скользящее окно в днях вместо календарного period: на 1-е число месяца
  // календарное окно = 1 день, и «средние продажи в день» превращаются в шум.
  @ApiPropertyOptional({
    description: 'Rolling window in days (1–365) for sales velocity and health. Overrides period',
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number
}
