import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { toBoolean } from './query-product.dto'
import { IsBoolean, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator'

export class BulkPriceDto {
	@ApiProperty({
		example: 5,
		description: 'Percent to change the price by: 5 = +5%, -10 = −10%. Must not be 0 (−90 … 500)'
	})
	@Type(() => Number)
	@IsNumber()
	@Min(-90)
	@Max(500)
	percent: number

	@ApiPropertyOptional({ description: 'Only products of this category (default: the whole active catalog)' })
	@IsOptional()
	@IsUUID()
	categoryId?: string

	@ApiPropertyOptional({
		example: 100,
		description: 'Round new prices to a multiple of this step (default 0.01). Use 100 or 500 for big-denomination prices'
	})
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0.01)
	@Max(1_000_000)
	roundTo?: number

	@ApiPropertyOptional({ description: 'true — only show what would change, write nothing' })
	@IsOptional()
	@Transform(toBoolean)
	@IsBoolean()
	dryRun?: boolean
}
