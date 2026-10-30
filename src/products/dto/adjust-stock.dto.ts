import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { MAX_STOCK } from '../stock.util'

/**
 * Инвентаризация: человек пересчитал полку и вводит, сколько ФАКТИЧЕСКИ лежит.
 * Это единственное место, где остаток задаётся итогом, а не приращением; разница
 * с учётным остатком записывается в журнал как ADJUSTMENT.
 */
export class AdjustStockDto {
	@ApiProperty({ example: 42, description: 'Counted stock — the NEW TOTAL, not a delta (0 – 1 000 000 000)' })
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(MAX_STOCK)
	quantity: number

	@ApiPropertyOptional({ example: 'Инвентаризация', description: 'Optional note shown in the stock history (max 200 chars)' })
	@IsOptional()
	@IsString()
	@MaxLength(200)
	note?: string
}
